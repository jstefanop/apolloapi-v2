module.exports.typeDefs = `
  type AuthActions {
    setup (input: AuthSetupInput): AuthSetupOutput!
  }

  input AuthSetupInput {
    password: String!
  }

  type AuthSetupOutput {
    error: Error
  }
`

module.exports.resolvers = {
  AuthActions: {
    setup (root, args, { dispatch }) {
      return dispatch('api/auth/setup', args.input)
    }
  }
}
