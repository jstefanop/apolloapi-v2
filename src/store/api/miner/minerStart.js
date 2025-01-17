const { exec } = require('child_process');
const { startDevMiner } = require('../../../devMinerService');

module.exports = ({ define }) => {
  define(
    'start',
    async (payload, { knex, errors, utils }) => {
      await knex('service_status').where({ service_name: 'miner' }).update({
        status: 'pending',
        requested_status: 'online',
        requested_at: new Date(),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('Starting dev miner...');
        startDevMiner();
      } else {
        exec('sudo systemctl start apollo-miner');
      }
    },
    {
      auth: true,
    }
  );
};
