module.exports.typeDefs = `
  type McuActions {
    wifiDisconnect: McuWifiDisconnectOutput!
  }

  type McuWifiDisconnectOutput {
    error: Error
  }
`

module.exports.resolvers = {
  McuActions: {
    wifiDisconnect (root, args, { dispatch }) {
      return dispatch('api/mcu/wifiDisconnect')
    }
  }
}