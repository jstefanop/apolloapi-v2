export const typeDefs = `
  extend type AuthActions {
    setup (input: AuthSetupInput): AuthSetupOutput!
  }

  input AuthSetupInput {
    password: String!
  }

  type AuthSetupOutput {
    error: Error
  }
`

export const resolvers = {
  AuthActions: {
    setup (root, args, { dispatch }) {
      return dispatch('api/auth/setup', args.input)
    }
  }
}
