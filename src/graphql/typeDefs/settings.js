const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Settings: SettingsActions
  }

  # super_eco is Apollo III only; the USB miners fall back to eco.
  enum MinerMode { super_eco, eco, balanced, turbo, custom }
  enum TemperatureUnit { f, c }
  enum NodeSoftware { core_25_1, core_28_1, core_29_2, core_31_0, knots_29_2, knots_29_3 }

  type SettingsActions {
    list: SettingListOutput! @auth
    read: SettingsUpdateOutput! @auth
    update(input: SettingsUpdateInput!): SettingsUpdateOutput! @auth
  }

  type SettingListOutput {
    result: SettingListResult
    error: Error
  }

  type SettingListResult {
    settings: [Settings!]!
  }

  type SettingsUpdateOutput {
    result: SettingsUpdateResult
    error: Error
  }

  type SettingsUpdateResult {
    settings: Settings!
  }

  input SettingsUpdateInput {
    agree: Boolean
    minerMode: MinerMode
    voltage: Float
    frequency: Int
    fan: Int
    fan_low: Int
    fan_high: Int
    "Apollo III custom mode: target hashrate in TH/s (5-22). Replaces voltage/frequency, which the III tunes internally."
    minerHashrate: Int
    "Apollo III: automatic fan target temperature in C (40-80)."
    fanTemp: Int
    "Apollo III: fixed fan PWM percent (10-100). Overrides fanTemp."
    fanPwm: Int
    apiAllow: Boolean
    customApproval: Boolean
    connectedWifi: String
    leftSidebarVisibility: Boolean
    leftSidebarExtended: Boolean
    rightSidebarVisibility: Boolean
    temperatureUnit: TemperatureUnit
    powerLedOff: Boolean
    nodeRpcPassword: String
    nodeEnableTor: Boolean
    nodeUserConf: String
    nodeEnableSoloMining: Boolean
    nodeMaxConnections: Int
    nodeAllowLan: Boolean
    btcsig: String
    startdiff: Int
    mindiff: Int
    nodeSoftware: NodeSoftware
  }

  type Settings {
    id: Int!
    agree: Boolean
    createdAt: String!
    minerMode: MinerMode!
    voltage: Float!
    frequency: Int!
    fan: Int
    fan_low: Int!
    fan_high: Int!
    minerHashrate: Int
    fanTemp: Int
    fanPwm: Int
    apiAllow: Boolean
    customApproval: Boolean
    connectedWifi: String
    leftSidebarVisibility: Boolean!
    leftSidebarExtended: Boolean!
    rightSidebarVisibility: Boolean!
    temperatureUnit: TemperatureUnit!
    powerLedOff: Boolean
    nodeRpcPassword: String
    nodeEnableTor: Boolean
    nodeUserConf: String
    nodeEnableSoloMining: Boolean
    nodeMaxConnections: Int
    nodeAllowLan: Boolean
    btcsig: String
    startdiff: Int
    mindiff: Int
    nodeSoftware: NodeSoftware
  }
`;