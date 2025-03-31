const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Miner: MinerActions
  }

  type MinerActions {
    start: EmptyOutput! @auth
    stop: EmptyOutput! @auth
    restart: EmptyOutput! @auth
    stats: MinerStatsOutput!
    online: MinerOnlineOutput!
    resetBlockFoundFlag: EmptyOutput! @auth
  }

  type EmptyOutput {
    error: Error
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
    comport: String
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
    solutions: Float
    errors: Float
    errorRate: Float
    chipSpeed: Float
    chipRestarts: Int
  }

  type MinerStatsPool {
    host: String
    port: Int
    userName: String
    diff: Float
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
    count: Float
    min: Float
    avr: Float
    max: Float
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
    temperature: Float
    temperature1: Float
    ocp: Float
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
    solutions: Float
    errors: Float
    ghs: Float
    errorRate: Float
    chipRestarts: Int
    wattPerGHs: Float
    tmpAlert: MinerStatsTmpAlert
    osc: Int
    oscStopChip: String
  }

  type MinerStatsTmpAlert {
    alertLo: Int
    alertHi: Int
    numWrite: Int
  }

  type MinerStatsSlave {
    id: Int
    uid: String
    ver: String
    rx: Int
    err: Float
    time: Int
    ping: Int
  }

  type MinerStatsCkpool {
    pool: MinerStatsCkpoolPool
    users: [MinerStatsCkpoolUsers]
    blockFound: Boolean
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
    authorised: Float
    worker: [MinerStatsCkpoolWorker]
  }

  type MinerStatsCkpoolWorker {
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

  type MinerOnlineOutput {
    result: MinerOnlineResult
    error: Error
  }

  type MinerOnlineResult {
    online: MinerOnline!
  }

  type MinerOnline {
    timestamp: String!
    status: String!
  }
`;