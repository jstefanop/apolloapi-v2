/**
 * The rules engine — a pure function.
 *
 * decide() does no I/O: signals, rules, config and current state go in, a
 * decision comes out. Everything that can burn hardware or confuse a user lives
 * here, which is exactly why it must stay testable without a device, a database
 * or systemd.
 *
 *   decide({ signals, rules, config, state, now }) ->
 *     { target, ruleId, ruleName, reason, bypassGuards, evaluated }
 *
 * target: null (leave the miner alone) | { type: 'off' } | { type: 'mode', mode }
 */

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  in: (a, list) => list.includes(a),
  not_in: (a, list) => !list.includes(a),
};

const NUMERIC_OPS = ['<', '<=', '>', '>='];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// Time windows may wrap past midnight: 23:00 → 07:00 is a valid "night" window.
function timeBetween(value, [from, to]) {
  const v = toMinutes(value);
  const f = toMinutes(from);
  const t = toMinutes(to);
  return f > t ? v >= f || v < t : v >= f && v < t;
}

function cast(raw, type) {
  if (raw === null || raw === undefined) return raw;
  if (type === 'number') return Number(raw);
  if (type === 'boolean') return raw === true || raw === 'true' || raw === 1 || raw === '1';
  return String(raw);
}

/**
 * Hysteresis makes a threshold sticky *for the rule that is currently in
 * charge*: "stop above 80°C" with a hysteresis of 5 keeps holding until the
 * board drops below 75°C — which is precisely "stop above X, resume below Y",
 * with Y = X - hysteresis.
 *
 * Without it, a board hovering at 80.0 ± 0.2 °C would flap the miner forever.
 */
function effectiveThreshold(op, threshold, hysteresis, isActiveRule) {
  if (!isActiveRule || !hysteresis) return threshold;
  if (op === '>' || op === '>=') return threshold - hysteresis;
  if (op === '<' || op === '<=') return threshold + hysteresis;
  return threshold;
}

function evaluateCondition(condition, { signals, descriptors, config, isActiveRule }) {
  const signal = signals[condition.signal];
  const descriptor = descriptors[condition.signal];

  if (!signal || !descriptor) {
    return { ok: false, unevaluable: true, why: 'unknown_signal' };
  }
  if (signal.stale) {
    // Fail-safe: we cannot know, so we do not match.
    return { ok: false, unevaluable: true, why: 'stale_signal' };
  }

  const { op } = condition;
  const value = signal.value;

  if (op === 'between' || op === 'not_between') {
    const range = condition.values || [];
    if (range.length !== 2) return { ok: false, unevaluable: true, why: 'bad_range' };
    const inside =
      descriptor.type === 'time'
        ? timeBetween(value, range)
        : value >= cast(range[0], descriptor.type) && value <= cast(range[1], descriptor.type);
    return { ok: op === 'between' ? inside : !inside };
  }

  if (op === 'in' || op === 'not_in') {
    const list = (condition.values || []).map((v) => cast(v, descriptor.type));
    return { ok: OPS[op](value, list) };
  }

  const fn = OPS[op];
  if (!fn) return { ok: false, unevaluable: true, why: 'unknown_op' };

  let threshold = cast(condition.value, descriptor.type);

  if (NUMERIC_OPS.includes(op) && descriptor.supportsHysteresis) {
    const hysteresis =
      condition.hysteresis !== undefined && condition.hysteresis !== null
        ? condition.hysteresis
        : config.defaultHysteresis;
    threshold = effectiveThreshold(op, threshold, hysteresis, isActiveRule);
  }

  // Time comparisons ('<' / '>' on HH:mm) work on minutes, not on strings.
  if (descriptor.type === 'time' && NUMERIC_OPS.includes(op)) {
    return { ok: fn(toMinutes(value), toMinutes(threshold)) };
  }

  return { ok: fn(value, threshold) };
}

function evaluateRule(rule, ctx) {
  const conditions = rule.conditions || [];
  if (!conditions.length) return { matched: false, unevaluable: true, why: 'no_conditions' };

  const isActiveRule = ctx.state.activeRuleId === rule.id;
  const results = conditions.map((c) =>
    evaluateCondition(c, { ...ctx, isActiveRule })
  );

  const unevaluable = results.filter((r) => r.unevaluable);

  if (rule.match === 'any') {
    const matched = results.some((r) => r.ok);
    // An 'any' rule can still match on a readable condition even if another is stale.
    return { matched, unevaluable: !matched && unevaluable.length > 0, why: unevaluable[0]?.why };
  }

  // 'all': a single unreadable condition makes the whole rule unevaluable.
  if (unevaluable.length) return { matched: false, unevaluable: true, why: unevaluable[0].why };

  return { matched: results.every((r) => r.ok) };
}

// 'keep' | 'off' | 'on:eco' → target
function parseAction(action) {
  if (!action || action === 'keep') return null;
  if (typeof action === 'string') {
    if (action === 'off') return { type: 'off' };
    if (action.startsWith('on:')) return { type: 'mode', mode: action.slice(3) };
    return null;
  }
  if (action.type === 'off') return { type: 'off' };
  if (action.type === 'mode' && action.mode) return { type: 'mode', mode: action.mode };
  return null;
}

function decide({ signals, rules, config, state, now, descriptors }) {
  const ctx = { signals, descriptors, config, state, now };
  const evaluated = [];

  const enabled = (rules || []).filter((r) => r.enabled);
  const byPriority = (a, b) => a.priority - b.priority || a.id - b.id;

  const safety = enabled.filter((r) => r.is_safety).sort(byPriority);
  const normal = enabled.filter((r) => !r.is_safety).sort(byPriority);

  // 1. Safety rules run even while the automation is overridden, and they win.
  for (const rule of safety) {
    const result = evaluateRule(rule, ctx);
    evaluated.push({ ruleId: rule.id, name: rule.name, safety: true, ...result });
    if (result.matched) {
      return {
        target: parseAction(rule.action),
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'safety',
        bypassGuards: true,
        evaluated,
      };
    }
  }

  // 2. A manual action pauses the automation for a while — respect it.
  if (state.overrideUntil && new Date(state.overrideUntil) > now) {
    return {
      target: null,
      ruleId: null,
      ruleName: null,
      reason: 'override',
      bypassGuards: false,
      evaluated,
    };
  }

  // 3. First matching rule by priority wins.
  for (const rule of normal) {
    const result = evaluateRule(rule, ctx);
    evaluated.push({ ruleId: rule.id, name: rule.name, safety: false, ...result });
    if (result.matched) {
      return {
        target: parseAction(rule.action),
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'rule',
        bypassGuards: false,
        evaluated,
      };
    }
  }

  // 4. Nothing matched: fall back (default 'keep' = do not touch the miner).
  return {
    target: parseAction(config.fallbackAction),
    ruleId: null,
    ruleName: null,
    reason: 'fallback',
    bypassGuards: false,
    evaluated,
  };
}

module.exports = { decide, evaluateRule, evaluateCondition, parseAction, timeBetween };
