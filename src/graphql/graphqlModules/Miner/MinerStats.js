module.exports.typeDefs = `
  type MinerActions {
    stats: MinerStatsOutput!
  }

  type MinerStatsOutput {
    result: MinerStatsResult!
    error: Error
  }

  type MinerStatsResult {
    date: Date
    statVersion: String
    versions: MinerStatsVersion
    master: MinerStatsMaster
    pool: MinerStatsPool
    fans: MinerStatsFans
    temperature: MinerStatsTemperature
    slots: MinerStatsSlots
    slaves: [MinerStatsSlave]
  }

  type MinerStatsVersion {
    miner: String
    minerDate: String
    minerDebug: String
    mspVer: String
  }

  type MinerStatsMaster {
    upTime: Int
    diff: Int
    boards: Int
    errorSpi: Int
    osc: Int
    hwAddr: String
    boardsI: Float
    boardsW: Float
    wattPerGHs: Float
    intervals: MinerStatsMasterIntervals
  }

  type MinerStatsMasterIntervals {
    int_30: MinerStatsMasterInterval
    int_300: MinerStatsMasterInterval
    int_900: MinerStatsMasterInterval
    int_3600: MinerStatsMasterInterval
    int_0: MinerStatsMasterInterval
  }

  type MinerStatsMasterInterval {
    name: String
    interval: Int
    bySol: Float
    byDiff: Float
    byPool: Float
    byJobs: Float
    solutions: Int
    errors: Int
    errorRate: Float
    chipSpeed: Float
    chipRestarts: Int
  }

  type MinerStatsPool {
    host: String
    port: Int
    userName: String
    diff: Int
    intervals: MinerStatsPoolIntervals
  }

  type MinerStatsPoolIntervals {
    int_0: MinerStatsPoolInterval
  }

  type MinerStatsPoolInterval {
    name: String
    interval: Int
    jobs: Int
    cleanFlags: Int
    sharesSent: Int
    sharesAccepted: Int
    sharesRejected: Int
    solutionsAccepted: Int
    minRespTime: Int
    avgRespTime: Int
    maxRespTime: Int
    shareLoss: Float
    poolTotal: Int
    inService: Int
    subscribeError: Int
    diffChanges: Int
    reconnections: Int
    reconnectionsOnErrors: Int
    defaultJobShares: Int
    staleJobShares: Int
    duplicateShares: Int
    lowDifficultyShares: Int
    pwcSharesSent: Int
    pwcSharesDropped: Int
    bigDiffShares: Int
    belowTargetShare: Int
    pwcRestart: Int
    statOverflow: Int
  }

  type MinerStatsFans {
    int_0: MinerStatsFan
  }

  type MinerStatsFan {
    rpm: [Int]
  }

  type MinerStatsTemperature {
    count: Int
    min: Int
    avr: Int
    max: Int
  }

  type MinerStatsSlots {
    int_0: MinerStatsSlot
  }

  type MinerStatsSlot {
    revision: Int
    spiNum: Int
    spiLen: Int
    pwrNum: Int
    pwrLen: Int
    btcNum: Int
    specVoltage: Int
    chips: Int
    pwrOn: Int
    pwrOnTarget: Int
    revAdc: Int
    temperature: Int
    temperature1: Int
    ocp: Int
    heaterErr: Int
    heaterErrNum: Int
    inOHOsc: Int
    ohOscNum: Int
    ohOscTime: Int
    overheats: Int
    overheatsTime: Int
    lowCurrRst: Int
    currents: [Int]
    brokenPwc: Int
    solutions: Int
    errors: Int
    ghs: Float
    errorRate: Float
    chipRestarts: Int
    wattPerGHs: Float
    tmpAlert: [MinerStatsSlotAlert],
    osc: Int
    oscStopChip: String
  }

  type MinerStatsSlotAlert {
    alertLo: Int
    alertHi: Int
    numWrite: Int
  }

  type MinerStatsSlave {
    id: Int
    uid: String
    ver: String
    rx: Int
    err: Int
    time: Int
    ping: Int
  }

`

module.exports.resolvers = {
  MinerActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/miner/stats')
    }
  }
}
