const { knex } = require('../db');
const _ = require('lodash');
const services = require('../services');

// Services to monitor - all services that need DB initialization
// Note: miner and node are checked by scheduler, solo/apollo-api/apollo-ui-v2 by service monitor
const SERVICE_NAMES = ['miner', 'node', 'solo', 'apollo-api', 'apollo-ui-v2'];

/**
 * This function starts the service monitor for systemd services
 */
async function startServiceMonitor() {
  try {
    if (services.serviceMonitor) {
      await services.serviceMonitor.start();
      console.log('Service monitor started automatically');
    }
  } catch (error) {
    console.error('Error starting service monitor:', error);
  }
}

/**
 * This function updates service status in the DB
 */
async function updateServiceStatus(serviceName, status) {
  await knex('service_status').where({ service_name: serviceName }).update({
    status,
    last_checked: new Date(),
  });
}

/**
 * This function checks and updates the status of all services
 */
async function checkAndUpdateServices() {
  try {
    // Check miner status
    const minerStatus = await services.miner.checkOnline();
    await updateServiceStatus('miner', minerStatus?.online?.status);
    
    // Check node status
    const nodeStatus = await services.node.checkOnline();
    await updateServiceStatus('node', nodeStatus?.online?.status);
    
    // Note: solo, apollo-api and apollo-ui-v2 are handled by the service monitor
    // since they are systemd services, not custom services
  } catch (error) {
    console.error('Error checking services:', error);
  }
}

/**
 * Initialize DB rows if they don't exist
 */
async function initServiceStatusRows() {
  for (const service of SERVICE_NAMES) {
    const record = await knex('service_status')
      .where({ service_name: service })
      .first();

    if (!record) {
      await knex('service_status').insert({
        service_name: service,
        status: 'offline',
        last_checked: new Date(),
      });
    }
  }
}

/**
 * This function collects statistics from the miner
 */
async function fetchStatistics() {
  try {
    // Check if miner is online
    const minserService = await knex('service_status')
      .select('status')
      .where({ service_name: 'miner' })
      .first();

    // If miner is not online, return
    if (minserService.status !== 'online') return;

    // Get miner statistics
    const { stats } = await services.miner.getStats();
    if (!stats || stats.length === 0) return;

    // Process data for each board
    const boards = stats.map((board) => {
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

    // Insert data into DB in a transaction
    await knex.transaction(async (trx) => {
      // Delete old data (older than 7 days)
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
    console.error('Error while fetching statistics from the miner:', error);
  }
}

/**
 * Main function that starts all scheduled tasks
 */
async function startAllSchedulers() {
  try {
    // Initialize DB rows for service status
    await initServiceStatusRows();

    // Start service monitor for systemd services
    await startServiceMonitor();

    // Check immediately the first time
    await checkAndUpdateServices();

    // Then set intervals
    setInterval(checkAndUpdateServices, 5000); // Check every 5 seconds
    setInterval(fetchStatistics, 30000); // Collect statistics every 30 seconds
  } catch (error) {
    console.error('Failed to initialize schedulers:', error);
  }
}

// Start schedulers immediately
startAllSchedulers();
