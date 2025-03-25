module.exports = {
  Query: {
    Auth: () => ({})
  },

  AuthActions: {
    login: async (_, { input }, { services }) => {
      try {
        const result = await services.auth.login(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    status: async (_, __, { services }) => {
      try {
        const result = await services.auth.status();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    changePassword: async (_, { input }, { services }) => {
      try {
        await services.auth.changePassword(input);
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    setup: async (_, { input }, { services }) => {
      try {
        await services.auth.setup(input);
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    }
  }
};