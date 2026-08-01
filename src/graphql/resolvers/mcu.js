// One implementation each for the mutation AND its deprecated query alias (see
// typeDefs/mcu.js): the aliases only serve pre-mutation UI bundles and must not
// drift from the real thing.
const reboot = async (_, __, { services }) => {
  try {
    await services.mcu.reboot();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

const shutdown = async (_, __, { services }) => {
  try {
    await services.mcu.shutdown();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

const update = async (_, __, { services }) => {
  try {
    await services.mcu.update();
    return { error: null };
  } catch (error) {
    return { error: { message: error.message } };
  }
};

module.exports = {
  Query: {
    Mcu: () => ({})
  },

  Mutation: {
    Mcu: () => ({})
  },

  McuMutations: {
    reboot,
    shutdown,
    update
  },

  McuActions: {
    // Deprecated aliases — see typeDefs/mcu.js.
    reboot,
    shutdown,
    update,
    stats: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getStats();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiScan: async (_, __, { services }) => {
      try {
        const result = await services.mcu.scanWifi();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiConnect: async (_, { input }, { services }) => {
      try {
        const result = await services.mcu.connectWifi(input);
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    wifiDisconnect: async (_, __, { services }) => {
      try {
        await services.mcu.disconnectWifi();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    version: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getVersion();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    },

    updateProgress: async (_, __, { services }) => {
      try {
        const result = await services.mcu.getUpdateProgress();
        return { result, error: null };
      } catch (error) {
        return { result: null, error: { message: error.message } };
      }
    }
  }
};