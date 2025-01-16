const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('start', async (payload, { knex, errors, utils }) => {
    await knex('service_status')
      .where({ service_name: 'node' })
      .update({
        status: 'pending',
        requested_status: 'online',
        requested_at: new Date()
      });
    exec('sudo systemctl start node')
  },
  { auth: true })
}
