module.exports.typeDefs = `
  type PoolActions {
    update (input: PoolUpdateInput!): PoolUpdateOutput!
  }

  input PoolUpdateInput {
    id: Int!
    enabled: Boolean
    url: String
    username: String
    password: String
    proxy: String
  }

  type PoolUpdateOutput {
    result: PoolUpdateResult
    error: Error
  }

  type PoolUpdateResult {
    pool: Pool!
  }
`

module.exports.resolvers = {
  PoolActions: {
    update (root, args, { dispatch }) {
      return dispatch('api/pools/update', args.input)
    }
  }
}
