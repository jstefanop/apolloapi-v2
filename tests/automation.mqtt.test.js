const { knex } = require('../src/db');
const client = require('../src/services/mqtt/client');
const mqttInput = require('../src/services/signals/mqttInput');
const signals = require('../src/services/signals');

const deps = {
  miner: { getStats: jest.fn().mockResolvedValue({ stats: [] }), start: jest.fn(), stop: jest.fn(), restart: jest.fn() },
  settings: { read: jest.fn().mockResolvedValue({ minerMode: 'balanced' }), update: jest.fn() },
};
const automation = require('../src/services/automation')(knex, deps);

beforeEach(async () => {
  client._reset();
  await knex('automation_config').where({ id: 1 }).update({ mqtt: null });
});

describe('MQTT client — reading topics into a cache', () => {
  const cfg = {
    enabled: true,
    host: 'broker.local',
    inputs: [{ name: 'surplus', topic: 'sun2000/surplus' }],
  };

  it('caches the latest numeric payload for a topic', () => {
    client.configure(cfg);
    client._ingest('sun2000/surplus', Buffer.from('850'));
    expect(client.getValue('surplus')).toMatchObject({ value: 850 });
  });

  it('extracts a value from JSON via a dot-path', () => {
    client.configure({ ...cfg, inputs: [{ name: 'soc', topic: 'batt', jsonPath: 'battery.soc' }] });
    client._ingest('batt', Buffer.from(JSON.stringify({ battery: { soc: 73 } })));
    expect(client.getValue('soc')).toMatchObject({ value: 73 });
  });

  it('ignores non-numeric payloads instead of caching garbage', () => {
    client.configure(cfg);
    client._ingest('sun2000/surplus', Buffer.from('n/a'));
    expect(client.getValue('surplus')).toBeNull();
  });
});

describe('MQTT input signals', () => {
  const config = { mqtt: { inputs: [{ name: 'surplus', topic: 'sun2000/surplus', unit: 'W' }] } };

  it('describes an input.<name> number signal per mapping', () => {
    const descriptors = mqttInput.describe(config);
    expect(descriptors).toEqual([
      expect.objectContaining({ id: 'input.surplus', type: 'number', widget: 'number', unit: 'W' }),
    ]);
  });

  it('is stale while the broker is disconnected — a rule on it does not match', async () => {
    client._setStatus({ connected: false });
    const s = await mqttInput.read({ config });
    expect(s['input.surplus']).toMatchObject({ stale: true });
  });

  it('reports the cached value once connected', async () => {
    client.configure({ enabled: true, host: 'x', inputs: config.mqtt.inputs });
    client._setStatus({ connected: true });
    client._ingest('sun2000/surplus', Buffer.from('900'));

    const s = await mqttInput.read({ config });
    expect(s['input.surplus']).toMatchObject({ value: 900 });
  });

  it('appears in the registry descriptors when configured', () => {
    const ids = signals.descriptors(config).map((d) => d.id);
    expect(ids).toContain('input.surplus');
    // …and is absent without config.
    expect(signals.descriptors({}).map((d) => d.id)).not.toContain('input.surplus');
  });
});

describe('MQTT config round-trip', () => {
  it('stores and reads the broker config; a rule can use the input signal', async () => {
    await automation.updateConfig({
      mqtt: {
        enabled: true,
        host: 'broker.local',
        port: 1883,
        username: 'ha',
        password: 'secret',
        inputs: [{ name: 'surplus', topic: 'sun2000/surplus', unit: 'W' }],
      },
    });

    const cfg = await automation.getConfig();
    expect(cfg.mqtt).toMatchObject({ enabled: true, host: 'broker.local', port: 1883 });
    expect(cfg.mqtt.inputs[0]).toMatchObject({ name: 'surplus', topic: 'sun2000/surplus' });

    // The rule validation accepts the dynamic input signal.
    const rule = await automation.createRule({
      name: 'Solar surplus',
      conditions: [{ signal: 'input.surplus', op: '>', value: '800' }],
      action: { type: 'mode', mode: 'turbo' },
    });
    expect(rule.conditions[0].signal).toBe('input.surplus');
  });

  it('never returns the broker password through GraphQL serialization', () => {
    const { serializeConfig } = require('../src/graphql/serialize/automation');
    const out = serializeConfig({
      mqtt: { enabled: true, host: 'h', username: 'u', password: 'secret', inputs: [] },
    });
    expect(out.mqtt).toMatchObject({ host: 'h', username: 'u' });
    expect(out.mqtt.password).toBeUndefined();
    expect(out.mqtt.status).toBeDefined();
  });
});
