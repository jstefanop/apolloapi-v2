import { exec } from 'child_process';

export default ({ define }) => {
  define('restart', async (payload, { knex, errors, utils }) => {
    exec('sudo systemctl restart apollo-miner');
  }, {
    auth: true
  });
};
