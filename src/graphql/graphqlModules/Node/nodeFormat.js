export const typeDefs = `
  type NodeActions {
    format: EmptyOutput!
  }
`;

export const resolvers = {
  NodeActions: {
    format (root, args, { dispatch }) {
      return dispatch('api/node/format');
    }
  }
};
