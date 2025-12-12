module.exports = {
  Query: {
    Solo: () => ({})
  },

  SoloActions: {
    status: async (_, __, { services }) => {
      try {
        const status = await services.solo.getStatus();
        return { result: { status }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    start: async (_, __, { services }) => {
      try {
        await services.solo.start();
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: { message: error.message } };
      }
    },

    stop: async (_, __, { services }) => {
      try {
        await services.solo.stop();
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: { message: error.message } };
      }
    },

    restart: async (_, __, { services }) => {
      try {
        await services.solo.restart();
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: { message: error.message } };
      }
    },

    stats: async (_, __, { services }) => {
      try {
        const result = await services.solo.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};
