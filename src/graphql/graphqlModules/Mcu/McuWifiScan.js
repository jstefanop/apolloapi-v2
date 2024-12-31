export const typeDefs = `
  type McuActions {
    wifiScan: McuWifiScanOutput!
  }

  type McuWifiScanOutput {
    result: McuWifiScanResult
    error: Error
  }

  type McuWifiScanResult {
    wifiScan: [McuWifiScan]
  }

  type McuWifiScan {
    ssid: String
    mode: String
    channel: Int
    rate: Int
    signal: Int
    security: String
    inuse: Boolean
  }
`

export const resolvers = {
  McuActions: {
    wifiScan (root, args, { dispatch }) {
      return dispatch('api/mcu/wifiScan')
    }
  }
}