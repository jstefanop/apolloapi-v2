module.exports.typeDefs = `
  type Query {
    Logs: LogsActions
  }
  
  enum LogType {
    CKPOOL
    MINER
    NODE
  }
`

module.exports.resolvers = {
  Query: {
    Logs() {
      return {}
    }
  }
}