const { exec } = require('child_process');
const { stopDevMiner } = require('../../../devMinerService');

module.exports = ({ define }) => {
  define(
    'stop',
    async (payload, { knex, errors, utils }) => {
      await knex('service_status')
        .where({ service_name: 'miner' })
        .update({
          status: 'pending',
          requested_status: 'offline',
          requested_at: new Date(),
        });

      if (process.env.NODE_ENV === 'development') {
        console.log('Stopping dev miner...');
        stopDevMiner();
      } else {
        exec('sudo systemctl stop apollo-miner');
      }
    },
    {
      auth: true,
    }
  );
};
