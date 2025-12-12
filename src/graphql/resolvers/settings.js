module.exports = {
  Query: {
    Settings: () => ({})
  },

  SettingsActions: {
    list: async (_, __, { services }) => {
      try {
        const result = await services.settings.list();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    read: async (_, __, { services }) => {
      try {
        const settings = await services.settings.read();
        return { result: { settings }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    update: async (_, { input }, { services }) => {
      try {
        const settings = await services.settings.update(input);
        return { result: { settings }, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};