const { knex } = require('../db');
const utils = require('../utils');

// Import all service modules
const authService = require('./auth')(knex, utils);
const minerService = require('./miner')(knex, utils);
const poolsService = require('./pools')(knex, utils);
const nodeService = require('./node')(knex, utils);
const settingsService = require('./settings')(knex, utils);
const mcuService = require('./mcu')(knex, utils);
const timeSeriesService = require('./timeSeries')(knex);
const servicesService = require('./services')(knex);
const logsService = require('./logs')(knex);
const soloService = require('./solo')(knex, utils);

// Create service monitor with access to miner and node services
// This allows it to check application-level status in addition to systemd
const serviceMonitor = require('./serviceMonitor')(knex, {
  miner: minerService,
  node: nodeService
});

// Export all services
module.exports = {
  auth: authService,
  miner: minerService,
  pools: poolsService,
  node: nodeService,
  settings: settingsService,
  mcu: mcuService,
  timeSeries: timeSeriesService,
  services: servicesService,
  logs: logsService,
  solo: soloService,
  serviceMonitor: serviceMonitor
};