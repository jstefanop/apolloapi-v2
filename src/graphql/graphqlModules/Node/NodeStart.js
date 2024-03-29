module.exports.typeDefs = `
  type NodeActions {
    start: EmptyOutput!
  }
`;

module.exports.resolvers = {
  NodeActions: {
    start (root, args, { dispatch }) {
      return dispatch('api/node/start');
    }
  }
};
