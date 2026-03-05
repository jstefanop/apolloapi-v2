const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Node: NodeActions
  }

  type NodeActions {
    start: EmptyOutput! @auth
    stop: EmptyOutput! @auth
    stats: NodeStatsOutput!
    conf: NodeConfOutput! @auth
    formatProgress: NodeFormatProgressOutput! @auth
    format: EmptyOutput! @auth
    online: NodeOnlineOutput!
    recentBlocks(count: Int): NodeRecentBlocksOutput!
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
    verificationprogress: Float
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
    connections_in: Int
    connections_out: Int
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

  type NodeConfOutput {
    result: NodeConfResult
    error: Error
  }

  type NodeConfResult {
    bitcoinConf: String!
  }

  type NodeFormatProgressOutput {
    result: NodeFormatProgressResult
    error: Error
  }

  type NodeFormatProgressResult {
    value: Int
  }

  type NodeOnlineOutput {
    result: NodeOnlineResult
    error: Error
  }

  type NodeOnlineResult {
    online: NodeOnline!
  }

  type NodeOnline {
    timestamp: String!
    status: String!
  }

  type NodeRecentBlocksOutput {
    result: NodeRecentBlocksResult
    error: Error
  }

  type NodeRecentBlocksResult {
    blocks: [BlockInfo!]!
    error: String
  }

  type BlockInfo {
    id: String!
    height: Int!
    version: Int!
    timestamp: Int!
    bits: Int!
    nonce: Int!
    difficulty: Float!
    merkle_root: String!
    tx_count: Int!
    size: Int!
    weight: Int!
    previousblockhash: String!
    mediantime: Int!
    stale: Boolean!
    error: String
    errorUpdatedAt: String
    extras: BlockExtras
  }

  type BlockExtras {
    reward: Float!
    coinbaseRaw: String
    totalFees: Float
    avgFee: Float
    avgFeeRate: Float
    avgTxSize: Float
    totalInputs: Int
    totalOutputs: Int
    totalOutputAmt: Float
    segwitTotalTxs: Int
    segwitTotalSize: Int
    segwitTotalWeight: Int
    virtualSize: Float
    coinbaseAddress: String
    pool: PoolInfo
  }

  type PoolInfo {
    id: Int
    name: String
    slug: String
  }
`;