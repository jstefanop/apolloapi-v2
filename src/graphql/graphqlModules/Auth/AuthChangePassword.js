module.exports.typeDefs = `
  type AuthActions {
    changePassword (input: AuthChangePasswordInput!): AuthChangePasswordOutput!
  }

  input AuthChangePasswordInput {
    password: String!
  }

  type AuthChangePasswordOutput {
    error: Error
  }
`

module.exports.resolvers = {
  AuthActions: {
    changePassword (root, args, { dispatch }) {
      return dispatch('api/auth/changePassword', args.input)
    }
  }
}