export const typeDefs = `
  type PoolActions {
    updateAll (input: PoolUpdateAllInput!): PoolsUpdateOutput!
  }

  input PoolUpdateAllInputItem {
    index: Int!
    donation: Int
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

export const resolvers = {
  PoolActions: {
    updateAll (root, args, { dispatch }) {
      return dispatch('api/pools/updateAll', args.input.pools)
    }
  }
}