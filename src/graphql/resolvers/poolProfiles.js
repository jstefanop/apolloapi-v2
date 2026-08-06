// src/graphql/resolvers/poolProfiles.js
module.exports = {
  Query: {
    PoolProfiles: () => ({}),
  },

  Mutation: {
    PoolProfiles: () => ({}),
  },

  PoolProfileActions: {
    list: async (_, __, { services }) => {
      try {
        const result = await services.poolProfiles.list();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },
  },

  PoolProfileMutations: {
    save: async (_, { input }, { services }) => {
      try {
        const result = await services.poolProfiles.save(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },
  },
};
