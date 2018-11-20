const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('reboot', async (payload, { knex, errors, utils }) => {
    if (process.env.NODE_ENV === 'production') return exec('/etc/system_reboot.sh');
    return;
  }, {
    auth: true
  })
}
