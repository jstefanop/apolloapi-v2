const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Services: ServicesActions
  }

  type ServicesActions {
    stats(input: StatusInput): StatusOutput! @auth
  }

  input StatusInput {
    serviceName: String
  }

  type StatusOutput {
    result: Status
    error: Error
  }

  type Status {
    data: [StatusData!]!
  }

  type StatusData {
    id: String
    serviceName: String
    status: String
    requestedStatus: String
    requestedAt: String
    lastChecked: String
  }
`;