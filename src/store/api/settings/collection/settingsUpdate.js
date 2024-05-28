const updateFields = {
  minerMode: 'miner_mode',
  voltage: 'voltage',
  frequency: 'frequency',
  fan: 'fan',
  fan_low: 'fan_low',
  fan_high: 'fan_high',
  apiAllow: 'api_allow',
  customApproval: 'custom_approval',
  connectedWifi: 'connected_wifi',
  leftSidebarVisibility: 'left_sidebar_visibility',
  leftSidebarExtended: 'left_sidebar_extended',
  rightSidebarVisibility: 'right_sidebar_visibility',
  temperatureUnit: 'temperature_unit',
  powerLedOff: 'power_led_off',
  nodeRpcPassword: 'node_rpc_password',
  nodeEnableTor: 'node_enable_tor',
  nodeUserConf: 'node_user_conf',
  nodeEnableSoloMining: 'node_enable_solo_mining',
  nodeMaxConnections: 'node_max_connections',
  nodeAllowLan: 'node_allow_lan'
}

module.exports = ({ define }) => {
  define('update', async (update = {}, { dispatch, knex, errors, utils }) => {
    const newData = await dispatch('api/settings/collection/read')
    const insertData = {}
    Object.keys(update).forEach(key => newData[key] = update[key])
    Object.keys(newData).forEach(key => {
      if (key !== 'agree') insertData[updateFields[key]] = newData[key]
    })
    await knex('settings').insert(insertData)
    const last100 = knex('settings')
      .select('id')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(100)
    await knex('settings').delete().where('id', 'not in', last100)
  })
}
