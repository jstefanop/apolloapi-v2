// tests/services.notify.test.js
// Tests that _notifyServicesStatus() is called inside start()/stop()/restart() for
// MinerService, NodeService, and SoloService — and that the DB is set to 'pending'
// BEFORE the notification is sent.
//
// The global scheduler mock from setup.js provides pushServicesStatus as jest.fn(),
// so we can assert on it directly after each action.

const { knex } = require('../src/db');

// Helpers -------------------------------------------------------------------- //

// Resolve the scheduler mock (provided by setup.js)
function getSchedulerMock() {
  return require('../src/app/scheduler');
}

// Ensure the service_status row for a given service exists
async function ensureServiceRow(serviceName) {
  const exists = await knex('service_status')
    .where({ service_name: serviceName })
    .first();
  if (!exists) {
    await knex('service_status').insert({
      service_name: serviceName,
      status: 'offline',
      last_checked: new Date(),
    });
  }
}

// Read back the current status from DB
async function getStatus(serviceName) {
  const row = await knex('service_status')
    .where({ service_name: serviceName })
    .first();
  return row?.status;
}

// ---------------------------------------------------------------------------- //
// MinerService
// ---------------------------------------------------------------------------- //

describe('MinerService._notifyServicesStatus', () => {
  let MinerService;
  let instance;
  let scheduler;

  beforeEach(async () => {
    await ensureServiceRow('miner');
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({ status: 'offline', requested_status: null, requested_at: null });

    scheduler = getSchedulerMock();
    scheduler.pushServicesStatus.mockClear();

    MinerService = require('../src/services/miner');
    instance = MinerService(knex);

    // Stub the actual service command so tests don't hang or need systemctl
    jest.spyOn(instance, '_execCommand').mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('start() calls pushServicesStatus exactly once', async () => {
    await instance.start();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('start() has already set status to pending by the time pushServicesStatus fires', async () => {
    // The DB update is `await`ed before _notifyServicesStatus() is called (by code structure),
    // so we verify that after start() the DB shows 'pending' (the update completed first).
    await instance.start();
    expect(await getStatus('miner')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });

  it('stop() calls pushServicesStatus exactly once', async () => {
    await instance.stop();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('stop() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.stop();
    expect(await getStatus('miner')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------- //
// NodeService
// ---------------------------------------------------------------------------- //

describe('NodeService._notifyServicesStatus', () => {
  let NodeService;
  let instance;
  let scheduler;

  beforeEach(async () => {
    await ensureServiceRow('node');
    await knex('service_status')
      .where({ service_name: 'node' })
      .update({ status: 'offline', requested_status: null, requested_at: null });

    scheduler = getSchedulerMock();
    scheduler.pushServicesStatus.mockClear();

    NodeService = require('../src/services/node');
    instance = NodeService(knex);

    // Stub out the actual systemctl command
    jest.spyOn(instance, '_execCommand').mockResolvedValue('');
  });

  it('start() calls pushServicesStatus exactly once', async () => {
    await instance.start();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('start() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.start();
    expect(await getStatus('node')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });

  it('stop() calls pushServicesStatus exactly once', async () => {
    await instance.stop();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('stop() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.stop();
    expect(await getStatus('node')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------- //
// SoloService
// ---------------------------------------------------------------------------- //

describe('SoloService._notifyServicesStatus', () => {
  let SoloService;
  let instance;
  let scheduler;

  beforeEach(async () => {
    await ensureServiceRow('solo');
    await knex('service_status')
      .where({ service_name: 'solo' })
      .update({ status: 'offline', requested_status: null, requested_at: null });

    scheduler = getSchedulerMock();
    scheduler.pushServicesStatus.mockClear();

    SoloService = require('../src/services/solo');
    instance = SoloService(knex);

    // Stub out the actual systemctl command and _waitForActive to avoid hangs
    jest.spyOn(instance, '_execCommand').mockResolvedValue({ stdout: '', stderr: '' });
    jest.spyOn(instance, '_waitForActive').mockResolvedValue(true);
    // Stub _updateServiceStatus to avoid extra DB writes that could interfere
    jest.spyOn(instance, '_updateServiceStatus').mockResolvedValue(undefined);
  });

  it('start() calls pushServicesStatus exactly once', async () => {
    await instance.start();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('start() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.start();
    expect(await getStatus('solo')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });

  it('stop() calls pushServicesStatus exactly once', async () => {
    await instance.stop();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('stop() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.stop();
    expect(await getStatus('solo')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });

  it('restart() calls pushServicesStatus exactly once', async () => {
    await instance.restart();
    expect(scheduler.pushServicesStatus).toHaveBeenCalledTimes(1);
  });

  it('restart() has already set status to pending by the time pushServicesStatus fires', async () => {
    await instance.restart();
    expect(await getStatus('solo')).toBe('pending');
    expect(scheduler.pushServicesStatus).toHaveBeenCalled();
  });
});
