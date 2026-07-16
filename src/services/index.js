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

// Create service monitor with access to miner, node and solo services
// This allows it to check application-level status in addition to systemd
const serviceMonitor = require('./serviceMonitor')(knex, {
  miner: minerService,
  node: nodeService,
  solo: soloService
});

// System-level MQTT: owns the broker connection, the input mappings and the
// output settings, and is the single place that (re)configures the shared client.
const mqttService = require('./mqtt/service')(knex);

// Miner scheduling & automation. Takes the services it drives explicitly, like
// serviceMonitor does, so there is no cycle through this index.
const automationService = require('./automation')(knex, {
  miner: minerService,
  settings: settingsService,
  mqtt: mqttService
});

// MQTT output: publishes the device state to the broker and (optionally) exposes
// command topics, announced to Home Assistant via MQTT Discovery. Wired after the
// services it reads/drives, like automation.
const mqttOutputService = require('./mqtt/output')(knex, {
  miner: minerService,
  settings: settingsService,
  automation: automationService,
  mqtt: mqttService
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
  serviceMonitor: serviceMonitor,
  automation: automationService,
  mqtt: mqttService,
  mqttOutput: mqttOutputService
};