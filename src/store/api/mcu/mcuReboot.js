const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('reboot', async (payload, { knex, errors, utils }) => {
    exec('shutdown -r now')
  }, {
    auth: true
  })
}
