module.exports.typeDefs = `
  type Query {
    Node: NodeActions
  }
`

module.exports.resolvers = {
  Query: {
    Node () {
      return {}
    }
  }
}
