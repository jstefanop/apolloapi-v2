module.exports.typeDefs = `
  type MinerActions {
    stats: MinerStatsOutput!
  }

  type MinerStatsOutput {
    result: MinerStatsResult
    error: Error
  }

  type MinerStatsResult {
    stats: [MinerStats]
    ckpool: MinerStatsCkpool
  }

  type MinerStats {
    uuid: String
    version: String
    date: String
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
    sharesSent: Float
    sharesAccepted: Float
    sharesRejected: Float
    solutionsAccepted: Float
    minRespTime: Float
    avgRespTime: Float
    maxRespTime: Float
    shareLoss: Float
    poolTotal: Float
    inService: Int
    subscribeError: Int
    diffChanges: Float
    reconnections: Int
    reconnectionsOnErrors: Int
    defaultJobShares: Float
    staleJobShares: Float
    duplicateShares: Float
    lowDifficultyShares: Float
    pwcSharesSent: Float
    pwcSharesDropped: Float
    bigDiffShares: Float
    belowTargetShare: Float
    pwcRestart: Int
    statOverflow: Float
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
    tmpAlert: [MinerStatsSlotAlert]
    osc: Int
    oscStopChip: String
  }

  type MinerStatsSlotAlert {
    alertLo: Int
    alertHi: Int
    numWrite: Float
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

  type MinerStatsCkpool {
    pool: MinerStatsCkpoolPool
    users: [MinerStatsCkpoolUsers]
  }

  type MinerStatsCkpoolPool {
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

  type MinerStatsCkpoolUsers {
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
    authorised: Int
    worker: [MinerStatsCkpoolWorker]
  }

  type MinerStatsCkpoolWorker {
    workername: String,
    hashrate1m: String,
    hashrate5m: String,
    hashrate1hr: String,
    hashrate1d: String,
    hashrate7d: String,
    lastshare: Int,
    shares: Float,
    bestshare: Float,
    bestever: Float
  }
`;

module.exports.resolvers = {
  MinerActions: {
    stats(root, args, { dispatch }) {
      return dispatch('api/miner/stats');
    }
  }
};
