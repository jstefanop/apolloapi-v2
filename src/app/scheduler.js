const { knex } = require('../db');
const _ = require('lodash');
const services = require('../services');

// Services that need DB initialization
// All service status updates are handled by ServiceMonitor (single source of truth)
// Scheduler only reads statuses and performs actions (e.g., collect statistics)
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
 * This function checks service statuses (read-only)
 * Status updates are handled by the ServiceMonitor
 */
async function checkServices() {
  try {
    // Just verify services are responding - no DB updates
    // The ServiceMonitor is the single source of truth for status updates
    
    // We can log status for debugging but don't update DB
    const statuses = await knex('service_status')
      .select('service_name', 'status')
      .whereIn('service_name', ['miner', 'node']);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Current service statuses:', statuses);
    }
  } catch (error) {
    console.error('Error checking services:', error);
  }
}

/**
 * Initialize DB rows if they don't exist
 * Sets default requested_status to prevent race conditions
 */
async function initServiceStatusRows() {
  for (const service of SERVICE_NAMES) {
    const record = await knex('service_status')
      .where({ service_name: service })
      .first();

    if (!record) {
      // Set default requested_status based on service type
      // This prevents the race condition where requested_status is null
      const defaultRequestedStatus = (service === 'apollo-api' || service === 'apollo-ui-v2') 
        ? 'online'  // API and UI should always be online
        : null;     // Other services start as not requested (user will decide)
      
      await knex('service_status').insert({
        service_name: service,
        status: 'unknown',  // Start as unknown until ServiceMonitor checks
        requested_status: defaultRequestedStatus,
        requested_at: defaultRequestedStatus ? new Date() : null,
        last_checked: new Date(),
      });
      
      console.log(`Initialized service status for ${service} with requested_status=${defaultRequestedStatus}`);
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

    // Start service monitor - this is the single source of truth for status updates
    await startServiceMonitor();

    // Optional: Check services for logging (read-only, no DB updates)
    await checkServices();

    // Service status checks are now handled by ServiceMonitor
    // We only need to collect statistics periodically
    setInterval(fetchStatistics, 30000); // Collect statistics every 30 seconds
  } catch (error) {
    console.error('Failed to initialize schedulers:', error);
  }
}

// Start schedulers immediately
startAllSchedulers();
