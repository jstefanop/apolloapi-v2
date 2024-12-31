export const typeDefs = `
  type McuActions {
    version: McuAppVersionOutput!
  }

  type McuAppVersionOutput {
    result: String
    error: Error
  }
`;

export const resolvers = {
  McuActions: {
    version: (root, args, { dispatch }) => {
      return dispatch('api/mcu/version');
    }
  }
};
