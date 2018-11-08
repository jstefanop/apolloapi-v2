const generateConf = require('../../../configurator');

module.exports = ({ define }) => {
  define('update', async (settings, { dispatch, errors, utils }) => {
    await dispatch('api/settings/collection/update', settings)
    const newSettings = await dispatch('api/settings/collection/read')

    await generateConf(null, newSettings);

    return {
      settings: newSettings
    }
  }, {
    auth: true
  })
}
