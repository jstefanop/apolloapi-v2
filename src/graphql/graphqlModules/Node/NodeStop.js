export const typeDefs = `
  type NodeActions {
    stop: EmptyOutput!
  }
`;

export const resolvers = {
  NodeActions: {
    stop (root, args, { dispatch }) {
      return dispatch('api/node/stop');
    }
  }
};
