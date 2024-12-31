import { exec } from 'child_process';

export default ({ define }) => {
  define('start', async (payload, { knex, errors, utils }) => {
    exec('sudo systemctl start node');
  }, { auth: true });
};
