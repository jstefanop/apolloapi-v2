module.exports.typeDefs = `
  type LogsActions {
    read(input: LogReadInput!): LogReadOutput!
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
`

module.exports.resolvers = {
  LogsActions: {
    read(root, args, { dispatch }) {
      return dispatch('api/logs/read', args.input);
    }
  }
}