module.exports.typeDefs = `
  type Query {
    Pool: PoolActions
  }

  type Pool {
    id: Int!
    enabled: Boolean!
    donation: Int
    url: String!
    username: String
    password: String
    proxy: String
    index: Int!
  }
`

module.exports.resolvers = {
  Query: {
    Pool () {
      return {}
    }
  }
}
