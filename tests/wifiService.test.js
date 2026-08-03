// tests/wifiService.test.js
const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
const { spawn } = require('child_process');
const { run } = require('../src/services/wifi/runner');

// A fake child whose exit we drive. jest.config has resetMocks, so the
// implementation is re-installed per test.
let child;
const install = ({ stdout = '', stderr = '', code = 0, signal = null, delay = 0 } = {}) => {
  spawn.mockImplementation((...args) => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    child.spawnArgs = args;
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code, signal);
    }, delay);
    return child;
  });
};

beforeEach(() => install());

describe('runner — nmcli is never handed to a shell', () => {
  it('passes arguments as argv, so an SSID cannot be interpreted', async () => {
    // The old disconnect built a shell string. An SSID is the neighbour's text;
    // through argv there is nothing to quote and nothing to escape.
    install({ stdout: 'ok' });
    await run(['dev', 'wifi', 'connect', '"; rm -rf /; #'], { sudo: false });
    const [cmd, argv] = spawn.mock.calls[0];
    // No shell in the chain, and the whole hostile string survives as ONE argv
    // element: nothing splits it, so nothing can execute it.
    expect(cmd).toBe('nmcli');
    expect(['sh', 'bash', '/bin/sh', '-c']).not.toContain(cmd);
    expect(argv.filter((a) => a === '"; rm -rf /; #')).toHaveLength(1);
  });

  it('prefixes sudo only when asked', async () => {
    install({ stdout: 'ok' });
    await run(['dev'], { sudo: true });
    expect(spawn.mock.calls[0][0]).toBe('sudo');
    expect(spawn.mock.calls[0][1][0]).toBe('nmcli');
  });

  it('rejects with the output on a non-zero exit', async () => {
    install({ stderr: "Error: No network with SSID 'X' found.", code: 10 });
    await expect(run(['x'], { sudo: false })).rejects.toThrow('No network with SSID');
  });

  it('kills a child that overruns and reports it as a timeout', async () => {
    // nmcli waits on the supplicant and can sit for minutes on a weak signal;
    // an unbounded child is a GraphQL request that never answers.
    spawn.mockImplementation(() => {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn(() => child.emit('close', null, 'SIGTERM'));
      return child;
    });
    const p = run(['dev', 'wifi', 'connect', 'Slow'], { sudo: false, timeoutMs: 20 });
    await expect(p).rejects.toMatchObject({ timedOut: true });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects when the binary is missing instead of hanging', async () => {
    spawn.mockImplementation(() => {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('error', new Error('ENOENT')), 0);
      return child;
    });
    await expect(run(['dev'], { sudo: false })).rejects.toThrow('ENOENT');
  });
});

describe('service — disconnect and forget are different operations', () => {
  const wifiService = require('../src/services/wifi');

  it('disconnect touches only the radio, and keeps the profile', async () => {
    install({ stdout: '' });
    await wifiService().disconnect('wlan0');
    const argv = spawn.mock.calls[0][1];
    expect(argv).toEqual(expect.arrayContaining(['dev', 'disconnect', 'wlan0']));
    // The bug being fixed: never `c delete` behind a disconnect.
    expect(argv).not.toContain('delete');
  });

  it('forget addresses ONE profile by uuid, never by a name match', async () => {
    // The old code deleted every connection whose row matched "wlan" — on an
    // Apollo II that is the link the built-in radio serves.
    install({ stdout: '' });
    await wifiService().forget('6502ecf9-01cf-44dc-8556-65592d68c2a7');
    const argv = spawn.mock.calls[0][1];
    expect(argv).toEqual(
      expect.arrayContaining(['c', 'delete', 'uuid', '6502ecf9-01cf-44dc-8556-65592d68c2a7'])
    );
  });

  it('scan asks the chosen radio, not "the wifi"', async () => {
    install({ stdout: '' });
    await wifiService().scan('wlx98254aa4b822', { rescan: false });
    const argv = spawn.mock.calls[0][1];
    expect(argv).toEqual(expect.arrayContaining(['ifname', 'wlx98254aa4b822']));
  });

  it('connect passes the passphrase as an argument, never interpolated', async () => {
    // Fail at the nmcli step so connect never enters its verification poll: a
    // loop left running here keeps calling spawn during the LATER tests and
    // silently swaps their mocks out from under them.
    install({ stderr: "Error: No network with SSID 'x' found.", code: 10 });
    await expect(
      wifiService().connect('wlan0', 'My:Net"work', "p'a$$ `word`")
    ).rejects.toMatchObject({ reason: 'ssid-not-found' });
    // connect first reads the saved profiles, so find the call that matters
    // instead of assuming it is the first one.
    const argv = spawn.mock.calls.map((c) => c[1]).find((a) => a.includes('connect'));
    expect(argv).toContain('My:Net"work');
    expect(argv).toContain("p'a$$ `word`");
  });
});

