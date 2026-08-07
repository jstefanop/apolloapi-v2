// src/graphql/resolvers/pools.js
module.exports = {
  Query: {
    Pool: () => ({})
  },

  PoolActions: {
    list: async (_, __, { services }) => {
      try {
        const result = await services.pools.list();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    create: async (_, { input }, { services }) => {
      try {
        const result = await services.pools.create(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    update: async (_, { input }, { services }) => {
      try {
        const result = await services.pools.update(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    updateAll: async (_, { input }, { services }) => {
      try {
        const result = await services.pools.updateAll(input.pools);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    delete: async (_, { input }, { services }) => {
      try {
        await services.pools.delete(input);
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    }
  }
};