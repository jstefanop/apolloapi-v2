/**
 * Automation service — miner scheduling, phase 1.
 *
 * Wires together the three pure pieces: signals (data) -> engine (decision) ->
 * guards (is the hardware allowed to take it). This layer owns the I/O: the DB,
 * the event log, and (from PR 2) actually moving the miner.
 *
 * In this PR `evaluate()` runs in DRY-RUN: it decides and records what it *would*
 * have done, without touching the miner. Run it on a real device for a few days,
 * read automation_events, and only then let it act.
 */

const { GraphQLError } = require('graphql');
const signals = require('../signals');
const { decide } = require('./engine');
const { canApply } = require('./guards');
const { apply } = require('./apply');
const { parseDbTime, toDbTime } = require('./time');

const { MINER_MODES } = require('../../constants/minerModes');

const EVENTS_CAP = 500;

// Everything the engine decides goes to the journal too, not just to the events
// table: on a device you read `journalctl -u apollo-api | grep '\[automation\]'`,
// and during the dry-run phase that log *is* the deliverable. Prefixed so it can
// be grepped out of a journal shared with the rest of the backend.
const log = (message) => console.log(`[automation] ${message}`);
const logError = (message) => console.error(`[automation] ${message}`);

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function describeTarget(target) {
  if (!target) return 'none';
  return target.type === 'off' ? 'off' : `mode:${target.mode}`;
}

class AutomationService {
  constructor(knex, deps) {
    this.knex = knex;
    this.deps = deps; // { miner, settings }
  }

  // ---------------------------------------------------------------- config

  async getConfig() {
    const row = await this.knex('automation_config').where({ id: 1 }).first();
    if (!row) throw new GraphQLError('Automation config row is missing');

    return {
      id: row.id,
      enabled: !!row.enabled,
      dryRun: !!row.dry_run,
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone,
      fallbackAction: row.fallback_action || 'keep',
      tariff: parseJson(row.tariff, null),
      mqtt: parseJson(row.mqtt, null),
      minOnMinutes: row.min_on_minutes,
      minOffMinutes: row.min_off_minutes,
      minChangeMinutes: row.min_change_minutes,
      maxCyclesPerHour: row.max_cycles_per_hour,
      defaultHysteresis: row.default_hysteresis,
      overrideMinutes: row.override_minutes,
      overrideUntil: parseDbTime(row.override_until),
      overrideReason: row.override_reason,
    };
  }

  async updateConfig(input = {}) {
    const fields = {
      enabled: 'enabled',
      dryRun: 'dry_run',
      latitude: 'latitude',
      longitude: 'longitude',
      timezone: 'timezone',
      fallbackAction: 'fallback_action',
      minOnMinutes: 'min_on_minutes',
      minOffMinutes: 'min_off_minutes',
      minChangeMinutes: 'min_change_minutes',
      maxCyclesPerHour: 'max_cycles_per_hour',
      defaultHysteresis: 'default_hysteresis',
      overrideMinutes: 'override_minutes',
    };

    const update = {};
    Object.entries(fields).forEach(([key, column]) => {
      if (input[key] !== undefined) update[column] = input[key];
    });
    if (input.tariff !== undefined) {
      update.tariff = input.tariff === null ? null : JSON.stringify(input.tariff);
    }
    if (input.mqtt !== undefined) {
      let mqtt = input.mqtt;
      // The password is never sent back to the UI, so an empty one on save means
      // "unchanged" — keep the stored one instead of wiping it.
      if (mqtt && !mqtt.password) {
        const existing = await this.getConfig();
        if (existing.mqtt && existing.mqtt.password) mqtt = { ...mqtt, password: existing.mqtt.password };
      }
      update.mqtt = mqtt === null ? null : JSON.stringify(mqtt);
    }

    if (Object.keys(update).length) {
      update.updated_at = this.knex.fn.now();
      await this.knex('automation_config').where({ id: 1 }).update(update);
    }

    const config = await this.getConfig();
    // Reconnect/resubscribe the MQTT client whenever the broker or mappings change,
    // and reconcile the Home Assistant discovery for the output side (toggling
    // output on/off does not change the connection, so onConnect won't fire).
    if (input.mqtt !== undefined) {
      this._configureMqtt(config);
      try {
        require('../index').mqttOutput.syncDiscovery().catch(() => {});
      } catch (e) {
        /* output not wired (tests) */
      }
    }
    return config;
  }

  // Point the shared MQTT client at the current config. Lazy require avoids a
  // hard dependency at module load (and keeps tests that never touch MQTT clean).
  _configureMqtt(config) {
    try {
      require('../mqtt/client').configure((config || {}).mqtt);
    } catch (e) {
      console.log('[automation] MQTT configure failed:', e.message);
    }
  }