describe('a profile name is not an SSID', () => {
  // netplan — what Solo Node and Apollo III ship — names the profile for the
  // network `Home` `netplan-wlan0-Home`. Reporting or matching on that name
  // shows the user a generated string and never finds their saved network.
  const withNetplanProfile = () => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('-g') && argv.includes('802-11-wireless.ssid')) {
          c.stdout.emit('data', Buffer.from('Home\n'));
        } else if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit(
            'data',
            Buffer.from('netplan-wlan0-Home:uuid-np:802-11-wireless:wlan0:yes')
          );
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        } else if (argv.includes('dev')) {
          c.stdout.emit('data', Buffer.from('wlan0:wifi:connected:netplan-wlan0-Home'));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
    return calls;
  };

  it('reports the network the radio is on, not the generated profile name', async () => {
    withNetplanProfile();
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({ connected: true, ssid: 'Home' });
  });

  it('carries the ssid alongside the name on saved profiles', async () => {
    withNetplanProfile();
    const [saved] = await require('../src/services/wifi')().savedNetworks();
    expect(saved).toMatchObject({ name: 'netplan-wlan0-Home', ssid: 'Home' });
  });

  it('activates the saved profile instead of duplicating it', async () => {
    // Matching on the name alone missed, so every join built a second profile
    // for a network that was already there.
    const calls = withNetplanProfile();
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Home', null).catch(() => {});
    expect(calls.some((c) => c.startsWith('c up uuid-np'))).toBe(true);
    expect(calls.some((c) => c.includes('dev wifi connect'))).toBe(false);
  });
});

describe('status answers about the radio it was asked about', () => {
  const twoRadios = (line) => {
    spawn.mockImplementation((cmd, argv) => {
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('dev') && !argv.includes('show')) {
          c.stdout.emit('data', Buffer.from(line));
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
  };

  it('does not substitute another adapter when the named one is gone', async () => {
    // An Apollo II with the built-in on the LAN and a USB dongle unplugged: the
    // dongle drops out of `nmcli dev`, and answering with wlan0's SSID and IP
    // showed the missing adapter as connected to the house network.
    twoRadios('wlan0:wifi:connected:HomeNet');
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan1')).resolves.toMatchObject({
      connected: false,
      interface: 'wlan1',
    });
  });

  it('still picks the preferred radio when the caller names none', async () => {
    twoRadios('wlan0:wifi:connected:HomeNet');
    const svc = require('../src/services/wifi')();
    await expect(svc.status(null)).resolves.toMatchObject({
      connected: true,
      interface: 'wlan0',
    });
  });
});

describe('preferredInterface — which radio the UI should preselect', () => {
  const { preferredInterface } = require('../src/services/wifi')();

  it('prefers the one carrying the default route over the built-in', () => {
    // The Apollo II case: the built-in is on the inverter, the USB dongle is the
    // one with a way out. Picking "built-in" would target the wrong network.
    const chosen = preferredInterface([
      { device: 'wlan0', kind: 'builtin', connected: true, carriesDefaultRoute: false },
      { device: 'wlx98', kind: 'usb', connected: true, carriesDefaultRoute: true },
    ]);
    expect(chosen.device).toBe('wlx98');
  });

  it('falls back to the built-in when nothing is connected', () => {
    const chosen = preferredInterface([
      { device: 'wlx98', kind: 'usb', connected: false, carriesDefaultRoute: false },
      { device: 'wlan0', kind: 'builtin', connected: false, carriesDefaultRoute: false },
    ]);
    expect(chosen.device).toBe('wlan0');
  });

  it('returns null when the device has no wifi at all', () => {
    expect(preferredInterface([])).toBeNull();
  });
});

