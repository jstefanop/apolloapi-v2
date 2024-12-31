export const typeDefs = `
  type MinerActions {
    start: EmptyOutput!
  }
`;

export const resolvers = {
  MinerActions: {
    start (root, args, { dispatch }) {
      return dispatch('api/miner/start');
    }
  }
};
