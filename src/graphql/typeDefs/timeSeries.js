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
    "Aggregation interval: 'day' (default, 30 days), 'hour' (24h), '10min' (6h)"
    interval: TimeSeriesInterval
    itemId: String
    "Source of time series data: 'miner' (default) or 'solo'"
    source: TimeSeriesSource
  }

  enum TimeSeriesInterval {
    "Aggregate by day (default: last 30 days)"
    day
    "Aggregate by hour (default: last 24 hours)"
    hour
    "Aggregate by 10 minutes (default: last 6 hours)"
    tenmin
  }

  enum TimeSeriesSource {
    miner
    solo
  }

  type TimeSeriesStatsOutput {
    result: TimeSeriesStats
    error: Error
  }

  type TimeSeriesStats {
    data: [TimeSeriesData!]!
  }

  "Miner and Solo time series data (fields depend on source)"
  type TimeSeriesData {
    date: String
    "Miner fields"
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
    "Solo fields"
    users: Float
    workers: Float
    idle: Float
    disconnected: Float
    hashrate15m: Float
    bestshare: Float
  }
`;