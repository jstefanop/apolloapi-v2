const pubsub = require('../pubsub');
const TOPICS = require('../topics');
const { serializeState } = require('../serialize/automation');

module.exports = {
  Subscription: {
    miner: {
      subscribe: () => pubsub.asyncIterator([TOPICS.MINER]),
      resolve: (payload) => payload.miner,
    },
    node: {
      subscribe: () => pubsub.asyncIterator([TOPICS.NODE]),
      resolve: (payload) => payload.node,
    },
    mcu: {
      subscribe: () => pubsub.asyncIterator([TOPICS.MCU]),
      resolve: (payload) => payload.mcu,
    },
    solo: {
      subscribe: () => pubsub.asyncIterator([TOPICS.SOLO]),
      resolve: (payload) => payload.solo,
    },
    services: {
      subscribe: () => pubsub.asyncIterator([TOPICS.SERVICES]),
      resolve: (payload) => payload.services,
    },
    settings: {
      subscribe: () => pubsub.asyncIterator([TOPICS.SETTINGS]),
      resolve: (payload) => payload.settings,
    },
    automation: {
      subscribe: () => pubsub.asyncIterator([TOPICS.AUTOMATION]),
      // The scheduler publishes the raw evaluate() result; give the client the
      // same shape the Automation.state query returns.
      resolve: (payload) => ({
        result: serializeState(payload.automation?.result),
        error: payload.automation?.error || null,
      }),
    },
  },
};
