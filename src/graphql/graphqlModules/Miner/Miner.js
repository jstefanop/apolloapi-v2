export const typeDefs = `
  type Query {
    Miner: MinerActions
  }
`;

export const resolvers = {
  Query: {
    Miner() {
      return {};
    }
  }
};
