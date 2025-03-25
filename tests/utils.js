const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { knex } = require('../src/db');

// Utility functions for testing

// Create authenticated user and get token
async function setupAuth() {
  // Check if setup already exists
  const setup = await knex('setup').first();

  if (!setup) {
    // Create a test user with password "testpassword"
    const hashedPassword = await bcrypt.hash('testpassword', 12);
    await knex('setup').insert({
      password: hashedPassword
    });
  }

  // Generate JWT token
  const token = jwt.sign({}, config.get('server.secret'), {
    subject: 'apollouser',
    audience: 'auth'
  });

  return token;
}

// Create a test pool
async function createTestPool(data = {}) {
  const poolData = {
    enabled: true,
    url: 'stratum.slushpool.com:3333',
    username: 'testuser.worker1',
    password: 'testpass',
    index: 1,
    ...data
  };

  const [id] = await knex('pools').insert(poolData);
  return { id, ...poolData };
}

// Create test time series data
async function createTimeSeriesData(count = 10) {
  const timeSeriesData = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    // Create entries for the last 'count' days
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    timeSeriesData.push({
      uuid: 'totals',
      hashrateInGh: 70 + Math.random() * 10,
      poolHashrateInGh: 68 + Math.random() * 10,
      sharesAccepted: 100 + Math.random() * 20,
      sharesRejected: Math.random() * 5,
      sharesSent: 105 + Math.random() * 20,
      errorRate: Math.random() * 2,
      wattTotal: 250 + Math.random() * 20,
      temperature: 55 + Math.random() * 10,
      voltage: 12 + Math.random() * 0.5,
      chipSpeed: 650 + Math.random() * 20,
      fanRpm: 3000 + Math.random() * 500,
      createdAt: date
    });
  }

  await knex('time_series_data').insert(timeSeriesData);
  return timeSeriesData;
}

// Mock service status
async function updateServiceStatus(serviceName, status) {
  await knex('service_status')
    .where({ service_name: serviceName })
    .update({
      status,
      last_checked: new Date()
    });
}

// Export utility functions
module.exports = {
  setupAuth,
  createTestPool,
  createTimeSeriesData,
  updateServiceStatus
};