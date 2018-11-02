module.exports.typeDefs = `
  type Query {
    Settings: SettingsActions
  }

  enum MinerMode  { eco, turbo, custom }
  enum TemperatureUnit { f, c }

  type Settings {
    id: Int!
    createdAt: String!
    minerMode: MinerMode!
    voltage: Float!
    frequency: Int!
    fan: Int!
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
