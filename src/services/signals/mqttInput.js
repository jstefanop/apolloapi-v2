/**
 * User-defined MQTT input signals.
 *
 * Each mapping in the MQTT config becomes an `input.<name>` number signal the
 * rules can react to. The descriptors are *dynamic* — they come from the user's
 * config, not a static list — so this provider exposes `describe(config)` instead
 * of a fixed `descriptors` array.
 *
 * A value is stale (so a rule on it does not match) when the broker is
 * disconnected or nothing has arrived yet — never a stale reading pretending to
 * be current.
 */
const client = require('../mqtt/client');

// A cached value older than this is treated as stale: if the publishing bridge
// dies while the broker stays up, `connected` alone would serve the last reading
// forever and a rule could keep actuating the miner on data that stopped
// arriving. Generous enough that interval sources (e.g. a ~40s solar bridge) stay
// fresh; per-input `maxAgeSeconds` overrides it.
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

const inputsOf = (config) => ((config && config.mqtt && config.mqtt.inputs) || []).filter((i) => i && i.name);

module.exports = {
  namespace: 'input',

  // No static descriptors — see describe().
  descriptors: [],

  describe(config) {
    return inputsOf(config).map((i) => ({
      id: `input.${i.name}`,
      type: 'number',
      widget: 'number',
      unit: i.unit || undefined,
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    }));
  },

  async read({ config, now }) {
    const connected = client.getStatus().connected;
    const nowMs = now ? now.getTime() : Date.now();
    const out = {};
    for (const input of inputsOf(config)) {
      const entry = client.getValue(input.name);
      const maxAgeMs = input.maxAgeSeconds > 0 ? input.maxAgeSeconds * 1000 : DEFAULT_MAX_AGE_MS;
      // Fresh only if connected AND the value has not aged out. Otherwise take the
      // same branch as disconnected — never a stale reading pretending to be
      // current. `pending` (UI spinner) only when connected and nothing yet, not
      // when a once-good value went stale.
      const fresh = entry && connected && nowMs - entry.at <= maxAgeMs;
      out[`input.${input.name}`] = fresh
        ? { value: entry.value }
        : { value: null, stale: true, pending: connected && !entry };
    }
    return out;
  },
};
