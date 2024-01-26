module.exports.typeDefs = `
  type NodeActions {
    stop: EmptyOutput!
  }
`;

module.exports.resolvers = {
  NodeActions: {
    stop (root, args, { dispatch }) {
      return dispatch('api/node/stop');
    }
  }
};
