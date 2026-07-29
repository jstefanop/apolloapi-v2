const fs = require('fs');
const generate = require('../src/configurator');

// Unit test for the miner CLI-args generator. Passing pools+settings explicitly
// keeps it off the DB/fs; we assert the exact string written to the legacy and
// Apollo III miner config files.
//
// The two files are NOT variations of each other: apollo-miner (USB) and
// apollo-miner-v3 accept different flags, and the V3 binary rejects the legacy
// tuning ones. So the Apollo III assertions below are mostly about what must NOT
// be in that file.

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

describe('configurator — shared arguments', () => {
  it('builds base host/port/user/pswd and strips the url scheme', async () => {
    await generate([pool()], baseSettings());
    const { config, config3, mode } = writtenFiles();
    const expected = '-host pool.example.com -port 3333 -user wallet.worker -pswd x -powermode balanced';
    expect(config).toBe(expected);
    expect(config3).toBe(expected);
    // The mode file is deprecated: the power mode lives in the config files now.
    expect(mode).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['whitespace-only', '   '],
  ])('omits an %s optional primary password', async (_label, password) => {
    await generate([pool({ password })], baseSettings());
    const { config, config3 } = writtenFiles();
    const expected = '-host pool.example.com -port 3333 -user wallet.worker -powermode balanced';

    expect(config).toBe(expected);
    expect(config3).toBe(expected);
  });

  it('adds -pwrled off when powerLedOff is set', async () => {
    await generate([pool()], baseSettings({ powerLedOff: true }));
    const { config, config3 } = writtenFiles();
    expect(config).toContain('-pwrled off');
    expect(config3).toContain('-pwrled off');
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

describe('configurator — Apollo I/II (legacy USB)', () => {
  it('custom mode drives board voltage and oscillator, reported as powermode config', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom', voltage: 32, frequency: 28 }));
    const { config } = writtenFiles();
    expect(config).toContain('-brd_ocp 32 -osc 28');
    expect(config).toContain('-powermode config');
  });

  it('falls back to eco for super_eco, which is an Apollo III mode', async () => {
    await generate([pool()], baseSettings({ minerMode: 'super_eco' }));
    expect(writtenFiles().config).toContain('-powermode eco');
  });

  it('omits fan args at default thresholds (40/60), includes them otherwise', async () => {
    await generate([pool()], baseSettings({ fan_low: 40, fan_high: 60 }));
    expect(writtenFiles().config).not.toMatch(/-fan_temp_/);

    fs.promises.writeFile.mockClear();
    await generate([pool()], baseSettings({ fan_low: 45, fan_high: 70 }));
    expect(writtenFiles().config).toContain('-fan_temp_low 45 -fan_temp_hi 70');
  });
});

describe('configurator — Apollo III', () => {
  it('never emits the legacy tuning flags, which the V3 binary rejects', async () => {
    await generate(
      [pool()],
      baseSettings({ minerMode: 'custom', voltage: 32, frequency: 28, fan_low: 45, fan_high: 70 })
    );
    const { config3 } = writtenFiles();
    expect(config3).not.toContain('-brd_ocp');
    expect(config3).not.toContain('-osc');
    expect(config3).not.toContain('-fan_temp_low');
    expect(config3).not.toContain('-fan_temp_hi');
    // `config` is not a V3 power mode either.
    expect(config3).not.toContain('-powermode config');
  });

  it('takes the backup pool, which the USB binaries have no flags for', async () => {
    const pools = [
      pool({ index: 0, url: 'stratum+tcp://main.example:1111', username: 'main' }),
      pool({ index: 1, url: 'stratum+tcp://backup.example:2222', username: 'backup', password: 'y' }),
    ];
    await generate(pools, baseSettings());
    const { config, config3 } = writtenFiles();
    const backup = '-host2 backup.example -port2 2222 -user2 backup -pswd2 y';

    expect(config3).toContain(backup);
    // Failover is Apollo III only: emitting it for Apollo I/II would hand the
    // legacy binary flags it does not define.
    expect(config).not.toContain('-host2');
    expect(config).toContain('-host main.example');
  });

  it('omits an empty optional backup password without consuming the next flag', async () => {
    const pools = [
      pool({ index: 0, url: 'stratum+tcp://main.example:1111', username: 'main' }),
      pool({
        index: 1,
        url: 'stratum+tcp://backup.example:2222',
        username: 'backup',
        password: '',
      }),
    ];
    await generate(pools, baseSettings());
    const { config3 } = writtenFiles();

    expect(config3).toContain('-host2 backup.example -port2 2222 -user2 backup -powermode balanced');
    expect(config3).not.toContain('-pswd2');
  });

  it('spells Super ECO as supereco, the way the binary expects', async () => {
    await generate([pool()], baseSettings({ minerMode: 'super_eco' }));
    expect(writtenFiles().config3).toContain('-powermode supereco');
  });

  it('custom mode is a target hashrate', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom', minerHashrate: 18 }));
    const { config3 } = writtenFiles();
    expect(config3).toContain('-powermode custom');
    expect(config3).toContain('-hashrate 18');
  });

  it('clamps the target hashrate to the range the UI exposes (5-20)', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom', minerHashrate: 99 }));
    expect(writtenFiles().config3).toContain('-hashrate 20');

    fs.promises.writeFile.mockClear();
    await generate([pool()], baseSettings({ minerMode: 'custom', minerHashrate: 1 }));
    expect(writtenFiles().config3).toContain('-hashrate 5');
  });

  it('does not emit -powermode custom without a hashrate to act on', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom' }));
    const { config3 } = writtenFiles();
    expect(config3).not.toContain('-powermode custom');
    expect(config3).toContain('-powermode eco');
  });

  it('keeps fan settings orthogonal to the power mode', async () => {
    // The III is far more sensitive to fan settings, so tuning the fan must not
    // force the user out of eco/balanced into custom.
    await generate([pool()], baseSettings({ minerMode: 'eco', fanTemp: 55 }));
    const { config3 } = writtenFiles();
    expect(config3).toContain('-powermode eco');
    expect(config3).toContain('-fan_temp 55');
  });

  it('a fixed PWM replaces automatic fan control rather than adding to it', async () => {
    await generate([pool()], baseSettings({ fanTemp: 55, fanPwm: 80 }));
    const { config3 } = writtenFiles();
    expect(config3).toContain('-fan_pwm 80');
    expect(config3).not.toContain('-fan_temp ');
  });

  it('treats 0 as "no fixed speed", not as a request for the minimum', async () => {
    // 0 is the natural way an API client says "no override", but it used to
    // select the fixed-PWM branch and clamp up to 10 — pinning the fans at their
    // slowest with the PID loop switched off, which is the opposite.
    await generate([pool()], baseSettings({ fanPwm: 0, fanTemp: 55 }));
    const { config3 } = writtenFiles();
    expect(config3).not.toContain('-fan_pwm');
    expect(config3).toContain('-fan_temp 55');
  });

  it('ignores a zero hashrate rather than emitting custom mode for it', async () => {
    await generate([pool()], baseSettings({ minerMode: 'custom', minerHashrate: 0 }));
    const { config3 } = writtenFiles();
    expect(config3).not.toContain('-hashrate');
    expect(config3).toContain('-powermode eco');
  });

  it('clamps fan values to the ranges the binary accepts', async () => {
    await generate([pool()], baseSettings({ fanTemp: 200 }));
    expect(writtenFiles().config3).toContain('-fan_temp 80');

    fs.promises.writeFile.mockClear();
    await generate([pool()], baseSettings({ fanPwm: 5 }));
    expect(writtenFiles().config3).toContain('-fan_pwm 10');
  });
});
