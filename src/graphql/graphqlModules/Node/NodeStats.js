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
    blockchainInfo: BlockchainInfo!
    blockCount: Int
    connectionCount: Int
    miningInfo: MiningInfo!
    peerInfo: [PeerInfo!]
    error: LoadingError
  }

  type BlockchainInfo {
    blocks: Int
    initialBlockDownload: Boolean
    medianTime: Int
    verificationProgress: Float
  }

  type MiningInfo {
    difficulty: Float
    networkhashps: Float
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
