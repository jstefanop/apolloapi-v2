const { exec } = require('child_process');
const { restartDevMiner } = require('../../../devMinerService');

module.exports = ({ define }) => {
  define(
    'restart',
    async (payload, { knex, errors, utils }) => {
      await knex('service_status').where({ service_name: 'miner' }).update({
        status: 'pending',
        requested_status: 'online',
        requested_at: new Date(),
      });
      if (process.env.NODE_ENV === 'development') {
        console.log('Restarting dev miner...');
        restartDevMiner();
      } else {
        exec('sudo systemctl restart apollo-miner');
      }
    },
    {
      auth: true,
    }
  );
};
