const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Settings: SettingsActions
  }

  enum MinerMode { eco, balanced, turbo, custom }
  enum TemperatureUnit { f, c }
  enum NodeSoftware { core_25_1, core_28_1, knots_29_2 }

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
    nodeSoftware: NodeSoftware
  }
`;