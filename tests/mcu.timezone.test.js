const { knex } = require('../src/db');
const childProcess = require('child_process');
const fsPromises = require('fs').promises;
const os = require('os');

const mcu = require('../src/services/mcu')(knex, {});

// Fake `timedatectl`, and record exactly how it was invoked: the point of this
// file is that a user-supplied timezone never reaches a shell.
const mockSpawn = (impl) => {
  childProcess.spawn.mockImplementation((command, args) => {
    const listeners = {};
    const stdoutHandlers = [];
    const stderrHandlers = [];

    const { stdout = '', stderr = '', code = 0 } = impl(command, args) || {};

    setImmediate(() => {
      if (stdout) stdoutHandlers.forEach((h) => h(stdout));
      if (stderr) stderrHandlers.forEach((h) => h(stderr));
      if (listeners.close) listeners.close(code);
    });

    return {
      stdout: { on: (_, h) => stdoutHandlers.push(h) },
      stderr: { on: (_, h) => stderrHandlers.push(h) },
      on: (event, handler) => {
        listeners[event] = handler;
      },
    };
  });
};

// Simulate a platform without timedatectl (macOS dev): spawn fails to launch.
const mockSpawnENOENT = () => {
  childProcess.spawn.mockImplementation(() => {
    const listeners = {};
    setImmediate(() => {
      if (listeners.error) listeners.error(Object.assign(new Error('spawn timedatectl ENOENT'), { code: 'ENOENT' }));
    });
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, handler) => {
        listeners[event] = handler;
      },
    };
  });
};

const ZONES = 'Europe/Rome\nAmerica/New_York\nUTC\n';

beforeEach(() => {
  mockSpawn((command, args) => {
    if (args.includes('list-timezones')) return { stdout: ZONES };
    if (args.includes('--value')) return { stdout: 'America/New_York\n' };
    return { stdout: '' };
  });
});

describe('Mcu.getTimezone', () => {
  it('reads the current zone and the ones the device accepts', async () => {
    const result = await mcu.getTimezone();

    expect(result.timezone).toBe('America/New_York');
    expect(result.available).toEqual(['Europe/Rome', 'America/New_York', 'UTC']);
  });

  it('never goes through a shell', async () => {
    await mcu.getTimezone();

    for (const call of childProcess.spawn.mock.calls) {
      expect(Array.isArray(call[1])).toBe(true); // argv array, not a command string
      expect(call[2]?.shell).toBeFalsy();
    }
  });

  it('falls back to the platform IANA data when timedatectl is missing (dev on macOS)', async () => {
    mockSpawnENOENT();

    const result = await mcu.getTimezone();

    // No throw, a usable current zone, and a non-trivial list to pick from.
    expect(result.timezone).toBeTruthy();
    expect(result.available.length).toBeGreaterThan(10);
    expect(result.available).toContain(result.timezone);
  });
});

describe('Mcu.setTimezone', () => {
  it('passes the zone as an argv element, not as shell text', async () => {
    process.env.NODE_ENV = 'production';

    await mcu.setTimezone({ timezone: 'Europe/Rome' });

    const call = childProcess.spawn.mock.calls.find((c) => c[1].includes('set-timezone'));
    expect(call[0]).toBe('sudo');
    expect(call[1]).toEqual(['timedatectl', 'set-timezone', 'Europe/Rome']);

    process.env.NODE_ENV = 'test';
  });

  it('refuses a zone the system does not know — including a shell injection attempt', async () => {
    process.env.NODE_ENV = 'production';

    await expect(mcu.setTimezone({ timezone: 'Europe/Rome; rm -rf /' })).rejects.toThrow(
      /Unknown timezone/
    );

    // Nothing was executed beyond the two reads used to validate.
    const executed = childProcess.spawn.mock.calls.filter((c) => c[1].includes('set-timezone'));
    expect(executed).toHaveLength(0);

    process.env.NODE_ENV = 'test';
  });

  it('does not touch the system clock outside production', async () => {
    await mcu.setTimezone({ timezone: 'UTC' });

    const executed = childProcess.spawn.mock.calls.filter((c) => c[1].includes('set-timezone'));
    expect(executed).toHaveLength(0);
  });

  it('works in dev without timedatectl, validating against the fallback list', async () => {
    mockSpawnENOENT(); // NODE_ENV is 'test' here → dev path, no set-timezone spawn

    // A real IANA zone is accepted (validated against the Intl fallback), no throw.
    const result = await mcu.setTimezone({ timezone: 'Europe/Rome' });
    expect(result.available).toContain('Europe/Rome');

    // A bogus zone is still rejected.
    await expect(mcu.setTimezone({ timezone: 'Mars/Olympus' })).rejects.toThrow(/Unknown timezone/);
  });
});

// The warning the UI shows has to survive a reload and a different browser, so
// it is derived from the device: /etc/localtime rewritten after boot means the
// running services still carry the old zone.
describe('Mcu.getTimezone — reboot still owed', () => {
  const bootedAgo = (seconds) => jest.spyOn(os, 'uptime').mockReturnValue(seconds);
  const localtimeChangedAt = (ms) => fsPromises.lstat.mockResolvedValue({ mtimeMs: ms });

  afterEach(() => {
    jest.restoreAllMocks();
    fsPromises.lstat.mockResolvedValue({ mtimeMs: 0 });
  });

  it('asks for a reboot when the zone changed after boot', async () => {
    bootedAgo(3600); // booted an hour ago
    localtimeChangedAt(Date.now() - 60 * 1000); // zone changed a minute ago

    expect((await mcu.getTimezone()).rebootPending).toBe(true);
  });

  it('stays quiet when the zone predates the boot', async () => {
    bootedAgo(600); // booted ten minutes ago
    localtimeChangedAt(Date.now() - 86400 * 1000); // zone set yesterday

    expect((await mcu.getTimezone()).rebootPending).toBe(false);
  });

  it('stays quiet where there is no /etc/localtime at all (dev on macOS)', async () => {
    fsPromises.lstat.mockRejectedValue(new Error('ENOENT'));

    expect((await mcu.getTimezone()).rebootPending).toBe(false);
  });
});

describe('Mcu.setTimezone — picking the zone it is already on', () => {
  it('does not rewrite /etc/localtime, so no reboot is demanded', async () => {
    process.env.NODE_ENV = 'production';

    // The mocked timedatectl reports America/New_York as the current zone.
    await mcu.setTimezone({ timezone: 'America/New_York' });

    const wrote = childProcess.spawn.mock.calls.filter((c) => c[1].includes('set-timezone'));
    expect(wrote).toHaveLength(0);
  });
});
