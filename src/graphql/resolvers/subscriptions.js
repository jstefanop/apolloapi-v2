const pubsub = require('../pubsub');
const TOPICS = require('../topics');

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
  },
};
