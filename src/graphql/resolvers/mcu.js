module.exports = {
  Query: {
    Mcu: () => ({})
  },

  McuActions: {
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

    reboot: async (_, __, { services }) => {
      try {
        await services.mcu.reboot();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
      }
    },

    shutdown: async (_, __, { services }) => {
      try {
        await services.mcu.shutdown();
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

    update: async (_, __, { services }) => {
      try {
        await services.mcu.update();
        return { error: null };
      } catch (error) {
        return { error: { message: error.message } };
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