module.exports.typeDefs = `
  type NodeActions {
    format: EmptyOutput!
  }
`;

module.exports.resolvers = {
  NodeActions: {
    format (root, args, { dispatch }) {
      return dispatch('api/node/format');
    }
  }
};
