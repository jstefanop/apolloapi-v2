const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    Logs: LogsActions
  }
  
  enum LogType {
    CKPOOL
    MINER
    NODE
    SYSLOG
  }

  type LogsActions {
    read(input: LogReadInput!): LogReadOutput! @auth
  }

  input LogReadInput {
    logType: LogType!
    lines: Int
  }

  type LogReadOutput {
    result: LogReadResult
    error: Error
  }

  type LogReadResult {
    content: String!
    timestamp: String
  }
`;