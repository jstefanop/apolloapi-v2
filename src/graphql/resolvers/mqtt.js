const { serializeMqttConfig } = require('../serialize/mqtt');

// Same shape as the other namespaces: { result, error }, never a thrown error
// across the wire.
const wrap = async (fn) => {
  try {
    return { result: await fn(), error: null };
  } catch (error) {
    return { result: null, error: { message: error.message } };
  }
};

// Changing the input mappings affects the automation signals; re-evaluate now so
// a new input.* value can be reacted to without waiting for the 60s tick.
const triggerTick = () => {
  try {
    const { evaluateAutomation } = require('../../app/scheduler');
    Promise.resolve(evaluateAutomation()).catch(() => {});
  } catch (e) {
    /* scheduler not running (tests) */
  }
};

module.exports = {
  Query: {
    Mqtt: () => ({}),
  },

  MqttActions: {
    config: (_, __, { services }) => wrap(async () => serializeMqttConfig(await services.mqtt.getConfig())),

    updateConfig: (_, { input }, { services }) =>
      wrap(async () => {
        const config = serializeMqttConfig(await services.mqtt.updateConfig(input));
        if (input.inputs !== undefined) triggerTick();
        return config;
      }),

    testConnection: (_, { input }, { services }) =>
      wrap(async () => {
        const { ok, error } = await services.mqtt.testConnection(input);
        return { ok, message: error };
      }),

    discoverTopics: (_, { input, prefix, seconds }, { services }) =>
      wrap(async () => services.mqtt.discoverTopics(input, { prefix, seconds })),
  },
};
