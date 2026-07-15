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

  async read({ config }) {
    const connected = client.getStatus().connected;
    const out = {};
    for (const input of inputsOf(config)) {
      const entry = client.getValue(input.name);
      out[`input.${input.name}`] =
        entry && connected ? { value: entry.value } : { value: null, stale: true };
    }
    return out;
  },
};