  // Called by the scheduler on boot to open the connection from stored config.
  async initMqtt() {
    this._configureMqtt(await this.getConfig());
  }

  // Fill in the stored password when the form left it blank (used by both the
  // test probe and topic discovery).
  async _mqttWithPassword(input) {
    let mqtt = input || {};
    if (!mqtt.password) {
      const existing = await this.getConfig();
      if (existing.mqtt && existing.mqtt.password) mqtt = { ...mqtt, password: existing.mqtt.password };
    }
    return mqtt;
  }

  // One-off connection probe for the "Test connection" button.
  async testMqtt(input) {
    return require('../mqtt/client').testConnection(await this._mqttWithPassword(input));
  }

  // Browse the broker for topics (subscribe to a wildcard for a few seconds).
  async discoverMqtt(input, { prefix, seconds } = {}) {
    return require('../mqtt/client').discoverTopics(await this._mqttWithPassword(input), { prefix, seconds });
  }

  /**
   * A manual start/stop pauses the automation instead of fighting it: the miner
   * doing the opposite of what you just asked, 30 seconds later, is the fastest
   * way to make someone turn the feature off for good.
   */
  async setOverride({ minutes, reason = 'manual' } = {}) {
    const config = await this.getConfig();
    const window = minutes || config.overrideMinutes || 60;
    const until = toDbTime(new Date(Date.now() + window * 60 * 1000));
    await this.knex('automation_config')
      .where({ id: 1 })
      .update({ override_until: until, override_reason: reason, updated_at: this.knex.fn.now() });
    return this.getConfig();
  }

  async clearOverride() {
    await this.knex('automation_config')
      .where({ id: 1 })
      .update({ override_until: null, override_reason: null, updated_at: this.knex.fn.now() });
    return this.getConfig();
  }

  // ----------------------------------------------------------------- rules

  async listRules() {
    const rows = await this.knex('automation_rules').orderBy('priority', 'asc').orderBy('id', 'asc');
    return rows.map((row) => this._hydrateRule(row));
  }

  async createRule(input) {
    this._validateRule(input, await this.getConfig());
    const [id] = await this.knex('automation_rules').insert(this._ruleToRow(input));
    return this.getRule(id);
  }

  async updateRule(id, input) {
    const existing = await this.knex('automation_rules').where({ id }).first();
    if (!existing) throw new GraphQLError(`Rule ${id} not found`);

    this._validateRule({ ...this._hydrateRule(existing), ...input }, await this.getConfig());

    await this.knex('automation_rules')
      .where({ id })
      .update({ ...this._ruleToRow(input, true), updated_at: this.knex.fn.now() });

    return this.getRule(id);
  }

  async getRule(id) {
    const row = await this.knex('automation_rules').where({ id }).first();
    return row ? this._hydrateRule(row) : null;
  }

  async deleteRule(id) {
    const deleted = await this.knex('automation_rules').where({ id }).del();
    if (!deleted) throw new GraphQLError(`Rule ${id} not found`);
    return true;
  }

