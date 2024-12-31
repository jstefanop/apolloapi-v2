import { exec } from 'child_process';

export default ({ define }) => {
  define('shutdown', async (payload, { knex, errors, utils }) => {
    if (process.env.NODE_ENV === 'production') return exec('sudo shutdown -h now');
    return;
  }, {
    auth: true
  });
};
