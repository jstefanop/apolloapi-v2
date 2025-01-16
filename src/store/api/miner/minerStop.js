const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('stop', async (payload, { knex, errors, utils }) => {
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({
        status: 'pending',
        requested_status: 'offline',
        requested_at: new Date()
      });
    exec('sudo systemctl stop apollo-miner')
  }, {
    auth: true
  })
}
