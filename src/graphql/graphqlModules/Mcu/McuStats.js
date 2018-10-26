module.exports.typeDefs = `
  type McuActions {
    stats: McuStatsOutput!
  }

  type McuStatsOutput {
    result: McuStatsResult
    error: Error
  }

  type McuStatsResult {
    stats: McuStats!
  }

  type McuStats {
    timestamp: String!
    hostname: String,
    operatingSystem: String
    uptime: String
    loadAverage: String,
    architecture: String
    temperature: String
    memory: MemoryStats
    cpu: CpuStats
    disks: [DiskStats!]
  }

  type MemoryStats {
    total: Float
    used: Float
    cache: Float
    swap: Float
  }

  type CpuStats {
    threads: Int
    usedPercent: Float
  }

  type DiskStats {
    total: Float
    used: Float
    mountPoint: String
  }
`

module.exports.resolvers = {
  McuActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/mcu/stats')
    }
  }
}
