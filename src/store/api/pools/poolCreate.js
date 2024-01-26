const generateConf = require('../../../configurator');

module.exports = ({ define }) => {
  define('create', async (payload, { dispatch, errors, utils }) => {
    const [ id ] = await dispatch('api/pools/collection/insert', payload)
    const pool = await dispatch('api/pools/collection/read', { where: { id }, one: true })

    await generateConf();

    return {
      pool
    }
  }, {
    auth: true 
  })
}
