// tests/serviceMonitor.gracePeriod.test.js
// Tests for the grace-period logic inside ServiceMonitor.checkServiceStatusDevelopment().
// This logic prevents status oscillation when an action (start/stop) was recently issued:
// if the service still returns 'pending' from the health check but a recent requested_at
// indicates an explicit action, the DB status is preserved instead of being downgraded.

const { knex } = require('../src/db');

jest.setTimeout(10000);

// serviceMonitor.js exports a factory function, not the class directly.
const serviceMonitorFactory = require('../src/services/serviceMonitor');

// Spy on pubsub.publish to prevent noise from updateServiceStatus
let publishSpy;
beforeAll(() => {
  const pubsub = require('../src/graphql/pubsub');
  publishSpy = jest.spyOn(pubsub, 'publish').mockImplementation(() => {});
});
afterAll(() => {
  publishSpy?.mockRestore();
});

// Helper: build a ServiceMonitor instance with a mocked miner.checkOnline()
function buildMonitor(checkOnlineImpl) {
  return serviceMonitorFactory(knex, {
    miner: { checkOnline: checkOnlineImpl },
  });
}

// Helper: set up the service_status row for 'miner' with explicit timestamps
async function setMinerStatus({ status, requestedStatus, requestedAt }) {
  await knex('service_status').where({ service_name: 'miner' }).del();
  await knex('service_status').insert({
    service_name: 'miner',
    status,
    requested_status: requestedStatus || null,
    requested_at: requestedAt || null,
    last_checked: Date.now(),
  });
}

// Helper: read back what ended up in the DB
async function getMinerStatus() {
  return knex('service_status')
    .where({ service_name: 'miner' })
    .first();
}

describe('ServiceMonitor.checkServiceStatusDevelopment — grace period', () => {
  // Force development mode so checkServiceStatusDevelopment path is taken
  let origEnv;
  beforeAll(() => {
    origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
  });
  afterAll(() => {
    process.env.NODE_ENV = origEnv;
  });

  // ------------------------------------------------------------------ //
  // Case 1: within start grace — status stays 'online'
  // ------------------------------------------------------------------ //
  it('Case 1 (within start grace): does NOT downgrade online→pending when requested_at < 45s ago', async () => {
    // Simulate: user clicked "Start", DB was set to online, but checkOnline still returns pending
    const recentStart = Date.now() - 10_000; // 10s ago — inside 45s grace
    await setMinerStatus({
      status: 'online',
      requestedStatus: 'online',
      requestedAt: recentStart,
    });

    // Health check returns 'pending' (service still starting up)
    const monitor = buildMonitor(() =>
      Promise.resolve({ online: { status: 'pending' } })
    );

    await monitor.checkServiceStatusDevelopment('apollo-miner', 'miner');

    const row = await getMinerStatus();
    expect(row.status).toBe('online'); // preserved
  });

  // ------------------------------------------------------------------ //
  // Case 2: past start grace — status is updated to 'pending'
  // ------------------------------------------------------------------ //
  it('Case 2 (past start grace): downgrades online→pending when requested_at > 45s ago', async () => {
    const oldStart = Date.now() - 60_000; // 60s ago — outside 45s grace
    await setMinerStatus({
      status: 'online',
      requestedStatus: 'online',
      requestedAt: oldStart,
    });

    const monitor = buildMonitor(() =>
      Promise.resolve({ online: { status: 'pending' } })
    );

    await monitor.checkServiceStatusDevelopment('apollo-miner', 'miner');

    const row = await getMinerStatus();
    expect(row.status).toBe('pending'); // downgraded after grace period expired
  });

  // ------------------------------------------------------------------ //
  // Case 3: within stop grace — status stays 'offline'
  // ------------------------------------------------------------------ //
  it('Case 3 (within stop grace): does NOT downgrade offline→pending when requested_at < 20s ago', async () => {
    const recentStop = Date.now() - 5_000; // 5s ago — inside 20s grace
    await setMinerStatus({
      status: 'offline',
      requestedStatus: 'offline',
      requestedAt: recentStop,
    });

    const monitor = buildMonitor(() =>
      Promise.resolve({ online: { status: 'pending' } })
    );

    await monitor.checkServiceStatusDevelopment('apollo-miner', 'miner');

    const row = await getMinerStatus();
    expect(row.status).toBe('offline'); // preserved
  });

  // ------------------------------------------------------------------ //
  // Case 4: no requested_at — raw check result is applied
  // ------------------------------------------------------------------ //
  it('Case 4 (no requested_at): applies raw health-check status without any grace override', async () => {
    await setMinerStatus({
      status: 'online',
      requestedStatus: null,
      requestedAt: null,
    });

    const monitor = buildMonitor(() =>
      Promise.resolve({ online: { status: 'pending' } })
    );

    await monitor.checkServiceStatusDevelopment('apollo-miner', 'miner');

    const row = await getMinerStatus();
    expect(row.status).toBe('pending'); // no grace, raw result applied
  });
});
