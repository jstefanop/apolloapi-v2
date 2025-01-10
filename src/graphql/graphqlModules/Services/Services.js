module.exports.typeDefs = `
  type Query {
    Services: ServicesActions
  }
`

module.exports.resolvers = {
  Query: {
    Services() {
      return {}
    }
  }
}
