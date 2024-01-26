module.exports = ({ define }) => {
  define('list', async (payload, { dispatch, errors, utils }) => {
    const { items: settings } = await dispatch('api/settings/collection/list', {})
    return {
      settings
    }
  }, {
    auth: true
  })
}
