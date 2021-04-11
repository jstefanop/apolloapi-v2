const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('start', async (payload, { knex, errors, utils }) => {
    exec('sudo systemctl start apollo-miner')
  }, {
    auth: true
  })
}
