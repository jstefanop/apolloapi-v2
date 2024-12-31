export const typeDefs = `
  extend type AuthActions {
    changePassword (input: AuthChangePasswordInput!): AuthChangePasswordOutput!
  }

  input AuthChangePasswordInput {
    password: String!
  }

  type AuthChangePasswordOutput {
    error: Error
  }
`;

export const resolvers = {
  AuthActions: {
    changePassword(root, args, { dispatch }) {
      return dispatch('api/auth/changePassword', args.input)
    }
  }
};