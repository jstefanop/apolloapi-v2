const gql = require('graphql-tag');

module.exports = gql`
  directive @auth on FIELD_DEFINITION

  extend type Query {
    Auth: AuthActions
  }

  enum AuthStatus { pending, done }

  type AuthActions {
    login(input: AuthLoginInput!): AuthLoginOutput!
    status: AuthStatusOutput! 
    changePassword(input: AuthChangePasswordInput!): AuthChangePasswordOutput! @auth
    setup(input: AuthSetupInput!): AuthSetupOutput!
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

  type AuthStatusOutput {
    result: AuthStatusResult
    error: Error
  }

  type AuthStatusResult {
    status: AuthStatus!
  }

  input AuthChangePasswordInput {
    password: String!
  }

  type AuthChangePasswordOutput {
    error: Error
  }

  input AuthSetupInput {
    password: String!
  }

  type AuthSetupOutput {
    error: Error
  }
`;