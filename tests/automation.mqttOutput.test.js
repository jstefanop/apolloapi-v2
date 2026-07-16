const { knex } = require('../src/db');

// Fake the services the output reads/drives. mqtt.getConfig stands in for the
// system MQTT config (broker enabled + output flags); automation.getConfig only
// feeds the "automation" telemetry field.
const deps = {
  miner: {
    getStats: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
  },
  settings: {
    read: jest.fn().mockResolvedValue({ minerMode: 'turbo' }),
    update: jest.fn().mockResolvedValue(undefined),
  },
  automation: { getConfig: jest.fn() },
  mqtt: { getConfig: jest.fn() },
  node: { getStats: jest.fn().mockResolvedValue({ stats: { error: null } }) },
  solo: { getStats: jest.fn().mockResolvedValue({ pool: {} }) },
  mcu: { getStats: jest.fn().mockResolvedValue({ stats: {} }) },
};

const output = require('../src/services/mqtt/output')(knex, deps);
const { deviceId } = require('../src/services/mqtt/output');

const board = (bySol, watts, temp) => ({
  master: { intervals: { int_30: { bySol } }, boardsW: watts },
  slots: { int_0: { temperature: temp } },
});

// System MQTT config (broker + output), for deps.mqtt.getConfig.
const mqttOn = (extra = {}) => ({ enabled: true, output: { enabled: true, control: true }, ...extra });
// Automation config, for deps.automation.getConfig (the telemetry "automation" field).
const autoCfg = (extra = {}) => ({ enabled: true, dryRun: false, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  deps.settings.read.mockResolvedValue({ minerMode: 'turbo' });
  deps.miner.getStats.mockResolvedValue({ stats: [board(100, 50, 60), board(200, 50, 70)] });
  deps.mqtt.getConfig.mockResolvedValue(mqttOn());
  deps.automation.getConfig.mockResolvedValue(autoCfg());
});

describe('mqtt output — device id', () => {
  it('is stable and namespaced', () => {
    expect(deviceId()).toMatch(/^apollo_/);
    expect(deviceId()).toBe(deviceId());
  });
});

describe('mqtt output — miner telemetry', () => {
  it('aggregates the boards and derives the labels', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    const t = await output.buildMinerState();

    expect(t).toMatchObject({
      mining: 'ON',
      hashrate: 0.3, // (100 + 200) GH/s -> TH/s
      power: 100, // 50 + 50
      temp: 70, // hottest board
      efficiency: 333.3, // 100 W / 0.3 TH
      shares_accepted: 0,
      shares_rejected: 0,
      mode: 'turbo',
      automation: 'on',
    });
  });

  it('reports OFF and observing when the miner is stopped and automation is dry-run', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'offline' });
    deps.automation.getConfig.mockResolvedValue(autoCfg({ dryRun: true }));

    const t = await output.buildMinerState();

    expect(t.mining).toBe('OFF');
    expect(t.automation).toBe('observing');
  });

  it('coerces a string temperature (the stat file sends strings)', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });
    deps.miner.getStats.mockResolvedValue({ stats: [board('120', '48', '66.5')] });

    const t = await output.buildMinerState();

    expect(t.temp).toBe(66.5);
    expect(t.hashrate).toBe(0.12); // 120 GH/s -> TH/s
  });
});

