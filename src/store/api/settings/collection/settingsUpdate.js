const updateFields = {
  minerMode: 'miner_mode',
  voltage: 'voltage',
  frequency: 'frequency',
  fan: 'fan',
  connectedWifi: 'connected_wifi',
  leftSidebarVisibility: 'left_sidebar_visibility',
  leftSidebarExtended: 'left_sidebar_extended',
  rightSidebarVisibility: 'right_sidebar_visibility',
  temperatureUnit: 'temperature_unit'
}

module.exports = ({ define }) => {
  define('update', async (update = {}, { knex, errors, utils }) => {
    const updateData = {}
    Object.keys(update).forEach(key => {
      if (updateFields[key]) {
        updateData[updateFields[key]] = update[key]
      }
    })
    await knex('settings').update(updateData)
  })
}
