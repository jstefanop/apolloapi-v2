export const typeDefs = `
  type PoolActions {
    create (input: PoolCreateInput!): PoolCreateOutput!
  }

  input PoolCreateInput {
    enabled: Boolean!
    donation: Int
    url: String!
    username: String
    password: String
    proxy: String
    index: Int
  }

  type PoolCreateOutput {
    result: PoolCreateResult
    error: Error
  }

  type PoolCreateResult {
    pool: Pool!
  }
`;

export const resolvers = {
  PoolActions: {
    create: (root, args, { dispatch }) => dispatch('api/pools/create', args.input)
  }
};
