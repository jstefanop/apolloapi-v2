module.exports = ({ define }) => {
  define('read', async (payload, { knex, errors, utils }) => {
    const [ settings ] = await knex('settings').select([
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
      'node_enable_tor as nodeEnableTor',
      'node_user_conf as nodeUserConf',
      'node_enable_solo_mining as nodeEnableSoloMining'
    ])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
    return settings
  })
}
