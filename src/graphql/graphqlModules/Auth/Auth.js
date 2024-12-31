export const typeDefs = `
  type Query {
    Auth: AuthActions
  }

  enum AuthStatus { pending, done }

  type AuthActions {
    _dummy: String
  }
`;

export const resolvers = {
  Query: {
    Auth() {
      return {};
    }
  },
  AuthActions: {
    _dummy: () => "placeholder",
  },
};