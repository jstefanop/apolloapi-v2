module.exports = {
  Query: {
    TimeSeries: () => ({})
  },

  TimeSeriesActions: {
    stats: async (_, { input }, { services }) => {
      try {
        const result = await services.timeSeries.getStats(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};