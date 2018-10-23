module.exports.typeDefs = `
  type AuthActions {
    status: AuthStatusOutput!
  }

  type AuthStatusOutput {
    result: AuthStatusResult
    error: Error
  }

  type AuthStatusResult {
    status: AuthStatus!
  }
`

module.exports.resolvers = {
  AuthActions: {
    status (root, args, { dispatch }) {
      return dispatch('api/auth/status', args.input)
    }
  }
}
