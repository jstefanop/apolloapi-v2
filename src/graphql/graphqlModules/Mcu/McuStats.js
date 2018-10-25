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
    totalMemoryBytes: String!
    freeMemoryBytes: String!
    cpuUsagePercent: Float!
    freeDiskBytes: String!
    totalDiskBytes: String!
  }
`

module.exports.resolvers = {
  McuActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/mcu/stats')
    }
  }
}
