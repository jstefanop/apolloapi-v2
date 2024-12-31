export const typeDefs = `
  type Query {
    Pool: PoolActions
  }

  type Pool {
    id: Int!
    enabled: Boolean!
    donation: Int
    url: String!
    username: String
    password: String
    proxy: String
    index: Int!
  }
`;

export const resolvers = {
  Query: {
    Pool() {
      return {};
    }
  }
};
