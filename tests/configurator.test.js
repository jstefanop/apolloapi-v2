const fs = require('fs');
const generate = require('../src/configurator');

// Unit test for the miner CLI-args generator (area E). Passing pools+settings
// explicitly keeps it off the DB/fs; we assert the exact string written to
// the legacy and Apollo III miner config files.

const writtenFiles = () => {
  const out = {};
  for (const [file, content] of fs.promises.writeFile.mock.calls) {
    if (file.endsWith('/miner_config')) out.config = content;
    if (file.endsWith('/miner_config3')) out.config3 = content;
    if (file.endsWith('/mode')) out.mode = content;
  }
  return out;
};

const pool = (over = {}) => ({
  enabled: 1,
  url: 'stratum+tcp://pool.example.com:3333',
  username: 'wallet.worker',
  password: 'x',
  index: 0,
  ...over,
});

const baseSettings = (over = {}) => ({
  minerMode: 'balanced',
  voltage: 30,
  frequency: 25,
  fan_low: 40,
  fan_high: 60,
  powerLedOff: false,
  ...over,
});

describe('configurator — miner CLI args', () => {
  it('builds base host/port/user/pswd and strips the url scheme', async () => {
    await generate([pool()], baseSettings());
    const { config, config3, mode } = writtenFiles();
    const expected = '-host pool.example.com -port 3333 -user wallet.worker -pswd x -powermode balanced';
    expect(config).toBe(expected);
    expect(config3).toBe(expected);
    expect(mode).toBeUndefined();
  });

  it('custom mode adds tuning args and powermode config to both files', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom', voltage: 32, frequency: 28 }));
    const { config, config3 } = writtenFiles();
    expect(config).toContain('-brd_ocp 32 -osc 28');
    expect(config).toContain('-powermode config');
    expect(config3).toContain('-brd_ocp 32 -osc 28');
    expect(config3).toContain('-powermode config');
  });

  it('maps super-eco to eco only for legacy miners', async () => {
    await generate([pool()], baseSettings({ minerMode: 'super-eco' }));
    const { config, config3 } = writtenFiles();
    expect(config).toContain('-powermode eco');
    expect(config3).toContain('-powermode super-eco');
  });

  it('omits fan args at default thresholds (40/60), includes them otherwise', async () => {
    await generate([pool()], baseSettings({ fan_low: 40, fan_high: 60 }));
    expect(writtenFiles().config).not.toMatch(/-fan_temp_/);

    fs.promises.writeFile.mockClear();
    await generate([pool()], baseSettings({ fan_low: 45, fan_high: 70 }));
    expect(writtenFiles().config).toContain('-fan_temp_low 45 -fan_temp_hi 70');
  });

  it('adds -pwrled off when powerLedOff is set', async () => {
    await generate([pool()], baseSettings({ powerLedOff: true }));
    expect(writtenFiles().config).toContain('-pwrled off');
  });

  it('picks the lowest-index enabled pool as main', async () => {
    const pools = [
      pool({ index: 2, url: 'stratum+tcp://high.example:1111', username: 'high' }),
      pool({ index: 0, url: 'stratum+tcp://main.example:2222', username: 'main' }),
      pool({ index: 1, enabled: 0, url: 'stratum+tcp://disabled.example:3333', username: 'off' }),
    ];
    await generate(pools, baseSettings());
    expect(writtenFiles().config).toContain('-host main.example -port 2222 -user main');
  });

  it('skips configuration when no pool has a url', async () => {
    await generate([pool({ url: '' })], baseSettings());
    expect(writtenFiles().config).toBeUndefined();
  });
});
