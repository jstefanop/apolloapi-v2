const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Node: NodeActions
  }

  type NodeActions {
    # start/stop: deprecated aliases for pre-mutation bundles, like format below.
    start: EmptyOutput!
      @auth
      @deprecated(
        reason: "start is a Mutation (Mutation.Node.start); this query alias only serves pre-2.1.4 UI bundles"
      )
    stop: EmptyOutput!
      @auth
      @deprecated(
        reason: "stop is a Mutation (Mutation.Node.stop); this query alias only serves pre-2.1.4 UI bundles"
      )
    stats: NodeStatsOutput!
    conf: NodeConfOutput! @auth
    # Alias for pre-mutation clients only: a UI bundle from before the move (a
    # tab left open across an update, a UI rebuild that failed) still sends
    # query { Node { format } }, and without this field that is a validation
    # error the old bundle swallows — the user is told the format started while
    # nothing ran. Single-shot per API process (see resolvers/node.js): Apollo
    # re-executes queries — the original double-wipe — so after the first
    # confirmed launch the alias refuses instead of wiping again. Remove after
    # one release cycle.
    format: EmptyOutput!
      @auth
      @deprecated(
        reason: "format is a Mutation (Mutation.Node.format); this query alias only serves pre-2.1.4 UI bundles"
      )
    formatProgress: NodeFormatProgressOutput! @auth
    online: NodeOnlineOutput!
    recentBlocks(count: Int): NodeRecentBlocksOutput!
  }

  # Side-effectful actions must NOT be queries: Apollo Client treats queries as
  # safe to re-execute, and a re-render fired the disk-wipe twice. A mutation is
  # not re-executed. start/stop carry the same hazard — a phantom re-fire stops
  # bitcoind — so they move too, with their query fields kept above as deprecated
  # aliases. (formatProgress stays a query — it is a read.)
  extend type Mutation {
    Node: NodeMutations
  }

  type NodeMutations {
    start: EmptyOutput! @auth
    stop: EmptyOutput! @auth
    format: EmptyOutput! @auth
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