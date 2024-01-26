module.exports.typeDefs = `
  type Query {
    Auth: AuthActions
  }

  enum AuthStatus { pending, done }
`

module.exports.resolvers = {
  Query: {
    Auth () {
      return {}
    }
  }
}
