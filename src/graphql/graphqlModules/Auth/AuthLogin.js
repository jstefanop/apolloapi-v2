export const typeDefs = `
  extend type AuthActions {
    login(input: AuthLoginInput!): AuthLoginOutput!
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
`;

export const resolvers = {
  AuthActions: {
    login (root, args, { dispatch }) {
      return dispatch('api/auth/login', args.input);
    }
  }
};