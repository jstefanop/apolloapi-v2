export const typeDefs = `
  type McuActions {
    wifiDisconnect: McuWifiDisconnectOutput!
  }

  type McuWifiDisconnectOutput {
    error: Error
  }
`;

export const resolvers = {
  McuActions: {
    wifiDisconnect: (root, args, { dispatch }) => {
      return dispatch('api/mcu/wifiDisconnect');
    }
  }
};