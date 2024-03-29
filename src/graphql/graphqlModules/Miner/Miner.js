module.exports.typeDefs = `
  type Query {
    Miner: MinerActions
  }
`

module.exports.resolvers = {
  Query: {
    Miner () {
      return {}
    }
  }
}
