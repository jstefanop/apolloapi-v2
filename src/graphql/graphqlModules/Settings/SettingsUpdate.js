export const typeDefs = `
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
    powerLedOff: Boolean
    nodeRpcPassword: String
    nodeEnableTor: Boolean
    nodeUserConf: String
    nodeEnableSoloMining: Boolean
    nodeMaxConnections: Int
    nodeAllowLan: Boolean
    btcsig: String
  }

  type SettingsUpdateOutput {
    result: SettingsUpdateResult
    error: Error
  }

  type SettingsUpdateResult {
    settings: Settings!
  }
`

export const resolvers = {
  SettingsActions: {
    update (root, args, { dispatch }) {
      return dispatch('api/settings/update', args.input)
    }
  }
}
