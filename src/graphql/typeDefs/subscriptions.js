const gql = require('graphql-tag');

module.exports = gql`
  extend type Subscription {
    miner: MinerSubscriptionPayload
    node: NodeStatsOutput
    mcu: McuStatsOutput
    solo: SoloStatsOutput
    services: StatusOutput
    settings: SettingsUpdateOutput
  }

  type MinerSubscriptionPayload {
    stats: MinerStatsOutput
    online: MinerOnlineOutput
  }
`;
