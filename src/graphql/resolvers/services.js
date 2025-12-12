module.exports = {
  Query: {
    Services: () => ({})
  },

  ServicesActions: {
    stats: async (_, { input }, { services }) => {
      try {
        const result = await services.services.getStats(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};