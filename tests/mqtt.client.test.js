// Mock the transport so the broker-facing orchestration in testConnection() and
// discoverTopics() runs without a real broker. The jest config sets resetMocks,
// which strips a factory's implementation before each test, so the fake client
// is (re)installed in beforeEach via mockImplementation, not in the factory.
jest.mock('mqtt', () => ({ connect: jest.fn() }));

const mqtt = require('mqtt');
const client = require('../src/services/mqtt/client');

// A minimal event-emitter-ish fake mqtt client we drive from the tests.
const makeClient = () => {
  const handlers = {};
  return {
    on: (ev, cb) => {
      (handlers[ev] = handlers[ev] || []).push(cb);
    },
    emit: (ev, ...args) => {
      (handlers[ev] || []).forEach((cb) => cb(...args));
    },
    subscribe: (topic, cb) => cb && cb(null),
    publish: jest.fn(),
    end: (force, opts, cb) => {
      if (typeof opts === 'function') opts();
      else if (typeof cb === 'function') cb();
    },
  };
};

// The fake client returned by the i-th mqtt.connect() call.
const probe = (i = 0) => mqtt.connect.mock.results[i].value;

beforeEach(() => {
  jest.useFakeTimers();
  mqtt.connect.mockImplementation(() => makeClient());
  client._reset();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('mqtt client — testConnection', () => {
  it('resolves ok when the broker accepts the connection', async () => {
    const p = client.testConnection({ host: 'b' });
    probe().emit('connect');
    await expect(p).resolves.toEqual({ ok: true, error: null });
  });

  it('maps a CONNACK refusal to a readable reason', async () => {
    const p = client.testConnection({ host: 'b' });
    const err = new Error('connection refused');
    err.code = 5;
    probe().emit('error', err);
    await expect(p).resolves.toEqual({ ok: false, error: 'Rejected: not authorized' });
  });

  it('times out when the broker never answers', async () => {
    const p = client.testConnection({ host: 'b' });
    jest.advanceTimersByTime(7000);
    await expect(p).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Timed out/) });
  });

  it('refuses without a host, without opening a connection', async () => {
    await expect(client.testConnection({})).resolves.toMatchObject({ ok: false });
    expect(mqtt.connect).not.toHaveBeenCalled();
  });
});

describe('mqtt client — discoverTopics', () => {
  it('collects published topics and resolves a HA sensor config to its value', async () => {
    const p = client.discoverTopics({ host: 'b' }, { seconds: 1 });
    const c = probe();
    c.emit('connect');
    c.emit('message', 'sun2000/surplus', Buffer.from('850'));
    c.emit(
      'message',
      'homeassistant/sensor/x/total_yield/config',
      Buffer.from(JSON.stringify({ name: 'Total Yield', state_topic: 'sun2000/state', value_template: '{{ value_json.total_yield }}' }))
    );
    c.emit('message', 'sun2000/state', Buffer.from(JSON.stringify({ total_yield: 1234 })));

    jest.advanceTimersByTime(1000); // close the browse window

    const r = await p;
    expect(r.ok).toBe(true);
    // The plain topic is listed…
    expect(r.topics.some((t) => t.topic === 'sun2000/surplus')).toBe(true);
    // …and the HA sensor config resolved to its state topic + current value.
    expect(r.topics.some((t) => t.topic === 'sun2000/state' && t.value === '1234')).toBe(true);
    // The config topic itself is not surfaced as a plain topic.
    expect(r.topics.some((t) => t.topic === 'homeassistant/sensor/x/total_yield/config')).toBe(false);
  });

  it('refuses without a host', async () => {
    await expect(client.discoverTopics({})).resolves.toMatchObject({ ok: false, topics: [] });
  });
});
