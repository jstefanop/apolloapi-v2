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
    # reboot/shutdown/update: deprecated aliases for pre-mutation UI bundles —
    # see the NodeActions aliases for the rationale.
    reboot: EmptyOutput!
      @auth
      @deprecated(
        reason: "reboot is a Mutation (Mutation.Mcu.reboot); this query alias only serves pre-2.1.4 UI bundles"
      )
    shutdown: EmptyOutput!
      @auth
      @deprecated(
        reason: "shutdown is a Mutation (Mutation.Mcu.shutdown); this query alias only serves pre-2.1.4 UI bundles"
      )
    version: McuAppVersionOutput! @auth
    update: EmptyOutput!
      @auth
      @deprecated(
        reason: "update is a Mutation (Mutation.Mcu.update); this query alias only serves pre-2.1.4 UI bundles"
      )
    updateProgress: McuUpdateProgressOutput! @auth
  }

  # Side-effectful actions must not be queries — Apollo Client re-executes
  # queries on re-render (see typeDefs/node.js), and a phantom re-fire here
  # reboots the device or launches a second concurrent update.
  extend type Mutation {
    Mcu: McuMutations
  }

  type McuMutations {
    reboot: EmptyOutput! @auth
    shutdown: EmptyOutput! @auth
    update: EmptyOutput! @auth
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