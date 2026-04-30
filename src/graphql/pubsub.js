const { PubSub } = require('graphql-subscriptions');

// Singleton PubSub instance shared across scheduler, serviceMonitor, and subscription resolvers.
module.exports = new PubSub();
