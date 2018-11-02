module.exports.typeDefs = `
  type MinerActions {
    stats: MinerStatsOutput!
  }

  type MinerStatsOutput {
    result: MinerStatsResult
    error: Error
  }

  type MinerStatsResult {
    stats: MinerStats!
  }

  type MinerStats {
    summary: MinerStatsSummary
    devs: MinerStatsDevs
    pools: MinerStatsPools
  }

  type MinerStatsSummary {
    status: MinerStatsStatus
    data: MinerStatsSummaryData
  }

  type MinerStatsDevs {
    status: MinerStatsStatus
    data: MinerStatsDevsData
  }

  type MinerStatsPools {
    status: MinerStatsStatus
    data: MinerStatsPoolsData
  }

  type MinerStatsStatus {
    status: String
    when: Int
    code: Int
    msg: String
    description: String
  }

  type MinerStatsSummaryData {
    elapsed: Int
    mHSAv: Float
    mHS20s: Float
    foundBlocks: Int
    getworks: Int
    accepted: Int
    rejected: Int
    hardwareErrors: Int
    utility: Float
    discarded: Int
    stale: Int
    getFailures: Int
    localWork: Int
    remoteFailures: Int
    networkBlocks: Int
    totalMH: Float
    diff1Work: Float
    workUtility: Float
    difficultyAccepted: Float
    difficultyRejected: Int
    difficultyStale: Int
    bestShare: Float
    deviceHardware: Float
    deviceRejected: Int
    poolRejected: Int
    poolStale: Int
    lastGetwork: Int
  }

  type MinerStatsDevsData {
    pga: Int
    name: String
    id: Int
    enabled: String
    status: String
    deviceElapsed: Int
    mHSAv: Float
    mHS20s: Float
    mHSRolling: Float
    accepted: Int
    rejected: Int
    hardwareErrors: Int
    utility: Float
    stale: Int
    lastSharePool: Int
    lastShareTime: Int
    totalMH: Float
    diff1Work: Float
    workUtility: Float
    difficultyAccepted: Float
    difficultyRejected: Int
    difficultyStale: Int
    lastShareDifficulty: Float
    lastValidWork: Int
    deviceHardware: Float
    deviceRejected: Int
  }

  type MinerStatsPoolsData {
    pool: Int
    url: String
    status: String
    priority: Int
    quota: Int
    miningGoal: String
    longPoll: String
    getworks: Int
    accepted: Int
    rejected: Int
    works: Int
    discarded: Int
    stale: Int
    getFailures: Int
    remoteFailures: Int
    user: String
    lastShareTime: Int
    diff1Shares: Int
    proxy: String
    difficultyAccepted: Int
    difficultyRejected: Int
    difficultyStale: Int
    lastShareDifficulty: Int
    hasStratum: Boolean
    stratumActive: Boolean
    stratumURL: String
    bestShare: Int
    poolRejected: Int
    poolStale: Int
  }
`

module.exports.resolvers = {
  MinerActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/miner/stats')
    }
  }
}
