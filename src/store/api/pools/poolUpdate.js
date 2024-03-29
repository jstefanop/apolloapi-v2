module.exports = ({ define }) => {
  define('update', async (payload, { dispatch, errors, utils }) => {
    await dispatch('api/pools/collection/update', payload)
    const pool = await dispatch('api/pools/collection/read', { where: { id: payload.id }, one: true })
    return {
      pool
    }
  }, {
    auth: true 
  })
}
