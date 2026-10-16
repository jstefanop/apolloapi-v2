const { errorPayload } = require('../errorPayload');

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
        return { success: false, error: errorPayload(error) };
      }
    },

    stop: async (_, __, { services }) => {
      try {
        await services.solo.stop();
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: errorPayload(error) };
      }
    },

    restart: async (_, __, { services }) => {
      try {
        await services.solo.restart();
        return { success: true, error: null };
      } catch (error) {
        return { success: false, error: errorPayload(error) };
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
