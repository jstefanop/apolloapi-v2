// Solo's waits after a command (is it up yet? is it down yet?) run outside the
// transition queue, so a newer request can arrive meanwhile. What they write
// afterwards must be for their own request only. And: how the refusal of a
// command reaches the screen, and what bounds a command that never answers.

const { knex } = require('../src/db');

const execed = [];
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const exec = (cmd, opts, cb) => {
    if (typeof opts === 'function') cb = opts;
    execed.push(cmd);
    if (typeof cb !== 'function') return;
    if (!/is-active/.test(cmd)) return cb(null, '', '');
    const v = global.__systemd || 'inactive';
    if (v === 'active') return cb(null, 'active\n', '');
    const err = new Error(v);
    err.code = v === 'failed' ? 4 : 3;
    return cb(err, `${v}\n`, ''); // like systemctl: state on stdout, exit non-zero
  };
  return { ...actual, exec };
});

const row = (n) => knex('service_status').where({ service_name: n }).first();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = async (r) => {
  await knex('service_status').where({ service_name: 'solo' }).del();
  await knex('service_status').insert({ service_name: 'solo', last_checked: Date.now(), ...r });
};

// The real waits poll every 1.5 s for 30 s; the same loops, quicker.
const quick = (solo, timeout = 1500) => {
  const wa = solo._waitForActive.bind(solo);
  const wi = solo._waitForInactive.bind(solo);
  solo._waitForActive = () => wa(timeout, 50);
  solo._waitForInactive = () => wi(timeout, 50);
  return solo;
};

beforeEach(() => {
  for (const m of ['log', 'error', 'warn']) jest.spyOn(console, m).mockImplementation(() => {});
  global.__systemd = undefined;
  execed.length = 0;
});

const original = { status: 'offline', requested_status: 'offline', requested_at: 1000 };

test('R1: a start whose wait ends after a stop was requested does not overwrite the stop', async () => {
  await seed(original);
  const solo = quick(require('../src/services/solo')(knex));

  global.__systemd = 'activating';
  const started = solo.start().catch((e) => e);
  await sleep(30);
  const stopped = solo.stop().catch((e) => e);
  await sleep(30);
  expect((await row('solo')).requested_status).toBe('offline');

  global.__systemd = 'active'; // the start's poll now sees the unit up
  await sleep(200);

  // The start's wait is over; it must not have written `online` over the stop.
  const during = await row('solo');
  expect(during.requested_status).toBe('offline');
  expect(during.status).not.toBe('online');

  global.__systemd = 'inactive';
  expect(await started).toBeUndefined(); // superseded: no error, nothing to report
  await stopped;
  expect((await row('solo')).status).toBe('offline');
});

test('R2: a unit that failed ends the wait at once, and the monitor\'s `error` is not overwritten', async () => {
  await seed({ ...original, requested_status: 'online', requested_at: 2000, status: 'pending' });
  const solo = require('../src/services/solo')(knex);
  global.__systemd = 'failed';

  const started = Date.now();
  expect(await solo._waitForActive(3000, 100)).toBe(false);
  expect(Date.now() - started).toBeLessThan(500); // not the whole timeout

  // The monitor got there first and recorded the failure on this very request.
  await knex('service_status').where({ service_name: 'solo' }).update({ status: 'error' });
  await solo._updateServiceStatus('offline', 2000);
  expect((await row('solo')).status).toBe('error');
});

test('R3: start then a quick stop: the start does not report a timeout or write offline over the stop', async () => {
  await seed(original);
  const solo = quick(require('../src/services/solo')(knex), 800);

  global.__systemd = 'activating';
  const started = solo.start().catch((e) => e);
  await sleep(30);
  global.__systemd = 'deactivating';
  const stopped = solo.stop().catch((e) => e);
  await sleep(30);
  global.__systemd = 'inactive';

  expect(await started).toBeUndefined();
  expect(await stopped).toBeUndefined();
  const after = await row('solo');
  expect(after.requested_status).toBe('offline');
  expect(after.status).toBe('offline');
});

describe('a refused command reaches the UI in a form it can localise', () => {
  const resolvers = {
    node: require('../src/graphql/resolvers/node'),
    miner: require('../src/graphql/resolvers/miner'),
    solo: require('../src/graphql/resolvers/solo'),
  };

  it.each([
    ['node', 'start', 'NodeMutations'],
    ['node', 'stop', 'NodeMutations'],
    ['node', 'restart', 'NodeMutations'],
    ['miner', 'restart', 'MinerActions'],
    ['solo', 'start', 'SoloActions'],
  ])('%s %s: type and path survive the resolver, with no shell text', async (service, action, type) => {
    await knex('service_status').where({ service_name: service }).del();
    await knex('service_status').insert({ service_name: service, status: 'online', requested_status: 'online', requested_at: 1000, last_checked: Date.now() });
    const svc = require(`../src/services/${service}`)(knex);
    jest
      .spyOn(svc, '_execCommand')
      .mockRejectedValue(new Error('Command failed: sudo systemctl restart --no-block x\nsudo: a terminal is required'));

    const payload = await resolvers[service][type][action](null, {}, { services: { [service]: svc } });

    expect(payload.error.type).toBe('SERVICE_COMMAND_FAILED');
    expect(payload.error.path).toBe(`${service}.${action}`);
    expect(payload.error.message).not.toMatch(/sudo|systemctl|terminal/);
  });

  it('a failure that is not a refused command stays a bare message', async () => {
    const svc = { start: jest.fn().mockRejectedValue(new Error('something else')) };
    const payload = await resolvers.node.NodeMutations.start(null, {}, { services: { node: svc } });
    expect(payload.error).toEqual({ message: 'something else' });
  });
});

describe('node restart is one systemd job', () => {
  it('asks for `restart`, not a stop followed by a start', async () => {
    await knex('service_status').where({ service_name: 'node' }).del();
    await knex('service_status').insert({ service_name: 'node', status: 'online', requested_status: 'online', requested_at: 1000, last_checked: Date.now() });
    const node = require('../src/services/node')(knex);
    const exec = jest.spyOn(node, '_execCommand').mockResolvedValue('');

    await node.restart();

    expect(exec.mock.calls.map(([c]) => c)).toEqual(['sudo systemctl restart --no-block node']);
    expect((await row('node')).requested_status).toBe('online');
  });
});

describe('a command that never answers', () => {
  const transition = require('../src/services/transition');

  it('is treated as refused, puts the row back, and does not hold the queue', async () => {
    await seed({ status: 'online', requested_status: 'online', requested_at: 1000 });
    const never = new Promise(() => {});

    const stuck = await transition
      .run(knex, 'solo', 'offline', () => never, { timeoutMs: 40 })
      .catch((e) => e);
    expect(stuck.message).toMatch(/did not answer within .*uncertain/);
    const after = await row('solo');
    expect([after.status, after.requested_status, Number(after.requested_at)]).toEqual(['online', 'online', 1000]);

    // The next request is not stuck behind it.
    await expect(transition.run(knex, 'solo', 'online', async () => 'ok', { timeoutMs: 40 })).resolves.toBe('ok');
  });
});
