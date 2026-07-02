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

describe('T1 — @auth guard', () => {
  it('rejects an unauthenticated mutation', async () => {
    const spy = jest.spyOn(services.node, '_execCommand').mockResolvedValue('');
    const res = await run(`query { Node { start { error { message } } } }`, { auth: false });
    expect(res.errors).toBeDefined();
    expect(res.errors[0].message).toMatch(/authenticated/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
