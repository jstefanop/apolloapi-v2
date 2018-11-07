module.exports = ({ define }) => {
  define('updateAll', async (payload, { dispatch, errors, utils }) => {
    await dispatch('api/pools/collection/updateAll', payload)
    const { items: pools } = await dispatch('api/pools/collection/read', {})
    return {
      pools
    }
  })
}
