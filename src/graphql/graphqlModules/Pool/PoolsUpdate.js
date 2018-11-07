module.exports.typeDefs = `
  type PoolActions {
    updateAll (input: PoolUpdateAllInput!): PoolsUpdateOutput!
  }

  input PoolUpdateAllInputItem {
    index: Int!
    enabled: Boolean!
    url: String!
    username: String
    password: String
    proxy: String
  }

  input PoolUpdateAllInput {
    pools: [PoolUpdateAllInputItem!]!
  }

  type PoolsUpdateOutput {
    result: PoolsUpdateResult
    error: Error
  }

  type PoolsUpdateResult {
    pools: [Pool!]!
  }
`

module.exports.resolvers = {
  PoolActions: {
    updateAll (root, args, { dispatch }) {
      return dispatch('api/pools/updateAll', args.input.pools)
    }
  }
}