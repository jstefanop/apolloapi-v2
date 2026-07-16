const { knex } = require('../src/db');
const client = require('../src/services/mqtt/client');
const mqttInput = require('../src/services/signals/mqttInput');
const signals = require('../src/services/signals');

const mqttService = require('../src/services/mqtt/service')(knex);

const deps = {
  miner: { getStats: jest.fn().mockResolvedValue({ stats: [] }), start: jest.fn(), stop: jest.fn(), restart: jest.fn() },
  settings: { read: jest.fn().mockResolvedValue({ minerMode: 'balanced' }), update: jest.fn() },
  mqtt: mqttService,
};
const automation = require('../src/services/automation')(knex, deps);

beforeEach(async () => {
  client._reset();
  await knex('mqtt_config')
    .where({ id: 1 })
    .update({ enabled: false, host: null, port: 1883, username: null, password: null, tls: false, output: null, inputs: null });
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

describe('MQTT config (system service)', () => {
  it('stores and reads the broker config; a rule can use the input signal', async () => {
    await mqttService.updateConfig({
      enabled: true,
      host: 'broker.local',
      port: 1883,
      username: 'ha',
      password: 'secret',
      inputs: [{ name: 'surplus', topic: 'sun2000/surplus', unit: 'W' }],
    });

    const cfg = await mqttService.getConfig();
    expect(cfg).toMatchObject({ enabled: true, host: 'broker.local', port: 1883 });
    expect(cfg.inputs[0]).toMatchObject({ name: 'surplus', topic: 'sun2000/surplus' });

    // The automation reads the inputs from the mqtt service; validation accepts it.
    const rule = await automation.createRule({
      name: 'Solar surplus',
      conditions: [{ signal: 'input.surplus', op: '>', value: '800' }],
      action: { type: 'mode', mode: 'turbo' },
    });
    expect(rule.conditions[0].signal).toBe('input.surplus');
  });

  it('tests the connection, filling in the stored password when the form left it blank', async () => {
    const spy = jest.spyOn(client, 'testConnection').mockResolvedValue({ ok: true, error: null });

    await mqttService.updateConfig({ enabled: true, host: 'h', password: 'stored', inputs: [] });
    const result = await mqttService.testConnection({ host: 'h', password: '' });

    expect(result).toEqual({ ok: true, error: null });
    expect(spy.mock.calls[0][0].password).toBe('stored'); // merged from the stored config
    spy.mockRestore();
  });

  it('browses topics, passing the prefix and the stored password through', async () => {
    const spy = jest
      .spyOn(client, 'discoverTopics')
      .mockResolvedValue({ ok: true, error: null, topics: [{ topic: 'sun2000/x', sample: '5', jsonPaths: [] }] });

    await mqttService.updateConfig({ enabled: true, host: 'h', password: 'stored', inputs: [] });
    const result = await mqttService.discoverTopics({ host: 'h', password: '' }, { prefix: 'sun2000', seconds: 5 });

    expect(result.topics).toHaveLength(1);
    expect(spy.mock.calls[0][0].password).toBe('stored');
    expect(spy.mock.calls[0][1]).toMatchObject({ prefix: 'sun2000', seconds: 5 });
    spy.mockRestore();
  });

  it('never returns the broker password through GraphQL serialization', () => {
    const { serializeMqttConfig } = require('../src/graphql/serialize/mqtt');
    const out = serializeMqttConfig({ enabled: true, host: 'h', username: 'u', password: 'secret', output: {}, inputs: [] });
    expect(out).toMatchObject({ host: 'h', username: 'u' });
    expect(out.password).toBeUndefined();
    expect(out.status).toBeDefined();
  });
});
