// tests/serviceMonitor.soloNodeGuard.test.js
// ckpool is PartOf/Requires node.service. When the node is stopped, ckpool is
// necessarily inactive too — that is NOT a manual stop. checkServiceStatus must
// not flip the solo service's requested_status to 'offline' in that case, or the
// ckpool ExecCondition would stay poisoned and ckpool could never start again.

const { knex } = require('../src/db');

const serviceMonitorFactory = require('../src/services/serviceMonitor');

let publishSpy;
beforeAll(() => {
  const pubsub = require('../src/graphql/pubsub');
  publishSpy = jest.spyOn(pubsub, 'publish').mockImplementation(() => {});
});
afterAll(() => {
  publishSpy?.mockRestore();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await knex('service_status').where({ service_name: 'solo' }).del();
});

// Build a production-path monitor with systemd states stubbed per unit.
function buildMonitor(systemdStates) {
  const monitor = serviceMonitorFactory(knex, {});
  jest.spyOn(monitor, 'isDevelopment').mockReturnValue(false);
  jest
    .spyOn(monitor, '_systemctlStatus')
    .mockImplementation(async (name) => systemdStates[name] ?? 'inactive');
  return monitor;
}

async function setSolo({ status, requestedStatus, requestedAt }) {
  await knex('service_status').where({ service_name: 'solo' }).del();
  await knex('service_status').insert({
    service_name: 'solo',
    status,
    requested_status: requestedStatus,
    requested_at: requestedAt,
    last_checked: Date.now(),
  });
}

async function getSolo() {
  return knex('service_status').where({ service_name: 'solo' }).first();
}

describe('ServiceMonitor.checkServiceStatus — solo waits on node.service', () => {
  const longAgo = Date.now() - 120_000; // well past the 90s start grace

  it('keeps requested_status online when ckpool is down because the node is down', async () => {
    await setSolo({
      status: 'online',
      requestedStatus: 'online',
      requestedAt: longAgo,
    });

    const monitor = buildMonitor({ ckpool: 'inactive', node: 'inactive' });
    await monitor.checkServiceStatus('ckpool');

    const row = await getSolo();
    expect(row.requested_status).toBe('online'); // NOT poisoned to offline
    expect(row.status).toBe('pending'); // held as pending, waiting for node
  });

  it('still flips to offline for a genuine manual stop while the node is up', async () => {
    await setSolo({
      status: 'online',
      requestedStatus: 'online',
      requestedAt: longAgo,
    });

    const monitor = buildMonitor({ ckpool: 'inactive', node: 'active' });
    await monitor.checkServiceStatus('ckpool');

    const row = await getSolo();
    expect(row.requested_status).toBe('offline');
    expect(row.status).toBe('offline');
  });
});
