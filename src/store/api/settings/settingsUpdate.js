const generateConf = require('../../../configurator');

module.exports = ({ define }) => {
  define(
    'update',
    async (settings, { dispatch, errors, utils }) => {
      const oldSettings = await dispatch('api/settings/collection/read');
      await dispatch('api/settings/collection/update', settings);
      const newSettings = await dispatch('api/settings/collection/read');

      if (
        oldSettings.nodeEnableTor !== newSettings.nodeEnableTor ||
        oldSettings.nodeUserConf !== newSettings.nodeUserConf ||
        oldSettings.nodeEnableSoloMining !== newSettings.nodeEnableSoloMining ||
        oldSettings.nodeRpcPassword !== newSettings.nodeRpcPassword ||
        oldSettings.nodeAllowLan !== newSettings.nodeAllowLan ||
        oldSettings.nodeMaxConnections !== newSettings.nodeMaxConnections ||
        oldSettings.btcsig !== newSettings.btcsig
      )
        await utils.auth.manageBitcoinConf(newSettings);

      await generateConf(null, newSettings);

      return {
        settings: newSettings,
      };
    },
    {
      auth: true,
    }
  );
};
