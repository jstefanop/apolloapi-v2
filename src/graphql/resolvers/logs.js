module.exports = {
  Query: {
    Logs: () => ({})
  },

  LogsActions: {
    read: async (_, { input }, { services }) => {
      try {
        const result = await services.logs.read(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};