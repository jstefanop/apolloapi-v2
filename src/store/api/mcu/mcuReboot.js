import { exec } from 'child_process';

export default ({ define }) => {
  define('reboot', async (payload, { knex, errors, utils }) => {
    if (process.env.NODE_ENV === 'production') return exec('sudo reboot');
    return;
  }, {
    auth: true
  });
};
