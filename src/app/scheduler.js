const { knex } = require('../db');
const _ = require('lodash');
const services = require('../services');

/**
 * Parse hashrate string (e.g., "810M", "3.2T", "1.5G") to GH/s
 * @param {string} hashrateStr - Hashrate string with suffix (K, M, G, T, P)
 * @returns {number} - Hashrate in GH/s
 */
function parseHashrateToGhs(hashrateStr) {
  if (!hashrateStr || typeof hashrateStr !== 'string') return 0;

  const match = hashrateStr.match(/^([\d.]+)([KMGTP]?)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const suffix = match[2].toUpperCase();

  // Convert to GH/s
  const multipliers = {
    K: 1e-6,  // Kilo to Giga
    M: 1e-3,  // Mega to Giga
    G: 1,     // Giga (base)
    T: 1e3,   // Tera to Giga
    P: 1e6,   // Peta to Giga
  };

  return value * (multipliers[suffix] || 1);
}

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
      // Delete old data (older than 30 days)
      const rowsBefore = await trx('time_series_data').count('* as count');
      console.log('Rows before deletion:', rowsBefore[0].count);

      const deletedRows = await trx('time_series_data')
        .where('createdAt', '<', knex.raw("datetime('now', '-30 days')"))
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
 * This function collects statistics from the solo pool (ckpool)
 */
async function fetchSoloStatistics() {
  try {
    // Check if solo is online
    const soloService = await knex('service_status')
      .select('status')
      .where({ service_name: 'solo' })
      .first();

    // If solo is not online, return
    if (!soloService || soloService.status !== 'online') return;

    // Get solo pool statistics
    const stats = await services.solo.getStats();
    if (!stats || !stats.pool) return;

    const { pool } = stats;

    // Prepare data for insertion
    const soloData = {
      users: pool.Users || 0,
      workers: pool.Workers || 0,
      idle: pool.Idle || 0,
      disconnected: pool.Disconnected || 0,
      hashrate15m: parseHashrateToGhs(pool.hashrate15m),
      accepted: pool.accepted || 0,
      rejected: pool.rejected || 0,
      bestshare: pool.bestshare || 0,
    };

    // Insert data into DB in a transaction
    await knex.transaction(async (trx) => {
      // Delete old data (older than 30 days)
      const rowsBefore = await trx('time_series_solo_data').count('* as count');
      console.log('Solo rows before deletion:', rowsBefore[0].count);

      const deletedRows = await trx('time_series_solo_data')
        .where('createdAt', '<', knex.raw("datetime('now', '-30 days')"))
        .del();
      console.log('Solo deleted rows:', deletedRows);

      const rowsAfter = await trx('time_series_solo_data').count('* as count');
      console.log('Solo rows after deletion:', rowsAfter[0].count);

      // Insert new data
      await trx('time_series_solo_data').insert(soloData);
    });

    console.log('Time series solo data inserted');
  } catch (error) {
    console.error('Error while fetching statistics from solo pool:', error);
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
    setInterval(fetchStatistics, process.env.TIMESERIES_INTERVAL || 60000); // Collect miner statistics every 60 seconds
    setInterval(fetchSoloStatistics, process.env.TIMESERIES_INTERVAL || 60000); // Collect solo statistics every 60 seconds
  } catch (error) {
    console.error('Failed to initialize schedulers:', error);
  }
}

// Start schedulers immediately
startAllSchedulers();
