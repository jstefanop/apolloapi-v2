export const typeDefs = `
  type PoolActions {
    list: PoolListOutput!
  }

  type PoolListOutput {
    result: PoolListResult
    error: Error
  }

  type PoolListResult {
    pools: [Pool!]!
  }
`

export const resolvers = {
  PoolActions: {
    list: (root, args, { dispatch }) => {
      return dispatch('api/pools/list', args.input)
    }
  }
}
