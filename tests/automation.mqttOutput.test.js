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

describe('mqtt output — telemetry', () => {
  it('aggregates the boards and derives the labels', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    const t = await output.buildTelemetry();

    expect(t).toEqual({
      mining: 'ON',
      hashrate: 0.3, // (100 + 200) GH/s -> TH/s
      power: 100, // 50 + 50
      temp: 70, // hottest board
      mode: 'turbo',
      automation: 'on',
    });
  });

  it('reports OFF and observing when the miner is stopped and automation is dry-run', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'offline' });
    deps.automation.getConfig.mockResolvedValue(autoCfg({ dryRun: true }));

    const t = await output.buildTelemetry();

    expect(t.mining).toBe('OFF');
    expect(t.automation).toBe('observing');
  });

  it('coerces a string temperature (the stat file sends strings)', async () => {
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });
    deps.miner.getStats.mockResolvedValue({ stats: [board('120', '48', '66.5')] });

    const t = await output.buildTelemetry();

    expect(t.temp).toBe(66.5);
    expect(t.hashrate).toBe(0.12); // 120 GH/s -> TH/s
  });
});

describe('mqtt output — home assistant discovery', () => {
  it('adds a switch and a select only when control is allowed', () => {
    const withControl = output._discoveryConfigs({ control: true }).map((c) => c.topic);
    const readOnly = output._discoveryConfigs({ control: false }).map((c) => c.topic);

    expect(withControl.some((t) => t.includes('/switch/'))).toBe(true);
    expect(withControl.some((t) => t.includes('/select/'))).toBe(true);
    expect(readOnly.some((t) => t.includes('/switch/'))).toBe(false);
    expect(readOnly.some((t) => t.includes('/select/'))).toBe(false);
  });

  it('groups every entity under one HA device with a shared availability topic', () => {
    const configs = output._discoveryConfigs({ control: true });
    configs.forEach((c) => {
      expect(c.payload.device.identifiers).toContain(deviceId());
      expect(c.payload.availability_topic).toBe(`apollo/${deviceId()}/status`);
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
