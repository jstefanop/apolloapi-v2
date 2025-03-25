module.exports = {
  Query: {
    Node: () => ({})
  },

  NodeActions: {
    start: async (_, __, { services }) => {
      try {
        await services.node.start();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    stop: async (_, __, { services }) => {
      try {
        await services.node.stop();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    stats: async (_, __, { services }) => {
      try {
        const result = await services.node.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    conf: async (_, __, { services }) => {
      try {
        const result = await services.node.getConf();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    formatProgress: async (_, __, { services }) => {
      try {
        const result = await services.node.getFormatProgress();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    format: async (_, __, { services }) => {
      try {
        await services.node.format();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    online: async (_, __, { services }) => {
      try {
        const result = await services.node.checkOnline();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};