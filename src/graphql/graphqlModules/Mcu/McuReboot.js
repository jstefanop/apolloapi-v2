export const typeDefs = `
  type McuActions {
    reboot: EmptyOutput!
  }
`;

export const resolvers = {
  McuActions: {
    reboot (root, args, { dispatch }) {
      return dispatch('api/mcu/reboot');
    }
  }
};
