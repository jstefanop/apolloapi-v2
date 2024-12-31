export const typeDefs = `
  type MinerActions {
    stop: EmptyOutput!
  }
`;

export const resolvers = {
  MinerActions: {
    stop (root, args, { dispatch }) {
      return dispatch('api/miner/stop');
    }
  }
};
