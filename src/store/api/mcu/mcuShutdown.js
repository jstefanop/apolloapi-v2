const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('shutdown', async (payload, { knex, errors, utils }) => {
    exec('sudo shutdown now')
  }, {
    auth: true
  })
}