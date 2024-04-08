const path = require('path');
const express = require('express');
const cors = require('cors');
const _ = require('lodash');
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

      // Calculate totals for all boards
      const totals = boards.reduce(
        (acc, board) => {
          acc.hashrateInGh += parseFloat(board.hashrateInGh);
          acc.poolHashrateInGh += parseFloat(board.poolHashrateInGh);
          acc.sharesAccepted += parseFloat(board.sharesAccepted);
          acc.sharesRejected += parseFloat(board.sharesRejected);
          acc.sharesSent += parseFloat(board.sharesSent);
          acc.errorRate += parseFloat(board.errorRate);
          acc.wattTotal += parseFloat(board.wattTotal);
          acc.voltage += parseFloat(board.voltage);
          acc.chipSpeed += parseFloat(board.chipSpeed);
          return acc;
        },
        {
          uuid: 'totals',
          hashrateInGh: 0,
          poolHashrateInGh: 0,
          sharesAccepted: 0,
          sharesRejected: 0,
          sharesSent: 0,
          errorRate: 0,
          wattTotal: 0,
          temperature: 0,
          voltage: 0,
          chipSpeed: 0,
          fanRpm: 0,
        }
      );

      totals.uuid = 'totals';
      totals.temperature = _.meanBy(boards, 'temperature');
      totals.fanRpm = _.meanBy(boards, 'fanRpm');

      boards.push(totals);

      await knex.transaction(async (trx) => {
        // Remove old data
        await trx('time_series_data')
          .where('createdAt', '<', knex.raw("datetime('now', '-1 year')"))
          .del();
        // Insert new data
        await trx('time_series_data').insert(boards);
      });

      console.log('Time series data inserted');
    } catch (error) {
      console.error(
        'Error while fetching statistics from the miner via API:',
        error
      );
    }
  }, 30000);
};

fetchStatistics();

module.exports = app;
