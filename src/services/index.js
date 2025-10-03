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
const serviceMonitor = require('./serviceMonitor')(knex);
const servicesService = require('./services')(knex);
const logsService = require('./logs')(knex);
const soloService = require('./solo')(knex, utils);

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