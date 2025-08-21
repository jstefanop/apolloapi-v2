const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Solo: SoloActions
  }

  type SoloActions {
    status: SoloStatusOutput! @auth
    start: SoloOutput! @auth
    stop: SoloOutput! @auth
    restart: SoloOutput! @auth
    stats: SoloStatsOutput! @auth
  }

  type SoloOutput {
    success: Boolean!
    error: Error
  }

  type SoloStatusOutput {
    result: SoloStatus
    error: Error
  }

  type SoloStatus {
    status: String
  }

  type SoloStatsOutput {
    result: SoloStats
    error: Error
  }

  type SoloStats {
    status: String
    pool: SoloStatsPool
    users: [SoloStatsUsers]
    blockFound: Boolean
    error: Error
    timestamp: String
  }

  type SoloStatsPool {
    runtime: Float
    lastupdate: Int
    Users: Int
    Workers: Int
    Idle: Int
    Disconnected: Int
    hashrate1m: String
    hashrate5m: String
    hashrate15m: String
    hashrate1hr: String
    hashrate6hr: String
    hashrate1d: String
    hashrate7d: String
    diff: Float
    accepted: Float
    rejected: Float
    bestshare: Float
    SPS1m: Float
    SPS5m: Float
    SPS15m: Float
    SPS1h: Float
  }

  type SoloStatsUsers {
    hashrate1m: String
    hashrate5m: String
    hashrate1hr: String
    hashrate1d: String
    hashrate7d: String
    lastshare: Int
    workers: Int
    shares: Float
    bestshare: Float
    bestever: Float
    authorised: Float
    worker: [SoloStatsWorker]
  }

  type SoloStatsWorker {
    workername: String
    hashrate1m: String
    hashrate5m: String
    hashrate1hr: String
    hashrate1d: String
    hashrate7d: String
    lastshare: Int
    shares: Float
    bestshare: Float
    bestever: Float
  }
`;
