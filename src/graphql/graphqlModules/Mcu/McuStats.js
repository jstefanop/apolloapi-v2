export const typeDefs = `
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

export const resolvers = {
  McuActions: {
    stats: (root, args, { dispatch }) => dispatch('api/mcu/stats')
  }
}
