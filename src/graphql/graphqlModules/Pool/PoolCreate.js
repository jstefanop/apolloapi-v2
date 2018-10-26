module.exports.typeDefs = `
  type PoolActions {
    create (input: PoolCreateInput!): PoolCreateOutput!
  }

  input PoolCreateInput {
    enabled: Boolean!
    url: String!
    username: String
    password: String
    proxy: String
  }

  type PoolCreateOutput {
    result: PoolCreateResult
    error: Error
  }

  type PoolCreateResult {
    pool: Pool!
  }
`

module.exports.resolvers = {
  PoolActions: {
    create (root, args, { dispatch }) {
      return dispatch('api/pools/create', args.input)
    }
  }
}
