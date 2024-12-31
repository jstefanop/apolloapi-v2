export const typeDefs = `
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
    blockchainInfo: BlockchainInfo
    connectionCount: Int
    miningInfo: MiningInfo
    peerInfo: [PeerInfo]
    networkInfo: NetworkInfo
    error: LoadingError
  }

  type BlockchainInfo {
    blocks: Int
    blockTime: Int
    headers: Int
    sizeOnDisk: String
  }

  type MiningInfo {
    difficulty: Float
    networkhashps: Float
  }

  type PeerInfo {
    addr: String
    subver: String
  }

  type NetworkInfo {
    version: String
    subversion: String
    localaddresses: [LocalAddress]
  }

  type LocalAddress {
    address: String
    port: Int
    score: Int
  }

  type LoadingError {
    code: String
    message: String
  }
`

export const resolvers = {
  NodeActions: {
    stats (root, args, { dispatch }) {
      return dispatch('api/node/stats')
    }
  }
}
