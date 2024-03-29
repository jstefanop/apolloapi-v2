module.exports.typeDefs = `
  type MinerActions {
    online: MinerOnlineOutput!
  }

  type MinerOnlineOutput {
    result: MinerOnlineResult
    error: Error
  }

  type MinerOnlineResult {
    online: MinerOnline!
  }

  type MinerOnline {
    timestamp: String!
    status: Boolean!
  }
`

module.exports.resolvers = {
  MinerActions: {
    online (root, args, { dispatch }) {
      return dispatch('api/miner/online')
    }
  }
}
