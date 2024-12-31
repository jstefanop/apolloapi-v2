export const typeDefs = `
  type McuActions {
    shutdown: EmptyOutput!
  }
`;

export const resolvers = {
  McuActions: {
    shutdown: (root, args, { dispatch }) => {
      return dispatch('api/mcu/shutdown');
    }
  }
};