describe('disconnect is idempotent — already down is the asked-for outcome', () => {
  it('treats "device is not active" as success', async () => {
    // Observed on apollo3: nmcli exits non-zero when the radio is already down.
    // Reporting that as an error alarms someone who got what they wanted.
    install({
      stderr: "Error: Device 'wlP2p33s0' disconnecting failed: This device is not active",
      code: 1,
    });
    const wifiService = require('../src/services/wifi');
    await expect(wifiService().disconnect('wlP2p33s0')).resolves.toMatchObject({
      disconnected: true,
      alreadyDisconnected: true,
    });
  });

  it('still reports a genuine failure', async () => {
    install({ stderr: 'Error: Device not found', code: 1 });
    const wifiService = require('../src/services/wifi');
    await expect(wifiService().disconnect('nope0')).rejects.toThrow('Device not found');
  });
});

describe('a failed connect must not leave a poisoned profile behind', () => {
  // Observed on apollo3: `nmcli dev wifi connect` saves a profile even when the
  // passphrase is wrong, so one typo left the radio retrying against a bad key
  // and the correct password failed too.
  const savedList = (names) =>
    names.map((n, i) => `${n}:uuid-${i}:802-11-wireless::no`).join('\n');

  it('deletes the profile it just created', async () => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      const isSavedQuery = argv.includes('c') && argv.includes('show');
      // Before the attempt there is no Wiffy; after the failed connect there is.
      const already = calls.filter((x) => x.includes('wifi connect')).length > 0;
      setTimeout(() => {
        if (isSavedQuery) {
          c.stdout.emit('data', Buffer.from(savedList(already ? ['Wiffy'] : [])));
          c.emit('close', 0, null);
        } else if (argv.includes('connect')) {
          c.stderr.emit('data', Buffer.from('Error: Connection activation failed'));
          c.emit('close', 4, null);
        } else {
          c.emit('close', 0, null);
        }
      }, 0);
      return c;
    });

    const wifiService = require('../src/services/wifi');
    await expect(
      wifiService({ verifyTimeoutMs: 0 }).connect('wlan0', 'Wiffy', 'wrong')
    ).rejects.toMatchObject({ reason: 'activation-failed' });
    expect(calls.some((c) => c.includes('c delete uuid uuid-0'))).toBe(true);
  });

  it('leaves a profile the user already had alone', async () => {
    // It may hold a good key and have failed for a passing reason — out of
    // range, AP rebooting. Deleting it would lose a working network.
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from(savedList(['Wiffy'])));
          c.emit('close', 0, null);
        } else if (argv.includes('up') || argv.includes('connect')) {
          c.stderr.emit('data', Buffer.from("Error: No network with SSID 'Wiffy' found."));
          c.emit('close', 10, null);
        } else {
          c.emit('close', 0, null);
        }
      }, 0);
      return c;
    });

    const wifiService = require('../src/services/wifi');
    await expect(
      wifiService({ verifyTimeoutMs: 0 }).connect('wlan0', 'Wiffy', 'p')
    ).rejects.toMatchObject({ reason: 'ssid-not-found' });
    expect(calls.some((c) => c.includes('c delete'))).toBe(false);
  });
});

describe('joining a network that is already saved', () => {
  // `nmcli dev wifi connect <ssid> password <x>` builds a NEW profile, and once
  // one exists for that name it refuses with "802-11-wireless-security.key-mgmt:
  // property is missing" — even when the password is correct. Reproduced on
  // apollo3: connect, disconnect, and every later attempt was rejected. A saved
  // network is therefore activated, not re-created.
  const withSaved = (names) => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit(
            'data',
            Buffer.from(names.map((n, i) => `${n}:uuid-${i}:802-11-wireless::no`).join('\n'))
          );
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
    return calls;
  };

  it('activates the saved profile instead of building a new one', async () => {
    const calls = withSaved(['Wiffy']);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Wiffy', null).catch(() => {}); // verification is not the point
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(true);
    expect(calls.some((c) => c.includes('dev wifi connect'))).toBe(false);
  });

  it('updates the key on the saved profile when a passphrase is given', async () => {
    const calls = withSaved(['Wiffy']);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Wiffy', 'newpass').catch(() => {});
    // key-mgmt travels with the key: a profile that never had security set
    // rejects a bare psk.
    expect(
      calls.some((c) => c.includes('c modify uuid-0 wifi-sec.key-mgmt wpa-psk wifi-sec.psk newpass'))
    ).toBe(true);
  });

  it('still creates a profile for a network it has never seen', async () => {
    const calls = withSaved([]);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'BrandNew', 'secret').catch(() => {});
    expect(calls.some((c) => c.includes('dev wifi connect BrandNew'))).toBe(true);
    expect(calls.some((c) => c.includes('c modify'))).toBe(false);
  });
});
