module.exports.typeDefs = `
  type MinerActions {
    restart: EmptyOutput!
  }
`

module.exports.resolvers = {
  MinerActions: {
    restart (root, args, { dispatch }) {
      return dispatch('api/miner/restart')
    }
  }
}
