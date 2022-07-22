const generateConf = require('../../../configurator');

module.exports = ({ define }) => {
  define('updateAll', async (payload, { dispatch, errors, utils }) => {
    await dispatch('api/pools/collection/updateAll', payload)
    const { items: pools } = await dispatch('api/pools/collection/read', {})
    
    await generateConf(pools);

    return {
      pools
    }
  }, {
    auth: true 
  })
}
