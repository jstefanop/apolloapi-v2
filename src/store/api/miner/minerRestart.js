const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('restart', async (payload, { knex, errors, utils }) => {
    exec('sudo systemctl restart bfgminer')
  }, {
    auth: true
  })
}
