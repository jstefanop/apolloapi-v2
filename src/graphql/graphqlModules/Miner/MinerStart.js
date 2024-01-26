module.exports.typeDefs = `
  type MinerActions {
    start: EmptyOutput!
  }
`

module.exports.resolvers = {
  MinerActions: {
    start (root, args, { dispatch }) {
      return dispatch('api/miner/start')
    }
  }
}
