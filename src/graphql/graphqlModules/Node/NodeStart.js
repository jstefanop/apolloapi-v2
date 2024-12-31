export const typeDefs = `
  type NodeActions {
    start: EmptyOutput!
  }
`;

export const resolvers = {
  NodeActions: {
    start (root, args, { dispatch }) {
      return dispatch('api/node/start');
    }
  }
};
