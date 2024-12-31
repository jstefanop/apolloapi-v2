export const typeDefs = `
  type NodeActions {
    conf: NodeConfOutput!
  }

  type NodeConfOutput {
    result: NodeConfResult
    error: Error
  }

  type NodeConfResult {
    bitcoinConf: String!
  }
`

export const resolvers = {
  NodeActions: {
    conf: (root, args, { dispatch }) => {
      return dispatch('api/node/conf')
    }
  }
}
