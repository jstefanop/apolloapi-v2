module.exports.typeDefs = `
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

module.exports.resolvers = {
  PoolActions: {
    list (root, args, { dispatch }) {
      return dispatch('api/pools/list', args.input)
    }
  }
}