describe('mqtt output — node / solo / mcu telemetry', () => {
  it('summarizes the node, or reports offline when it is down', async () => {
    await knex('service_status').where({ service_name: 'node' }).update({ status: 'online' });
    deps.node.getStats.mockResolvedValue({
      stats: {
        blockchainInfo: { blocks: 800000, headers: 800000, sizeOnDisk: '650000000000', verificationprogress: 0.99999, blockTime: Math.floor(Date.now() / 1000) - 300 },
        connectionCount: 12,
        miningInfo: { difficulty: 8e13, networkhashps: 6e20 },
        networkInfo: { subversion: '/Satoshi:29.2.0/' },
      },
    });
    const n = await output.buildNodeState();
    expect(n).toMatchObject({ status: 'online', block_height: 800000, connections: 12, minutes_since_block: 5, software: '/Satoshi:29.2.0/' });
    expect(n.sync_progress).toBeGreaterThan(99);

    await knex('service_status').where({ service_name: 'node' }).update({ status: 'offline' });
    expect(await output.buildNodeState()).toEqual({ status: 'offline' });
  });

  it('summarizes the solo pool, or offline', async () => {
    await knex('service_status').where({ service_name: 'solo' }).update({ status: 'online' });
    deps.solo.getStats.mockResolvedValue({ pool: { Workers: 2, hashrate15m: '3.5T', bestshare: 12345, accepted: 10, rejected: 1 } });
    expect(await output.buildSoloState()).toEqual({ status: 'online', hashrate: '3.5T', best_share: 12345, workers: 2, shares_accepted: 10, shares_rejected: 1 });

    await knex('service_status').where({ service_name: 'solo' }).update({ status: 'offline' });
    expect(await output.buildSoloState()).toEqual({ status: 'offline' });
  });

  it('converts the SBC temperature from millidegrees and reads the 1m load', async () => {
    deps.mcu.getStats.mockResolvedValue({ stats: { temperature: '48437', loadAverage: '1.27 1.26 1.34 2/321 3848474' } });
    expect(await output.buildMcuState()).toEqual({ system_temp: 48.4, load: 1.27 });
  });
});

describe('mqtt output — home assistant discovery', () => {
  it('adds a switch and a select only when control is allowed', () => {
    const withControl = output._entities('miner', { control: true }).map((c) => c.topic);
    const readOnly = output._entities('miner', { control: false }).map((c) => c.topic);

    expect(withControl.some((t) => t.includes('/switch/'))).toBe(true);
    expect(withControl.some((t) => t.includes('/select/'))).toBe(true);
    expect(readOnly.some((t) => t.includes('/switch/'))).toBe(false);
    expect(readOnly.some((t) => t.includes('/select/'))).toBe(false);
  });

  it('points each domain at its own topic', () => {
    expect(output._entities('node')[0].payload.state_topic).toBe(`apollo/${deviceId()}/node`);
    expect(output._entities('solo')[0].payload.state_topic).toBe(`apollo/${deviceId()}/solo`);
    expect(output._entities('mcu')[0].payload.state_topic).toBe(`apollo/${deviceId()}/mcu`);
  });

  it('groups every entity under one HA device with a shared availability topic', () => {
    ['miner', 'node', 'solo', 'mcu'].forEach((domain) => {
      output._entities(domain, { control: true }).forEach((c) => {
        expect(c.payload.device.identifiers).toContain(deviceId());
        expect(c.payload.availability_topic).toBe(`apollo/${deviceId()}/status`);
      });
    });
  });
});

describe('mqtt output — commands from home assistant', () => {
  it('starts and stops the miner as a user action (pauses automation)', async () => {
    await output.handleCommand(output.minerCmdTopic, 'ON');
    expect(deps.miner.start).toHaveBeenCalledWith({ source: 'user' });

    await output.handleCommand(output.minerCmdTopic, 'OFF');
    expect(deps.miner.stop).toHaveBeenCalledWith({ source: 'user' });
  });

  it('sets the mode and restarts a running miner', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    await output.handleCommand(output.modeCmdTopic, 'eco');

    expect(deps.settings.update).toHaveBeenCalledWith({ minerMode: 'eco' });
    expect(deps.miner.restart).toHaveBeenCalledWith({ source: 'user' });
  });

  it('does not restart a stopped miner when only the mode changes', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'offline' });

    await output.handleCommand(output.modeCmdTopic, 'balanced');

    expect(deps.settings.update).toHaveBeenCalledWith({ minerMode: 'balanced' });
    expect(deps.miner.restart).not.toHaveBeenCalled();
  });

  it('ignores an unknown mode', async () => {
    await output.handleCommand(output.modeCmdTopic, 'nitro');
    expect(deps.settings.update).not.toHaveBeenCalled();
  });

  it('ignores commands when control is disabled', async () => {
    deps.mqtt.getConfig.mockResolvedValue(mqttOn({ output: { enabled: true, control: false } }));

    await output.handleCommand(output.minerCmdTopic, 'ON');

    expect(deps.miner.start).not.toHaveBeenCalled();
  });

  it('ignores commands when output is disabled entirely', async () => {
    deps.mqtt.getConfig.mockResolvedValue(mqttOn({ enabled: false, output: { enabled: false, control: true } }));

    await output.handleCommand(output.minerCmdTopic, 'ON');

    expect(deps.miner.start).not.toHaveBeenCalled();
  });
});
