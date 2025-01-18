const { knex } = require('../db');
const store = require('./../store');
const _ = require('lodash');

// Services to check (miner, node)
const SERVICES = ['miner', 'node'];

/**
 * This function updates the service status in the DB
 */
async function updateServiceStatus(serviceName, status) {
  await knex('service_status')
    .where({ service_name: serviceName })
    .update({
      status,
      last_checked: new Date()
    });
}

/**
 * This function checks and updates all services
 */
async function checkAndUpdateServices() {
  try {
    const minerStatus = await store.dispatch('api/miner/online', { useAuth: false });
    await updateServiceStatus('miner', minerStatus?.online?.status);

    const nodeStatus = await store.dispatch('api/node/online', { useAuth: false });
    await updateServiceStatus('node', nodeStatus?.online?.status);
  } catch (error) {
    console.error('Error checking services:', error);
  }
}

/**
 * Initialize the DB rows if not existing
 */
async function initServiceStatusRows() {
  for (const service of SERVICES) {
    const record = await knex('service_status')
      .where({ service_name: service })
      .first();

    if (!record) {
      await knex('service_status').insert({
        service_name: service,
        status: 'offline',
        last_checked: new Date()
      });
    }
  }
}

/**
 * This function handles fetching statistics from the miner
 */
async function fetchStatistics() {
  try {
    const minserService = await knex('service_status')
      .select('status')
      .where({ service_name: 'miner' })
      .first();

    // If the miner is not online, return
    if (minserService.status !== 'online') return;

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

    // Calculate totals
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

    totals.temperature = _.meanBy(boards, 'temperature');
    totals.fanRpm = _.meanBy(boards, 'fanRpm');
    boards.push(totals);

    // Insert into DB in a transaction
    await knex.transaction(async (trx) => {
      // Clean old data
      const rowsBefore = await trx('time_series_data').count('* as count');
      console.log('Rows before deletion:', rowsBefore[0].count);

      const deletedRows = await trx('time_series_data')
        .where('createdAt', '<', knex.raw("datetime('now', '-7 days')"))
        .del();
      console.log('Deleted rows:', deletedRows);

      const rowsAfter = await trx('time_series_data').count('* as count');
      console.log('Rows after deletion:', rowsAfter[0].count);

      // Insert new data
      await trx('time_series_data').insert(boards);
    });

    console.log('Time series data inserted');
  } catch (error) {
    console.error('Error while fetching statistics from the miner via API:', error);
  }
}

/**
 * The main function that starts all scheduled tasks
 */
async function startAllSchedulers() {
  try {
    // Initialize DB rows for miner/node status
    await initServiceStatusRows();

    // Immediately check the first time
    await checkAndUpdateServices();
    
    // Then set intervals
    setInterval(checkAndUpdateServices, 5000);
    setInterval(fetchStatistics, 30000);
  } catch (error) {
    console.error('Failed to initialize schedulers:', error);
  }
}

// Immediately invoke or export the function
startAllSchedulers();
