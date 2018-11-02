module.exports.typeDefs = `
  type MinerActions {
    stop: EmptyOutput!
  }
`

module.exports.resolvers = {
  MinerActions: {
    stop (root, args, { dispatch }) {
      return dispatch('api/miner/stop')
    }
  }
}
