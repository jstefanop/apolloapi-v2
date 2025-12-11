const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Mcu: McuActions
  }

  type McuActions {
    stats: McuStatsOutput! @auth
    wifiScan: McuWifiScanOutput! @auth
    wifiConnect(input: McuWifiConnectInput!): McuWifiConnectOutput! @auth
    wifiDisconnect: McuWifiDisconnectOutput! @auth
    reboot: EmptyOutput! @auth
    shutdown: EmptyOutput! @auth
    version: McuAppVersionOutput! @auth
    update: EmptyOutput! @auth
    updateProgress: McuUpdateProgressOutput! @auth
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
    hostname: String
    operatingSystem: String
    uptime: String
    loadAverage: String
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

  type McuWifiScanOutput {
    result: McuWifiScanResult
    error: Error
  }

  type McuWifiScanResult {
    wifiScan: [McuWifiScan]
  }

  type McuWifiScan {
    ssid: String
    mode: String
    channel: Int
    rate: Int
    signal: Int
    security: String
    inuse: Boolean
  }

  input McuWifiConnectInput {
    ssid: String!
    passphrase: String
  }

  type McuWifiConnectOutput {
    result: McuWifiConnectResult
    error: Error
  }

  type McuWifiConnectResult {
    address: String!
  }

  type McuWifiDisconnectOutput {
    error: Error
  }

  type McuAppVersionOutput {
    result: String
    error: Error
  }

  type McuUpdateProgressOutput {
    result: McuUpdateProgressResult
    error: Error
  }

  type McuUpdateProgressResult {
    value: Int
  }
`;