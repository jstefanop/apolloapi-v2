module.exports = {
  Query: {
    Miner: () => ({})
  },

  MinerActions: {
    start: async (_, __, { services }) => {
      try {
        await services.miner.start();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    stop: async (_, __, { services }) => {
      try {
        await services.miner.stop();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    restart: async (_, __, { services }) => {
      try {
        await services.miner.restart();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    stats: async (_, __, { services }) => {
      try {
        const result = await services.miner.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    online: async (_, __, { services }) => {
      try {
        const result = await services.miner.checkOnline();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};