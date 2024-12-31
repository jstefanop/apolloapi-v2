export const typeDefs = `
  type NodeActions {
    formatProgress: NodeFormatProgressOutput!
  }

  type NodeFormatProgressOutput {
    result: NodeFormatProgressResult
    error: Error
  }

  type NodeFormatProgressResult {
    value: Int
  }
`;

export const resolvers = {
  NodeActions: {
    formatProgress: (root, args, { dispatch }) => {
      return dispatch('api/node/formatProgress');
    }
  }
};
