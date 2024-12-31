import { exec } from 'child_process';

export default ({ define }) => {
  define('stop', async (payload, { knex, errors, utils }) => {
    exec('sudo systemctl stop apollo-miner');
  }, {
    auth: true
  });
};
