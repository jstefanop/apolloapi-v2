module.exports = ({ define }) => {
  define('list', async (payload, { dispatch, errors, utils }) => {
    const { items: pools } = await dispatch('api/pools/collection/read', {})
    return {
      pools
    }
  })
}
