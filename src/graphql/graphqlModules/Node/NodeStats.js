module.exports.typeDefs = `
  type NodeActions {
    stats: NodeStatsOutput!
  }

  type NodeStatsOutput {
    result: NodeStatsResult
    error: Error
  }

  type NodeStatsResult {
    stats: NodeStats!
  }

  type NodeStats {
    timestamp: String!
    blockCount: Int
    connectionCount: Int
    peerInfo: [PeerInfo!]
    error: LoadingError
  }

  type PeerInfo {
    addr: String
    subver: String
  }

  type LoadingError {
    code: String
    message: String
  }
`

module.exports.resolvers = {
  NodeActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/node/stats')
    }
  }
}
