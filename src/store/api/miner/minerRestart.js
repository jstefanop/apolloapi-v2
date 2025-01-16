const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('restart', async (payload, { knex, errors, utils }) => {
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({
        status: 'pending',
        requested_status: 'online',
        requested_at: new Date()
      });
    exec('sudo systemctl restart apollo-miner')
  }, {
    auth: true
  })
}
