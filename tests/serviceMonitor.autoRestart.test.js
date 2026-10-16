// A ckpool that crashes on start sits in `activating (auto-restart)` under
// Restart=always and never reaches `failed`. Past the start grace window the
// monitor must call that an error, and go back to normal once it is up.

const { knex } = require('../src/db');
const monitorFactory = require('../src/services/serviceMonitor');

let publishSpy;
beforeAll(() => {
  publishSpy = jest.spyOn(require('../src/graphql/pubsub'), 'publish').mockImplementation(() => {});
});
afterAll(() => publishSpy?.mockRestore());

jest.mock('child_process', () => ({
  exec: (cmd, cb) => {
    if (typeof cb !== 'function') return;
    if (/systemctl show/.test(cmd)) return cb(null, { stdout: `${global.__sub}\n`, stderr: '' });
    if (!/is-active/.test(cmd)) return cb(null, { stdout: '', stderr: '' });
    const value = global.__systemd;
    if (value === 'active') return cb(null, { stdout: 'active\n', stderr: '' });
    const err = new Error(value);
    err.code = value === 'inactive' ? 3 : 1;
    err.stdout = value;
    return cb(err, { stdout: value, stderr: '' });
  },
}));

const setSolo = async (row) => {
  await knex('service_status').where({ service_name: 'solo' }).del();
  await knex('service_status').insert({ service_name: 'solo', ...row });
};
const readSolo = () => knex('service_status').where({ service_name: 'solo' }).first();

describe('ckpool in activating (auto-restart)', () => {
  let monitor;
  let now;
  beforeEach(() => {
    global.__systemd = 'activating';
    global.__sub = 'auto-restart';
    monitor = monitorFactory(knex, {});
    now = 1_000_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  const poll = () => monitor.checkServiceStatus('ckpool', 'solo');
  // Past the grace window of the request that started it all.
  const settled = () => setSolo({ status: 'pending', requested_status: 'online', requested_at: now - 200000 });

  it('stays pending at first, becomes error after 90 s of it', async () => {
    await settled();
    await poll();
    expect((await readSolo()).status).toBe('pending');
    now += 60000;
    await poll();
    expect((await readSolo()).status).toBe('pending');
    now += 31000;
    await poll();
    expect((await readSolo()).status).toBe('error');
  });

  it('goes back to online when it comes up, and the clock starts over after', async () => {
    await settled();
    await poll();
    now += 100000;
    await poll();
    expect((await readSolo()).status).toBe('error');
    global.__systemd = 'active';
    await poll();
    expect((await readSolo()).status).toBe('online');
    global.__systemd = 'activating';
    now += 1000;
    await poll();
    expect((await readSolo()).status).not.toBe('error');
  });

  it('plain `activating` (a slow start, not a restart loop) is never an error', async () => {
    global.__sub = 'start';
    await settled();
    await poll();
    now += 200000;
    await poll();
    expect((await readSolo()).status).toBe('pending');
  });

  it('is left alone while a request is still inside its grace window', async () => {
    await setSolo({ status: 'pending', requested_status: 'online', requested_at: now - 1000 });
    await poll();
    now += 50000;
    await setSolo({ status: 'pending', requested_status: 'online', requested_at: now - 1000 });
    await poll();
    expect((await readSolo()).status).toBe('pending');
  });
});
