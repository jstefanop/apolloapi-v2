// tests/wifiGraphql.test.js
const { getNamedType, graphql } = require('graphql');
const schema = require('../src/graphql/schema');
const resolvers = require('../src/graphql/resolvers/mcu');

const queryFields = () =>
  getNamedType(schema.getQueryType().getFields().Mcu.type).getFields();
const mutationFields = () =>
  getNamedType(schema.getMutationType().getFields().Mcu.type).getFields();

describe('wifi surface: reads are queries, changes are mutations', () => {
  it('exposes the reads as queries', () => {
    const q = queryFields();
    for (const f of ['wifiInterfaces', 'wifiStatus', 'wifiNetworks', 'wifiSaved']) {
      expect(q[f]).toBeDefined();
      expect(q[f].deprecationReason).toBeFalsy();
    }
  });

  it('exposes connect, disconnect and forget as mutations', () => {
    const m = mutationFields();
    expect(m.wifiConnect).toBeDefined();
    expect(m.wifiDisconnect).toBeDefined();
    // The operation that did not exist: "disconnect" used to mean "delete
    // everything that matched", so there was no way to drop one network.
    expect(m.wifiForget).toBeDefined();
  });

  it('keeps the old query fields as deprecated aliases for stale bundles', () => {
    const q = queryFields();
    for (const f of ['wifiScan', 'wifiConnect', 'wifiDisconnect']) {
      expect(q[f].deprecationReason).toBeTruthy();
    }
  });

  it('guards every wifi field with @auth', async () => {
    const cases = [
      ['query', '{ Mcu { wifiInterfaces { error { message } } } }'],
      ['query', '{ Mcu { wifiSaved { error { message } } } }'],
      ['mutation', 'mutation { Mcu { wifiForget(uuid: "x") { error { message } } } }'],
      ['mutation', 'mutation { Mcu { wifiDisconnect(ifname: "wlan0") { error { message } } } }'],
    ];
    for (const [, source] of cases) {
      const res = await graphql({
        schema,
        source,
        contextValue: { isAuthenticated: false, services: {} },
      });
      expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('the deprecated disconnect no longer deletes anything', () => {
  it('calls disconnect on the radio, never forget', async () => {
    const wifi = {
      listInterfaces: jest.fn().mockResolvedValue([
        { device: 'wlan0', kind: 'builtin', connected: true, carriesDefaultRoute: true },
      ]),
      preferredInterface: (i) => i[0],
      disconnect: jest.fn().mockResolvedValue({ disconnected: true }),
      forget: jest.fn(),
    };
    const out = await resolvers.McuActions.wifiDisconnect(null, {}, { services: { wifi } });
    expect(out.error).toBeNull();
    expect(wifi.disconnect).toHaveBeenCalledWith('wlan0');
    expect(wifi.forget).not.toHaveBeenCalled();
  });
});

describe('connect reports why it failed, not nmcli raw text', () => {
  it('surfaces the classified reason', async () => {
    const wifi = {
      listInterfaces: jest.fn().mockResolvedValue([
        { device: 'wlan0', kind: 'builtin', connected: false, carriesDefaultRoute: true },
      ]),
      preferredInterface: (i) => i[0],
      connect: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('x'), { reason: 'bad-passphrase' })),
    };
    const out = await resolvers.McuMutations.wifiConnect(
      null,
      { input: { ssid: 'Home', passphrase: 'wrong' } },
      { services: { wifi } }
    );
    expect(out.error.message).toBe('bad-passphrase');
  });

  it('joins with the requested radio when one is named', async () => {
    const wifi = {
      listInterfaces: jest.fn(),
      preferredInterface: jest.fn(),
      connect: jest.fn().mockResolvedValue({ connected: true, ipAddress: '192.168.1.5' }),
    };
    await resolvers.McuMutations.wifiConnect(
      null,
      { input: { ssid: 'Home', passphrase: 'p', ifname: 'wlx98' } },
      { services: { wifi } }
    );
    expect(wifi.connect).toHaveBeenCalledWith('wlx98', 'Home', 'p', { hidden: false });
    expect(wifi.listInterfaces).not.toHaveBeenCalled(); // no need to guess
  });

  it('keeps address in the payload so a stale bundle still reads it', async () => {
    const wifi = {
      listInterfaces: jest.fn().mockResolvedValue([{ device: 'wlan0', carriesDefaultRoute: true }]),
      preferredInterface: (i) => i[0],
      connect: jest.fn().mockResolvedValue({ connected: true, ipAddress: '192.168.1.5' }),
    };
    const out = await resolvers.McuActions.wifiConnect(
      null,
      { input: { ssid: 'Home', passphrase: 'p' } },
      { services: { wifi } }
    );
    expect(out.result.address).toBe('192.168.1.5');
  });
});

describe('the deprecated scan shape is served from the new scanner', () => {
  it('maps the new fields back, hidden networks keeping their empty ssid', async () => {
    const wifi = {
      listInterfaces: jest.fn().mockResolvedValue([{ device: 'wlan0', carriesDefaultRoute: true }]),
      preferredInterface: (i) => i[0],
      scan: jest.fn().mockResolvedValue([
        { ssid: 'Home', mode: 'Infra', channel: 6, signal: 80, security: ['WPA2'], active: true },
        { ssid: null, hidden: true, mode: 'Infra', channel: 3, signal: 40, security: [], active: false },
      ]),
    };
    const out = await resolvers.McuActions.wifiScan(null, {}, { services: { wifi } });
    expect(out.result.wifiScan).toEqual([
      { ssid: 'Home', mode: 'Infra', channel: 6, rate: null, signal: 80, security: 'WPA2', inuse: true },
      { ssid: '', mode: 'Infra', channel: 3, rate: null, signal: 40, security: '', inuse: false },
    ]);
  });
});
