const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('reboot', async (payload, { knex, errors, utils }) => {
    if (process.env.NODE_ENV === 'production') return exec('sudo reboot');
    return;
  }, {
    auth: true
  })
}
