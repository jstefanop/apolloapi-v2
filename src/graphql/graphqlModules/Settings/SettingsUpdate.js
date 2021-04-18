module.exports.typeDefs = `
  type SettingsActions {
    update (input: SettingsUpdateInput!): SettingsUpdateOutput!
  }

  input SettingsUpdateInput {
    minerMode: MinerMode
    voltage: Float,
    frequency: Int,
    fan: Int,
    fan_low: Int,
    fan_high: Int,
    apiAllow: Boolean
    customApproval: Boolean
    connectedWifi: String
    leftSidebarVisibility: Boolean
    leftSidebarExtended: Boolean
    rightSidebarVisibility: Boolean
    temperatureUnit: TemperatureUnit
  }

  type SettingsUpdateOutput {
    result: SettingsUpdateResult
    error: Error
  }

  type SettingsUpdateResult {
    settings: Settings!
  }
`

module.exports.resolvers = {
  SettingsActions: {
    update (root, args, { dispatch }) {
      return dispatch('api/settings/update', args.input)
    }
  }
}
