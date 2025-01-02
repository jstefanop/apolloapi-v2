import express from 'express';
import cors from 'cors';
import _ from 'lodash';
import { knex } from '../db.js';
import store from '../store/index.js';

// Comment in English: import our new apollo server builder
import { createApolloServer } from './graphqlServer.js';

const app = express();

app.use(express.json());

app.use(cors());

// Comment in English: We'll create and mount the Apollo middleware in an async function
async function startApollo() {
  const { apolloMiddleware } = await createApolloServer();
  app.use('/api/graphql', apolloMiddleware);
  console.log('Apollo Server mounted on /api/graphql');
}

// Comment in English: call the async function
startApollo();

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
        // Log the number of rows before deletion
        const rowsBefore = await trx('time_series_data').count('* as count');
        console.log('Rows before deletion:', rowsBefore[0].count);

        // Remove old data
        const deletedRows = await trx('time_series_data')
          .where('createdAt', '<', knex.raw("datetime('now', '-7 days')"))
          .del();
        console.log('Deleted rows:', deletedRows);

        // Log the number of rows after deletion
        const rowsAfter = await trx('time_series_data').count('* as count');
        console.log('Rows after deletion:', rowsAfter[0].count);

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
  }, process.env.TIMESERIES_INTERVAL || 30000);
};

fetchStatistics();

export default app;
