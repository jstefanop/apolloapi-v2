export const typeDefs = `
  type McuActions {
    update: EmptyOutput!
  }
`;

export const resolvers = {
  McuActions: {
    update: (root, args, { dispatch }) => {
      return dispatch('api/mcu/update');
    }
  }
};
