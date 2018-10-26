module.exports = ({ define }) => {
  define('delete', async (payload, { dispatch, errors, utils }) => {
    await dispatch('api/pools/collection/delete', payload)
  })
}
