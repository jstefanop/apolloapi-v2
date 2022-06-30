const generateConf = require('../../../configurator');

module.exports = ({ define }) => {
  define('update', async (settings, { dispatch, errors, utils }) => {
    const oldSettings = await dispatch('api/settings/collection/read')
    await dispatch('api/settings/collection/update', settings)
    const newSettings = await dispatch('api/settings/collection/read')

    if (oldSettings.nodeEnableTor !== newSettings.nodeEnableTor) await utils.auth.manageTor(newSettings);

    await generateConf(null, newSettings);

    return {
      settings: newSettings
    }
  }, {
    auth: true
  })
}
