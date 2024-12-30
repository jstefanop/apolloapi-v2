module.exports.typeDefs = `
  type Query {
    TimeSeries: TimeSeriesActions
  }
`

module.exports.resolvers = {
  Query: {
    TimeSeries() {
      return {}
    }
  }
}
