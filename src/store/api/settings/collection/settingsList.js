module.exports = ({ define }) => {
  define('list', async ({
    where = {},
    one,
    forUpdate
  }, {
      context: { trx } = {},
      knex
    }) => {
    const readQ = (trx || knex)('settings')

    if (where.id) {
      readQ.where('id', where.id)
    }

    readQ.select(
      'id',
      'created_at as createdAt',
      'miner_mode as minerMode',
      'voltage',
      'frequency',
      'fan_low',
      'fan_high',
      'api_allow as apiAllow',
      'custom_approval as customApproval',
      'connected_wifi as connectedWifi',
      'left_sidebar_visibility as leftSidebarVisibility',
      'left_sidebar_extended as leftSidebarExtended',
      'right_sidebar_visibility as rightSidebarVisibility',
      'temperature_unit as temperatureUnit',
      'node_rpc_password as nodeRpcPassword',
      'node_enable_tor as nodeEnableTor'
    )

    readQ.orderBy('created_at', 'desc')

    readQ.limit(10)

    if (forUpdate) {
      readQ.forUpdate()
    }

    const items = await readQ

    if (one) {
      return items[0] || null
    }

    return {
      items
    }
  })
}
