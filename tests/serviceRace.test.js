// Scenarios a reviewer proved against the first version of transition.js
// (two overlapping requests, and what `systemctl` is asked to do).

const { knex } = require('../src/db');

const execed = [];
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    exec: (cmd, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      execed.push(cmd);
      if (typeof cb !== 'function') return;
      if (!/is-active/.test(cmd)) return cb(null, { stdout: '', stderr: '' });
      const value = global.__systemd || 'inactive';
      if (value === 'active') return cb(null, { stdout: 'active\n', stderr: '' });
      const err = new Error(value);
      err.code = value === 'failed' ? 4 : 3;
      err.stdout = value;
      return cb(err, { stdout: value, stderr: '' });
    },
  };
});

const row = (n) => knex('service_status').where({ service_name: n }).first();
const set = async (n, r) => {
  await knex('service_status').where({ service_name: n }).del();
  await knex('service_status').insert({ service_name: n, last_checked: Date.now(), ...r });
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  for (const m of ['log', 'error', 'warn']) jest.spyOn(console, m).mockImplementation(() => {});
  execed.length = 0;
  global.__systemd = undefined;
});

describe('S1: two requests for one service, both refused', () => {
  it('ends on the original row, never on a request that was itself refused', async () => {
    const original = { status: 'offline', requested_status: 'offline', requested_at: 1000 };
    await set('node', original);
    const node = require('../src/services/node')(knex);
    const a = deferred();
    const b = deferred();
    const exec = jest
      .spyOn(node, '_execCommand')
      .mockImplementationOnce(() => a.promise) // start
      .mockImplementationOnce(() => b.promise); // stop

    const started = node.start().catch((e) => e);
    await tick();
    const stopped = node.stop().catch((e) => e);
    await tick();

    // The stop waits its turn: the start is the only command in flight.
    expect(exec).toHaveBeenCalledTimes(1);

    a.reject(new Error('refused A'));
    await started;
    await tick();
    b.reject(new Error('refused B'));
    await stopped;

    const after = await row('node');
    expect(after.status).toBe(original.status);
    expect(after.requested_status).toBe(original.requested_status);
    expect(Number(after.requested_at)).toBe(original.requested_at);
  });

  it('the monitor then has nothing to restart', async () => {
    await set('node', { status: 'offline', requested_status: 'offline', requested_at: 1000 });
    const node = require('../src/services/node')(knex);
    jest.spyOn(node, '_execCommand').mockRejectedValue(new Error('refused'));
    await Promise.allSettled([node.start(), node.stop()]);

    global.__systemd = 'failed';
    const monitor = require('../src/services/serviceMonitor')(knex, {});
    await monitor.checkServiceStatus('node', false);

    expect(execed.filter((c) => /systemctl (re)?start/.test(c))).toEqual([]);
  });

  it('a refused request does not hold up the next one', async () => {
    await set('node', { status: 'offline', requested_status: 'offline', requested_at: 1000 });
    const node = require('../src/services/node')(knex);
    jest
      .spyOn(node, '_execCommand')
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const first = node.start().catch((e) => e);
    const second = node.start();
    await expect(second).resolves.toBeUndefined();
    expect((await first).extensions.code).toBe('SERVICE_COMMAND_FAILED');
    expect((await row('node')).requested_status).toBe('online');
  });
});

