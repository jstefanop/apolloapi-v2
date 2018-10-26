module.exports.typeDefs = `
  type AuthActions {
    login (input: AuthLoginInput!): AuthLoginOutput!
  }

  input AuthLoginInput {
    password: String!
  }

  type AuthLoginOutput {
    result: AuthLoginResult
    error: Error
  }

  type AuthLoginResult {
    accessToken: String!
  }
`

module.exports.resolvers = {
  AuthActions: {
    login (root, args, { dispatch }) {
      return dispatch('api/auth/login', args.input)
    }
  }
}
