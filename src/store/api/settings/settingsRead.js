module.exports = ({ define }) => {
  define('read', async (payload, { dispatch, errors, utils }) => {
    const settings = await dispatch('api/settings/collection/read')
    return {
      settings
    }
  }, {
    auth: true
  })
}