describe('S3: the command only has to be accepted', () => {
  const cases = [
    ['node', 'start', 'sudo systemctl start --no-block node'],
    ['node', 'stop', 'sudo systemctl stop --no-block node'],
    ['miner', 'start', 'sudo systemctl start --no-block apollo-miner'],
    ['miner', 'stop', 'sudo systemctl stop --no-block apollo-miner'],
    ['miner', 'restart', 'sudo systemctl restart --no-block apollo-miner'],
    ['solo', 'start', 'sudo systemctl start --no-block ckpool'],
    ['solo', 'stop', 'sudo systemctl stop --no-block ckpool'],
    ['solo', 'restart', 'sudo systemctl restart --no-block ckpool'],
  ];

  it.each(cases)('%s %s asks systemd without blocking', async (name, action, command) => {
    await set(name, { status: 'online', requested_status: 'online', requested_at: 1000 });
    const svc = require(`../src/services/${name}`)(knex);
    const exec = jest.spyOn(svc, '_execCommand').mockResolvedValue({ stdout: 'active', stderr: '' });
    if (name === 'solo') {
      jest.spyOn(svc, '_waitForActive').mockResolvedValue(true);
      jest.spyOn(svc, '_waitForInactive').mockResolvedValue(true);
    }

    await svc[action]();

    expect(exec).toHaveBeenCalledWith(command);
  });

  it('a solo restart that systemd refuses leaves the pool as it was, and says so cleanly', async () => {
    await set('solo', { status: 'online', requested_status: 'online', requested_at: 1000 });
    const solo = require('../src/services/solo')(knex);
    jest
      .spyOn(solo, '_execCommand')
      .mockRejectedValue(new Error('Command failed: sudo systemctl restart --no-block ckpool\nsudo: a terminal is required'));

    const error = await solo.restart().catch((e) => e);

    expect(error.message).toBe('Could not restart the solo pool');
    expect(error.message).not.toMatch(/sudo|systemctl|terminal/);
    expect(error.extensions).toMatchObject({ code: 'SERVICE_COMMAND_FAILED', service: 'solo', action: 'restart' });
    const after = await row('solo');
    expect(after.status).toBe('online');
    expect(after.requested_status).toBe('online');
    // ...and the real detail went to the log.
    expect(console.error.mock.calls.flat().join(' ')).toMatch(/terminal is required/);
  });

  it('a solo restart whose job ran and failed ends offline with a clean error, not a refusal', async () => {
    await set('solo', { status: 'online', requested_status: 'online', requested_at: 1000 });
    const solo = require('../src/services/solo')(knex);
    jest.spyOn(solo, '_execCommand').mockResolvedValue({ stdout: '', stderr: '' });
    jest.spyOn(solo, '_waitForActive').mockResolvedValue(false);

    // The unit is down for good (the show call mocked above answers empty): a
    // clean, localisable error, and the row goes offline.
    await expect(solo.restart()).rejects.toMatchObject({
      message: 'Could not restart the solo pool',
      extensions: { code: 'SERVICE_COMMAND_FAILED', service: 'solo', action: 'restart' },
    });
    expect((await row('solo')).status).toBe('offline');
  });
});

describe('S5: a refused request on a unit that was already in the state it asked for', () => {
  it('puts back exactly what was there', async () => {
    await set('node', { status: 'offline', requested_status: 'offline', requested_at: 1000 });
    const node = require('../src/services/node')(knex);
    jest.spyOn(node, '_execCommand').mockRejectedValue(new Error('refused'));
    await node.start().catch(() => {});
    const after = await row('node');
    expect([after.status, after.requested_status, Number(after.requested_at)]).toEqual(['offline', 'offline', 1000]);
  });
});

describe('the dev path goes through the same bookkeeping', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('solo: a failing dev start is put back and never published as pending', async () => {
    process.env.NODE_ENV = 'development';
    await set('solo', { status: 'offline', requested_status: 'offline', requested_at: 1000 });
    jest.resetModules();
    jest.doMock('../src/devSoloService', () => ({
      startDevSolo: jest.fn().mockRejectedValue(new Error('dev boom')),
      getStatus: jest.fn(),
    }));
    // The module registry was reset: this is the scheduler the service will see.
    const published = [];
    require('../src/app/scheduler').pushServicesStatus.mockImplementation(async () => {
      published.push((await row('solo')).status);
    });
    const solo = require('../src/services/solo')(knex);
    await expect(solo.start()).rejects.toThrow();
    await tick(30);
    expect(published.length).toBeGreaterThan(0); // the revert was published
    expect((await row('solo')).status).toBe('offline');
    expect(published).not.toContain('pending');
  });
});
