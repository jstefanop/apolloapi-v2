export const typeDefs = `
  type MinerActions {
    restart: EmptyOutput!
  }
`;

export const resolvers = {
  MinerActions: {
    restart: (root, args, { dispatch }) => {
      return dispatch('api/miner/restart');
    }
  }
};
