export const typeDefs = `
  extend type AuthActions {
    status: AuthStatusOutput!
  }

  type AuthStatusOutput {
    result: AuthStatusResult
    error: Error
  }

  type AuthStatusResult {
    status: AuthStatus!
  }
`;

export const resolvers = {
  AuthActions: {
    status: (root, args, { dispatch }) => {
      return dispatch('api/auth/status', args.input);
    }
  }
};
