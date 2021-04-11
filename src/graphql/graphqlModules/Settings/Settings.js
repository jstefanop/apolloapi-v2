module.exports.typeDefs = `
  type Query {
    Settings: SettingsActions
  }

  enum MinerMode  { eco, balanced, turbo, custom }
  enum TemperatureUnit { f, c }

  type Settings {
    id: Int!
    createdAt: String!
    minerMode: MinerMode!
    voltage: Float!
    frequency: Int!
    fan: Int!
    fan_low: Int!
    fan_high: Int!
    apiAllow: Boolean
    customApproval: Boolean
    connectedWifi: String
    leftSidebarVisibility: Boolean!
    leftSidebarExtended: Boolean!
    rightSidebarVisibility: Boolean!
    temperatureUnit: TemperatureUnit!
  }
`

module.exports.resolvers = {
  Query: {
    Settings () {
      return {}
    }
  }
}
