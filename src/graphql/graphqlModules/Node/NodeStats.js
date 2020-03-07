module.exports.typeDefs = `
  type NodeActions {
    stats: NodeStatsOutput!
  }

  type NodeStatsOutput {
    result: NodeStatsResult
    error: Error
  }

  type NodeStatsResult {
    stats: NodeStats!
  }

  type NodeStats {
    timestamp: String!
    hostname: String,
    operatingSystem: String
    uptime: String
    loadAverage: String,
    architecture: String
    temperature: Int
    minerTemperature: Float
    minerFanSpeed: Int
    bfgminerLog: String
    activeWifi: String
    network: [NetworkStats!]
    memory: MemoryStats
    cpu: CpuStats
    disks: [DiskStats!]
  }

  type MemoryStats {
    total: Float
    available: Float
    used: Float
    cache: Float
    swap: Float
  }

  type CpuStats {
    threads: Int
    usedPercent: Float
  }

  type NetworkStats {
    name: String
    address: String
    mac: String
  }

  type DiskStats {
    total: Float
    used: Float
    mountPoint: String
  }
`

module.exports.resolvers = {
  NodeActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/node/stats')
    }
  }
}
