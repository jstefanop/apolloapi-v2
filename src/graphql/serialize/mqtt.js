/**
 * Turning the MQTT service config into its GraphQL shape. The password is never
 * returned; the live connection status and the HA device id are added.
 */
function serializeMqttConfig(config) {
  if (!config) return null;

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

  const output = config.output || {};

  return {
    enabled: !!config.enabled,
    host: config.host || null,
    port: config.port || null,
    username: config.username || null,
    tls: !!config.tls,
    status,
    output: {
      enabled: !!output.enabled,
      control: output.control !== false, // default on
      deviceId,
      exports: {
        miner: output.exports?.miner !== false,
        node: output.exports?.node !== false,
        solo: output.exports?.solo !== false,
        mcu: !!output.exports?.mcu, // default off
      },
    },
    inputs: (config.inputs || []).map((i) => ({
      name: i.name,
      topic: i.topic,
      jsonPath: i.jsonPath || null,
      unit: i.unit || null,
    })),
  };
}

module.exports = { serializeMqttConfig };
