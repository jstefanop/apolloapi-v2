module.exports.typeDefs = `
  type TimeSeriesActions {
    stats (input: TimeSeriesInput!): TimeSeriesStatsOutput!
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
    poolHashrate: Float,
    accepted: Float,
    rejected: Float,
    sent: Float,
    errors: Float,
    watts: Float,
    temperature: Float,
    voltage: Float,
    chipSpeed: Float,
    fanRpm: Float
  }
`;

module.exports.resolvers = {
  TimeSeriesActions: {
    stats(root, args, { dispatch }) {
      return dispatch('api/timeSeries/stats', args.input);
    },
  },
};
