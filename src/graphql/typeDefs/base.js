const gql = require('graphql-tag');

module.exports = gql`
  directive @auth on FIELD_DEFINITION

  type Query {
    _: Boolean
  }

  type Mutation {
    _: Boolean
  }

  type Error {
    message: String!
    path: String
    type: String
    severity: String
    reasons: [ErrorReason]
  }

  type ErrorReason {
    path: String
    message: String
    reason: String
  }
`;