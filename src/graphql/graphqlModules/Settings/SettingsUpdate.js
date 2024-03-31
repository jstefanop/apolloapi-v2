module.exports.typeDefs = `
  type SettingsActions {
    update (input: SettingsUpdateInput!): SettingsUpdateOutput!
  }

  input SettingsUpdateInput {
    agree: Boolean
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
    nodeRpcPassword: String
    nodeEnableTor: Boolean
    nodeUserConf: String
    nodeEnableSoloMining: Boolean
    powerLedOff: Boolean
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
