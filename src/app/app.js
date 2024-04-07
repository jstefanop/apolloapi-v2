const path = require('path');
const express = require('express');
const cors = require('cors');
const { knex } = require('../db');
const store = require('./../store');
const graphqlApp = require('./graphqlApp');

const app = express();

app.use(cors());

app.use('/api/graphql', graphqlApp);

const fetchStatistics = () => {
  setInterval(async () => {
    try {
      const data = await store.dispatch('api/miner/stats', { useAuth: false });
      if (!data || !data.stats) return;

      const boards = data.stats.map((board) => {
        const {
          master: {
            boardsI: voltage,
            boardsW: wattTotal,
            intervals: {
              int_3600: { chipSpeed },
              int_30: { bySol: hashrateInGh, byPool: poolHashrateInGh },
            },
          },
          slots: {
            int_0: { temperature, errorRate },
          },
          pool: {
            intervals: {
              int_0: { sharesRejected, sharesAccepted, sharesSent },
            },
          },
          fans: {
            int_0: { rpm: fanRpm },
          },
          uuid,
        } = board;

        return {
          uuid,
          hashrateInGh,
          poolHashrateInGh,
          sharesAccepted,
          sharesRejected,
          sharesSent,
          errorRate,
          wattTotal,
          temperature,
          voltage,
          chipSpeed,
          fanRpm: fanRpm && fanRpm.length && fanRpm[0],
        };
      });

      console.log('Recuperate le statistiche via API', boards);

      const insertedIds = await knex('time_series_data')
        .insert(boards)
        .returning('id');

      console.log('Inserted IDs:', insertedIds);
    } catch (error) {
      console.error(
        'Error while fetching statistics from the miner via API:',
        error
      );
    }
  }, 30000);
}

fetchStatistics();

module.exports = app;
