module.exports.typeDefs = `
  type McuActions {
    wifiConnect (input: McuWifiConnectInput!): McuWifiConnectOutput!
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
`

module.exports.resolvers = {
  McuActions: {
    wifiConnect (root, args, { dispatch }) {
      return dispatch('api/mcu/wifiConnect', args.input)
    }
  }
}