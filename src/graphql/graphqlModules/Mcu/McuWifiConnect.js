module.exports.typeDefs = `
  type McuActions {
    wifiConnect (input: McuWifiConnectInput!): McuWifiConnectOutput!
  }

  input McuWifiConnectInput {
    ssid: String!
    passphrase: String
  }

  type McuWifiConnectOutput {
    error: Error
  }
`

module.exports.resolvers = {
  McuActions: {
    wifiConnect (root, args, { dispatch }) {
      return dispatch('api/mcu/wifiConnect', args.input)
    }
  }
}