  _hydrateRule(row) {
    return {
      id: row.id,
      name: row.name,
      enabled: !!row.enabled,
      priority: row.priority,
      is_safety: !!row.is_safety,
      match: row.match || 'all',
      conditions: parseJson(row.conditions, []),
      action: parseJson(row.action, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _ruleToRow(input, partial = false) {
    const row = {};
    if (input.name !== undefined || !partial) row.name = input.name;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    if (input.priority !== undefined) row.priority = input.priority;
    if (input.is_safety !== undefined) row.is_safety = input.is_safety;
    if (input.match !== undefined) row.match = input.match;
    if (input.conditions !== undefined) row.conditions = JSON.stringify(input.conditions);
    if (input.action !== undefined) row.action = JSON.stringify(input.action);
    return row;
  }

  _validateRule(rule, config) {
    if (!rule.name) throw new GraphQLError('Rule name is required');

    // Config-aware so user-defined MQTT input signals validate too.
    const known = signals.descriptorsById(config);
    const conditions = rule.conditions || [];
    if (!conditions.length) throw new GraphQLError('A rule needs at least one condition');

    conditions.forEach((condition) => {
      const descriptor = known[condition.signal];
      if (!descriptor) throw new GraphQLError(`Unknown signal: ${condition.signal}`);
      if (!descriptor.ops.includes(condition.op)) {
        throw new GraphQLError(`Operator "${condition.op}" is not valid for ${condition.signal}`);
      }
    });

    const action = rule.action;
    if (!action || !['off', 'mode'].includes(action.type)) {
      throw new GraphQLError('Rule action must be { type: "off" } or { type: "mode", mode }');
    }
    if (action.type === 'mode' && !MINER_MODES.includes(action.mode)) {
      throw new GraphQLError(`Unknown miner mode: ${action.mode}`);
    }
  }

  // ---------------------------------------------------------------- events

  async listEvents(limit = 50) {
    const rows = await this.knex('automation_events')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.min(limit, EVENTS_CAP));

    return rows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      decision: row.decision,
      changeType: row.change_type,
      applied: !!row.applied,
      dryRun: !!row.dry_run,
      blockedBy: row.blocked_by,
      signals: parseJson(row.signals, null),
      message: row.message,
      createdAt: parseDbTime(row.created_at),
    }));
  }

  // Returns the inserted event (with its id) so a live tick can push it to the UI
  // without waiting for a refetch.
  async _recordEvent(event) {
    const [id] = await this.knex('automation_events').insert({
      rule_id: event.ruleId || null,
      rule_name: event.ruleName || null,
      decision: event.decision,
      change_type: event.changeType || null,
      applied: !!event.applied,
      dry_run: !!event.dryRun,
      blocked_by: event.blockedBy || null,
      signals: event.signals ? JSON.stringify(event.signals) : null,
      message: event.message || null,
    });

    const keep = this.knex('automation_events')
      .select('id')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(EVENTS_CAP);

    await this.knex('automation_events').whereNotIn('id', keep).del();

    return { id, ...event, createdAt: new Date().toISOString() };
  }

  // ----------------------------------------------------------------- state

  /**
   * The state the engine and the guard rails reason about. `lastChangeAt` folds
   * in manual actions too (service_status.requested_at): a user who just started
   * the miner by hand should not have the automation restart it one second later.
   */
  async getState(config) {
    const cfg = config || (await this.getConfig());

    const [status, settings, lastApplied, lastStart, lastStop, cycles] = await Promise.all([
      this.knex('service_status').select('status', 'requested_at').where({ service_name: 'miner' }).first(),
      this.deps.settings.read(),
      this.knex('automation_events').where({ applied: true }).orderBy('id', 'desc').first(),
      this.knex('automation_events').where({ applied: true, change_type: 'start' }).orderBy('id', 'desc').first(),
      this.knex('automation_events').where({ applied: true, change_type: 'stop' }).orderBy('id', 'desc').first(),
      this.knex('automation_events')
        .where({ applied: true, change_type: 'start' })
        .where('created_at', '>', this.knex.raw("datetime('now', '-1 hour')"))
        .count('* as count')
        .first(),
    ]);

    const times = [lastApplied?.created_at, status?.requested_at]
      .map(parseDbTime)
      .filter(Boolean)
      .map((t) => t.getTime());

    return {
      running: status?.status === 'online',
      mode: settings?.minerMode ?? null,
      activeRuleId: lastApplied?.rule_id ?? null,
      lastChangeAt: times.length ? new Date(Math.max(...times)) : null,
      lastStartAt: parseDbTime(lastStart?.created_at),
      lastStopAt: parseDbTime(lastStop?.created_at),
      cyclesLastHour: Number(cycles?.count || 0),
      overrideUntil: cfg.overrideUntil,
    };
  }

  async readSignals(config) {
    const cfg = config || (await this.getConfig());
    return signals.readAll({
      knex: this.knex,
      deps: this.deps,
      config: cfg,
      now: new Date(),
    });
  }

  async descriptors() {
    return signals.descriptors(await this.getConfig());
  }

  // ------------------------------------------------------------------ tick

  /**
   * One evaluation cycle: read the signals, decide, check the guard rails, act.
   *
   * Called by the scheduler every minute, and by the UI to preview a decision
   * ("what would you do right now?") — which is what `preview: true` is for: it
   * evaluates and returns, without acting and without writing to the log.
   */
  async evaluate({ preview = false } = {}) {
    const now = new Date();
    const config = await this.getConfig();

    // Signals are read regardless of `enabled` so the "current conditions" panel
    // works even with the automation off; only the decision/apply is gated.
    const [state, currentSignals] = await Promise.all([
      this.getState(config),
      this.readSignals(config),
    ]);

    if (!config.enabled) {
      return { enabled: false, skipped: 'disabled', decision: null, guard: null, state, signals: currentSignals };
    }

    const rules = await this.listRules();

    const decision = decide({
      signals: currentSignals,
      rules,
      config,
      state,
      now,
      descriptors: signals.descriptorsById(config),
    });

    const guard = canApply({ decision, state, config, now });
    const dryRun = !!config.dryRun;

    if (preview) {
      return { enabled: true, preview: true, decision, guard, state, signals: currentSignals };
    }

    let applied = false;
    let failure = null;

    if (guard.apply && !dryRun) {
      try {
        await apply({ target: decision.target, changeType: guard.changeType, deps: this.deps });
        applied = true;
        // The signals/state were read before we acted, so the pushed state would
        // still show the pre-action status. Re-read the miner status so the UI
        // reflects the action now (in prod it may still be 'pending' until the
        // service monitor confirms, which then pushes again).
        await this._refreshMinerStatus(state, currentSignals);
      } catch (error) {
        // The miner refused (systemd, a stale unit, a bad settings write). Log it
        // loudly and leave the state alone: the next tick will try again, and the
        // guard rails keep that from turning into a retry storm.
        failure = error.message;
        logError(`failed to ${guard.changeType}: ${error.message}`);
      }
    }

    const message = this._describeOutcome({ guard, dryRun, applied, failure, decision });

    let loggedEvent = null;
    try {
      if (await this._shouldLog({ decision, guard })) {
        loggedEvent = await this._recordEvent({
          ruleId: decision.ruleId,
          ruleName: decision.ruleName,
          decision: describeTarget(decision.target),
          changeType: guard.changeType,
          applied,
          dryRun,
          blockedBy: guard.blockedBy,
          signals: this._snapshot(currentSignals),
          message,
        });

        const rule = decision.ruleName ? `rule "${decision.ruleName}"` : decision.reason;
        const blocked = guard.blockedBy ? ` BLOCKED(${guard.blockedBy})` : '';
        const prefix = dryRun ? '[dry-run] ' : '';
        log(
          `${prefix}${rule} → ${describeTarget(decision.target)}${blocked} — ${message} | ` +
            `${this._formatSignals(currentSignals)}`
        );
      }
    } catch (error) {
      // Bookkeeping must never break the tick: the miner was already moved (or not).
      logError(`failed to record event: ${error.message}`);
    }

    // loggedEvent is the fresh row (or null) — the scheduler pushes it so the UI
    // history updates in real time instead of only on the next refetch.
    return { enabled: true, decision, guard, state, signals: currentSignals, applied, dryRun, failure, loggedEvent };
  }

  // Re-read the miner running state + mode after an apply and patch the state and
  // signals in place, so the pushed state reflects what we just did.
  async _refreshMinerStatus(state, currentSignals) {
    try {
      const [status, settings] = await Promise.all([
        this.knex('service_status').select('status').where({ service_name: 'miner' }).first(),
        this.deps.settings.read(),
      ]);
      const running = status?.status === 'online';
      state.running = running;
      state.mode = settings?.minerMode ?? state.mode;
      if (currentSignals['miner.running']) {
        currentSignals['miner.running'] = { ...currentSignals['miner.running'], value: running, stale: false };
      }
      if (currentSignals['miner.mode']) {
        currentSignals['miner.mode'] = { ...currentSignals['miner.mode'], value: state.mode, stale: false };
      }
    } catch (e) {
      /* leave the pre-action values */
    }
  }

  _describeOutcome({ guard, dryRun, applied, failure, decision }) {
    if (!guard.apply) return guard.message;
    if (failure) return `failed to ${guard.changeType}: ${failure}`;
    if (dryRun) return `would ${guard.changeType} (${decision.reason})`;
    return applied ? `${guard.changeType} applied (${decision.reason})` : guard.message;
  }

  /**
   * Only log when the outcome changes — an action, a block, or a change of mind.
   *
   * The outcome is (target, rule, block), not "would something happen": in
   * dry-run the miner never reaches its target, so the guard reports "would
   * apply" on every single tick. Keying off that logged a row a minute and
   * flushed the ring buffer overnight, burying the two events that mattered.
   */
  async _shouldLog({ decision, guard }) {
    const last = await this.knex('automation_events').orderBy('id', 'desc').first();
    if (!last) return true;

    const sameTarget = last.decision === describeTarget(decision.target);
    const sameRule = (last.rule_id ?? null) === (decision.ruleId ?? null);
    const sameBlock = (last.blocked_by ?? null) === (guard.blockedBy ?? null);

    return !(sameTarget && sameRule && sameBlock);
  }

  _snapshot(currentSignals) {
    return Object.fromEntries(
      Object.entries(currentSignals).map(([id, s]) => [id, s.stale ? null : s.value])
    );
  }

  // A decision is only readable next to the numbers that produced it — without
  // them, a log line saying "stop" is an accusation with no evidence.
  _formatSignals(currentSignals) {
    return Object.entries(currentSignals)
      .map(([id, s]) => `${id}=${s.stale ? 'stale' : s.value}`)
      .join(' ');
  }
}

module.exports = (knex, deps) => new AutomationService(knex, deps);
