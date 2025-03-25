const gql = require('graphql-tag');

module.exports = gql`
  extend type Query {
    TimeSeries: TimeSeriesActions
  }

  type TimeSeriesActions {
    stats(input: TimeSeriesInput!): TimeSeriesStatsOutput! @auth
  }

  input TimeSeriesInput {
    startDate: String
    endDate: String
    interval: String
    itemId: String
  }

  type TimeSeriesStatsOutput {
    result: TimeSeriesStats
    error: Error
  }

  type TimeSeriesStats {
    data: [TimeSeriesData!]!
  }

  type TimeSeriesData {
    date: String
    hashrate: Float
    accepted: Float
    poolHashrate: Float
    rejected: Float
    sent: Float
    errors: Float
    watts: Float
    temperature: Float
    voltage: Float
    chipSpeed: Float
    fanRpm: Float
  }
`;