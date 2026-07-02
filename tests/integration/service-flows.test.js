const { run, services, utils, knex } = require('./harness');

// T1 integration tests for the release-critical UI↔backend flows.

describe('T1 — node software switch (Settings.update nodeSoftware)', () => {
  const UPDATE = `query($in: SettingsUpdateInput!) {
    Settings { update(input: $in) {
      result { settings { nodeSoftware mindiff startdiff } }
      error { message }
    } }
  }`;

  it('switches to Core 31.0: enum→backend conversion, triggers switch, persists', async () => {
    const spy = jest.spyOn(utils.auth, 'switchBitcoinSoftware').mockResolvedValue({ success: true });
    const res = await run(UPDATE, { variables: { in: { nodeSoftware: 'core_31_0' } } });

    expect(res.errors).toBeUndefined();
    expect(res.data.Settings.update.error).toBeNull();
    // persisted + round-trips back in enum format
    expect(res.data.Settings.update.result.settings.nodeSoftware).toBe('core_31_0');
    // switch invoked with the backend format (core_31_0 -> core-31.0)
    expect(spy).toHaveBeenCalledWith('core-31.0');
  });

  it('switches to Knots 29.3', async () => {
    const spy = jest.spyOn(utils.auth, 'switchBitcoinSoftware').mockResolvedValue({ success: true });
    const res = await run(UPDATE, { variables: { in: { nodeSoftware: 'knots_29_3' } } });
    expect(res.data.Settings.update.result.settings.nodeSoftware).toBe('knots_29_3');
    expect(spy).toHaveBeenCalledWith('knots-29.3');
  });

  it('rejects an unknown node software version at the schema (enum guard)', async () => {
    const spy = jest.spyOn(utils.auth, 'switchBitcoinSoftware').mockResolvedValue({ success: true });
    const res = await run(UPDATE, { variables: { in: { nodeSoftware: 'core_99_9' } } });
    expect(res.errors).toBeDefined();
    expect(res.errors[0].message).toMatch(/core_99_9|NodeSoftware|not.*valid/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('persists mindiff via Settings.update', async () => {
    jest.spyOn(utils.auth, 'switchBitcoinSoftware').mockResolvedValue({ success: true });
    const res = await run(UPDATE, { variables: { in: { mindiff: 42 } } });
    expect(res.data.Settings.update.error).toBeNull();
    expect(res.data.Settings.update.result.settings.mindiff).toBe(42);
  });
});

describe('T1 — node start/stop (Node.start / Node.stop)', () => {
  it('Node.start sets requested_status=online and issues systemctl start', async () => {
    const spy = jest.spyOn(services.node, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Node { start { error { message } } } }`);

    expect(res.errors).toBeUndefined();
    expect(res.data.Node.start.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'node' }).first();
    expect(row.requested_status).toBe('online');
    expect(spy).toHaveBeenCalledWith('sudo systemctl start node');
  });

  it('Node.stop sets requested_status=offline and issues systemctl stop', async () => {
    const spy = jest.spyOn(services.node, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Node { stop { error { message } } } }`);

    expect(res.data.Node.stop.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'node' }).first();
    expect(row.requested_status).toBe('offline');
    expect(spy).toHaveBeenCalledWith('sudo systemctl stop node');
  });
});

describe('T1 — miner start/stop/restart (Miner.*)', () => {
  it('Miner.start → requested_status=online + systemctl start apollo-miner', async () => {
    const spy = jest.spyOn(services.miner, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Miner { start { error { message } } } }`);
    expect(res.data.Miner.start.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'miner' }).first();
    expect(row.requested_status).toBe('online');
    expect(spy).toHaveBeenCalledWith('sudo systemctl start apollo-miner');
  });

  it('Miner.stop → requested_status=offline + systemctl stop apollo-miner', async () => {
    const spy = jest.spyOn(services.miner, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Miner { stop { error { message } } } }`);
    expect(res.data.Miner.stop.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'miner' }).first();
    expect(row.requested_status).toBe('offline');
    expect(spy).toHaveBeenCalledWith('sudo systemctl stop apollo-miner');
  });

  it('Miner.restart → systemctl restart apollo-miner', async () => {
    const spy = jest.spyOn(services.miner, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Miner { restart { error { message } } } }`);
    expect(res.data.Miner.restart.error).toBeNull();
    expect(spy).toHaveBeenCalledWith('sudo systemctl restart apollo-miner');
  });
});

describe('T1 — solo start/stop (Solo.*)', () => {
  beforeAll(async () => {
    const exists = await knex('service_status').where({ service_name: 'solo' }).first();
    if (!exists) await knex('service_status').insert({ service_name: 'solo', status: 'offline', requested_status: 'offline' });
  });

  it('Solo.start → requested_status=online + systemctl start ckpool (waitForActive ok)', async () => {
    // _execCommand serves both the start command and the is-active poll in _waitForActive
    const spy = jest.spyOn(services.solo, '_execCommand').mockResolvedValue({ stdout: 'active' });
    const res = await run(`query { Solo { start { error { message } } } }`);
    expect(res.data.Solo.start.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'solo' }).first();
    expect(row.requested_status).toBe('online');
    expect(spy).toHaveBeenCalledWith('sudo systemctl start ckpool');
  });

  it('Solo.stop → requested_status=offline + systemctl stop ckpool', async () => {
    const spy = jest.spyOn(services.solo, '_execCommand').mockResolvedValue({ stdout: 'inactive' });
    const res = await run(`query { Solo { stop { error { message } } } }`);
    expect(res.data.Solo.stop.error).toBeNull();
    const row = await knex('service_status').where({ service_name: 'solo' }).first();
    expect(row.requested_status).toBe('offline');
    expect(spy).toHaveBeenCalledWith('sudo systemctl stop ckpool');
  });
});

describe('T1 — node parameters (Settings.update) regenerate bitcoin.conf', () => {
  it('changing nodeMaxConnections persists and triggers manageBitcoinConf', async () => {
    const spy = jest.spyOn(utils.auth, 'manageBitcoinConf').mockResolvedValue(undefined);
    const res = await run(
      `query($in: SettingsUpdateInput!) { Settings { update(input: $in) {
        result { settings { nodeMaxConnections nodeAllowLan } } error { message } } } }`,
      { variables: { in: { nodeMaxConnections: 128, nodeAllowLan: true } } }
    );
    expect(res.data.Settings.update.error).toBeNull();
    expect(res.data.Settings.update.result.settings.nodeMaxConnections).toBe(128);
    expect(res.data.Settings.update.result.settings.nodeAllowLan).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

describe('T1 — pool change (Pool.updateAll) reconfigures the miner', () => {
  it('persists pools and regenerates miner_config with the new pool', async () => {
    const fs = require('fs');
    fs.promises.writeFile.mockClear();
    const res = await run(
      `query($in: PoolUpdateAllInput!) { Pool { updateAll(input: $in) {
        result { pools { url username index enabled } } error { message } } } }`,
      {
        variables: {
          in: { pools: [{ index: 0, enabled: true, url: 'stratum+tcp://newpool.example:4444', username: 'newwallet', password: 'x' }] },
        },
      }
    );
    expect(res.data.Pool.updateAll.error).toBeNull();
    const pools = res.data.Pool.updateAll.result.pools;
    expect(pools.some((p) => p.url.includes('newpool.example'))).toBe(true);
    // configurator regenerated the miner config with the new pool
    const call = fs.promises.writeFile.mock.calls.find((c) => String(c[0]).endsWith('/miner_config'));
    expect(call).toBeDefined();
    expect(call[1]).toContain('-host newpool.example -port 4444 -user newwallet');
  });
});

describe('T1 — @auth guard', () => {
  it('rejects an unauthenticated mutation', async () => {
    const spy = jest.spyOn(services.node, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Node { start { error { message } } } }`, { auth: false });
    expect(res.errors).toBeDefined();
    expect(res.errors[0].message).toMatch(/authenticated/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
