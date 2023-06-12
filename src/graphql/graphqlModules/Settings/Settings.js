module.exports.typeDefs = `
  type Query {
    Settings: SettingsActions
  }

  enum MinerMode  { eco, balanced, turbo, custom }
  enum TemperatureUnit { f, c }

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
    nodeRpcPassword: String
    nodeEnableTor: Boolean
    nodeUserConf: String
    nodeEnableSoloMining: Boolean
  }
`

module.exports.resolvers = {
  Query: {
    Settings () {
      return {}
    }
  }
}
