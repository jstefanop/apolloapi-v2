/**
 * Turning the automation service's internal shapes into the GraphQL ones.
 *
 * Lives outside typeDefs/ and resolvers/ on purpose: schema.js loads every file
 * in those directories and would treat this one as a resolver map.
 *
 * Shared by the queries and by the subscription, so a decision looks the same
 * whether it was asked for or pushed.
 */

const asString = (value) => (value === null || value === undefined ? null : String(value));

function describeTarget(target) {
  if (!target) return 'none';
  return target.type === 'off' ? 'off' : `mode:${target.mode}`;
}

// { 'miner.temperature': { value: 71, stale: false } } -> [{ id, value, stale }]
function serializeSignals(signals) {
  if (!signals) return [];
  return Object.entries(signals).map(([id, signal]) => ({
    id,
    value: signal.stale ? null : asString(signal.value),
    stale: !!signal.stale,
    error: signal.error || null,
  }));
}

// The flat snapshot stored on an event: { 'miner.temperature': 88, 'sun.isDay': null }
function serializeSnapshot(snapshot) {
  if (!snapshot) return [];
  return Object.entries(snapshot).map(([id, value]) => ({
    id,
    value: asString(value),
    stale: value === null || value === undefined,
    error: null,
  }));
}

function serializeRule(rule) {
  if (!rule) return null;
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    isSafety: rule.is_safety,
    match: rule.match,
    conditions: (rule.conditions || []).map((condition) => ({
      signal: condition.signal,
      op: condition.op,
      value: asString(condition.value),
      values: condition.values ? condition.values.map(asString) : null,
      hysteresis: condition.hysteresis ?? null,
    })),
    action: rule.action,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

// The GraphQL input arrives with stringified condition values (a condition can
// hold a number, a boolean or a time, and GraphQL has no untyped scalar here).
// The engine casts them back using each signal's declared type.
function deserializeRuleInput(input) {
  const rule = { ...input };
  if (input.isSafety !== undefined) {
    rule.is_safety = input.isSafety;
    delete rule.isSafety;
  }
  return rule;
}

function serializeEvent(event) {
  return {
    id: event.id,
    ruleId: event.ruleId,
    ruleName: event.ruleName,
    decision: event.decision,
    changeType: event.changeType,
    applied: event.applied,
    dryRun: event.dryRun,
    blockedBy: event.blockedBy,
    message: event.message,
    signals: serializeSnapshot(event.signals),
    createdAt: event.createdAt ? new Date(event.createdAt).toISOString() : null,
  };
}

// The result of automation.evaluate(), in either its query or subscription form.
// Signals and miner state are serialized even when the automation is disabled, so
// the "current conditions" panel keeps working; only decision/guard are gated.
function serializeState(result) {
  if (!result) return null;

  const { enabled, decision, guard, state, signals, dryRun, loggedEvent } = result;

  return {
    enabled: !!enabled,
    dryRun: !!dryRun,
    // Present only on a real tick that recorded an event, so the UI can append it
    // to the history live.
    event: loggedEvent ? serializeEvent(loggedEvent) : null,
    decision:
      enabled && decision
        ? {
            target: describeTarget(decision.target),
            ruleId: decision.ruleId,
            ruleName: decision.ruleName,
            reason: decision.reason,
          }
        : null,
    guard:
      enabled && guard
        ? {
            apply: guard.apply,
            changeType: guard.changeType,
            blockedBy: guard.blockedBy,
            message: guard.message,
          }
        : null,
    miner: state
      ? {
          // Prefer the miner.* signals so the status card and the conditions tiles
          // always agree (they read the same values); fall back to the engine state.
          running:
            signals && signals['miner.running'] && !signals['miner.running'].stale
              ? !!signals['miner.running'].value
              : state.running,
          mode:
            signals && signals['miner.mode'] && !signals['miner.mode'].stale
              ? signals['miner.mode'].value
              : state.mode,
          lastChangeAt: state.lastChangeAt ? state.lastChangeAt.toISOString() : null,
          cyclesLastHour: state.cyclesLastHour,
          overrideUntil: state.overrideUntil ? state.overrideUntil.toISOString() : null,
        }
      : null,
    signals: serializeSignals(signals),
  };
}

function serializeConfig(config) {
  if (!config) return null;
  return {
    ...config,
    overrideUntil: config.overrideUntil ? config.overrideUntil.toISOString() : null,
    mqtt: serializeMqtt(config.mqtt),
  };
}

// The password is never returned; the live connection status is added.
function serializeMqtt(mqtt) {
  if (!mqtt) return null;
  let status = { connected: false, error: null };
  try {
    status = require('../../services/mqtt/client').getStatus();
  } catch (e) {
    /* client not available */
  }
  let deviceId = null;
  try {
    deviceId = require('../../services/mqtt/output').deviceId();
  } catch (e) {
    /* output not available */
  }

  const output = mqtt.output || {};

  return {
    enabled: !!mqtt.enabled,
    host: mqtt.host || null,
    port: mqtt.port || null,
    username: mqtt.username || null,
    tls: !!mqtt.tls,
    status,
    inputs: (mqtt.inputs || []).map((i) => ({
      name: i.name,
      topic: i.topic,
      jsonPath: i.jsonPath || null,
      unit: i.unit || null,
    })),
    output: {
      enabled: !!output.enabled,
      control: output.control !== false, // default on
      deviceId,
    },
  };
}

module.exports = {
  describeTarget,
  serializeSignals,
  serializeSnapshot,
  serializeRule,
  deserializeRuleInput,
  serializeEvent,
  serializeState,
  serializeConfig,
};
