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

  it('serves canned output off-device, so the wifi pages can be opened in dev', async () => {
    // The old scanner had `wifi_scan_fake` behind NODE_ENV; going through the
    // real binary meant the page could not be rendered on a laptop at all.
    const missing = Object.assign(new Error('spawn nmcli ENOENT'), { code: 'ENOENT' });
    spawn.mockImplementation(() => {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('error', missing), 0);
      return child;
    });
    const svc = require('../src/services/wifi')();
    const networks = await svc.scan('wlan0', { rescan: false });
    expect(networks.length).toBeGreaterThan(0);
    // The awkward names are the point of the fixture: they are what broke the
    // bash parser this module replaced.
    expect(networks.map((n) => n.ssid)).toContain('Ospiti: casa "bella"');
    expect(networks.some((n) => n.hidden)).toBe(true);
  });

  it('still fails outright in production, where a missing nmcli is real', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const missing = Object.assign(new Error('spawn nmcli ENOENT'), { code: 'ENOENT' });
      spawn.mockImplementation(() => {
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setTimeout(() => child.emit('error', missing), 0);
        return child;
      });
      await expect(run(['dev'], { sudo: false })).rejects.toThrow('ENOENT');
    } finally {
      process.env.NODE_ENV = previous;
    }
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
      // `-g` asks for one property of one profile; the profile LIST is the
      // terse NAME,UUID,... query.
      const isSavedQuery =
        argv.includes('c') && argv.includes('show') && !argv.includes('-g');
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

  it('keeps a profile whose radio joined but is still waiting for an address', async () => {
    // A slow DHCP server put the lease past the verification window. The join
    // itself had worked, so deleting the profile tore the radio back off the
    // network and lost the passphrase the user had just typed.
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('c') && argv.includes('show') && !argv.includes('-g')) {
          const seen = calls.filter((x) => x.includes('wifi connect')).length > 0;
          c.stdout.emit('data', Buffer.from(seen ? savedList(['Slow']) : ''));
        } else if (argv.includes('dev') && argv.includes('show')) {
          // Associated, but the lease has not arrived: no IP4.ADDRESS line.
          c.stdout.emit('data', Buffer.from(''));
        } else if (argv.includes('dev') && !argv.includes('wifi')) {
          c.stdout.emit('data', Buffer.from('wlan0:wifi:connected:Slow'));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });

    const wifiService = require('../src/services/wifi');
    await expect(
      wifiService({ verifyTimeoutMs: 0 }).connect('wlan0', 'Slow', 'p')
    ).rejects.toMatchObject({ reason: 'no-ip-address' });
    expect(calls.some((c) => c.includes('c delete'))).toBe(false);
  });

  it('deletes nothing when it could not read what was saved beforehand', async () => {
    // A transient NetworkManager hiccup on the pre-flight read used to read as
    // "nothing is saved", which armed the cleanup against the user's own
    // long-standing profile — the outcome the pre-existing guard exists to stop.
    const calls = [];
    let savedReads = 0;
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      const isSavedQuery = argv.includes('c') && argv.includes('show') && !argv.includes('-g');
      setTimeout(() => {
        if (isSavedQuery) {
          savedReads += 1;
          if (savedReads === 1) {
            c.stderr.emit('data', Buffer.from('Error: NetworkManager is not running.'));
            c.emit('close', 8, null);
            return;
          }
          c.stdout.emit('data', Buffer.from(savedList(['HomeNet'])));
        } else if (argv.includes('connect')) {
          c.stderr.emit('data', Buffer.from('Error: Connection activation failed'));
          c.emit('close', 4, null);
          return;
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });

    const wifiService = require('../src/services/wifi');
    await expect(
      wifiService({ verifyTimeoutMs: 0 }).connect('wlan0', 'HomeNet', 'p')
    ).rejects.toMatchObject({ reason: 'activation-failed' });
    expect(calls.some((c) => c.includes('c delete'))).toBe(false);
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
        if (argv.includes('c') && argv.includes('show') && !argv.includes('-g')) {
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
    // The probe profile may be cleaned up; the user's own must not be, and it is
    // the only one addressed by uuid.
    expect(calls.some((c) => /^c delete uuid-\d+$/.test(c))).toBe(false);
  });
});

describe('joining a network that is already saved', () => {
  // `nmcli dev wifi connect <ssid> password <x>` builds a NEW profile, and once
  // one exists for that name it refuses with "802-11-wireless-security.key-mgmt:
  // property is missing" — even when the password is correct. Reproduced on
  // apollo3: connect, disconnect, and every later attempt was rejected. A saved
  // network is therefore activated, not re-created.
  // `properties` answers the `-g` reads: the ssid of a profile, and its stored
  // security. Anything not listed comes back empty, which is what nmcli prints
  // for a profile that never had that setting.
  const withSaved = (names, properties = {}) => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        const field = argv.includes('-g') ? argv[argv.indexOf('-g') + 1] : null;
        if (field) {
          c.stdout.emit('data', Buffer.from(properties[field] ?? ''));
        } else if (argv.includes('c') && argv.includes('show')) {
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




  it('sets hidden on the saved profile, not only on a freshly created one', async () => {
    // A profile saved without the flag left NetworkManager waiting for a beacon
    // a hidden network never sends, and the join timed out with nothing saying
    // the flag had been dropped.
    const calls = withSaved(['Ghost']);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0 });
    await svc.connect('wlan0', 'Ghost', null, { hidden: true }).catch(() => {});
    expect(calls.some((c) => c.includes('c modify uuid-0 802-11-wireless.hidden yes'))).toBe(true);
  });

  it('proves a new key on a throwaway profile, never on the saved one', async () => {
    // The stored key cannot be read back (nmcli answers an empty psk even with
    // --show-secrets), so overwriting it leaves nothing to restore. The new key
    // is tried on a probe profile instead.
    const calls = withSaved(['Wiffy']);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Wiffy', 'newpass').catch(() => {});
    expect(calls.some((c) => c.includes('c add type wifi con-name apollo-wifi-probe'))).toBe(true);
    // The saved profile's key is never rewritten before the new one is proven.
    expect(calls.some((c) => c.includes('c modify uuid-0 wifi-sec.psk'))).toBe(false);
  });

  it('leaves the saved profile alone when the new key does not work', async () => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('Wiffy:uuid-0:802-11-wireless::no'));
          c.emit('close', 0, null);
        } else if (argv.includes('up')) {
          c.stderr.emit('data', Buffer.from('Error: Connection activation failed'));
          c.emit('close', 4, null);
        } else {
          c.emit('close', 0, null);
        }
      }, 0);
      return c;
    });

    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await expect(svc.connect('wlan0', 'Wiffy', 'wrong')).rejects.toMatchObject({
      reason: 'activation-failed',
    });
    // The probe is deleted by its own name; the saved profile — addressed by
    // uuid — is never touched, so the network the user had keeps its key.
    expect(calls).toContain('c delete apollo-wifi-probe-uuid-0');
    expect(calls.some((c) => /^c delete uuid-0$/.test(c))).toBe(false);
  });

  it('still creates a profile for a network it has never seen', async () => {
    const calls = withSaved([]);
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'BrandNew', 'secret').catch(() => {});
    expect(calls.some((c) => c.includes('dev wifi connect BrandNew'))).toBe(true);
    expect(calls.some((c) => c.includes('c modify'))).toBe(false);
  });
});

describe('what the device is left with when the join is over', () => {
  // The whole connect state machine against one fake nmcli. `connectedOn` is the
  // radio the verification poll finds on the network — null is a join that never
  // landed — and `properties` answers the `-g` reads of a single profile.
  const nmcli = ({ saved = [], properties = {}, connectedOn = null, joins = true } = {}) => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        const field = argv.includes('-g') ? argv[argv.indexOf('-g') + 1] : null;
        if (field) {
          c.stdout.emit('data', Buffer.from(properties[field] ?? ''));
        } else if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from(saved.join('\n')));
        } else if (argv.includes('c') && argv.includes('up') && !joins) {
          c.stderr.emit('data', Buffer.from('Error: Connection activation failed'));
          c.emit('close', 4, null);
          return;
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        } else if (argv.includes('dev') && !argv.includes('wifi')) {
          c.stdout.emit(
            'data',
            Buffer.from(connectedOn ? `${connectedOn}:wifi:connected:Home` : '')
          );
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
    return calls;
  };

  const SAVED_HOME = 'Home:uuid-0:802-11-wireless::no';
  const service = () =>
    require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });

  it('turns autoconnect on, so the device rejoins after a reboot', async () => {
    // Every profile was built with `autoconnect no` and nothing switched it back
    // on: the join worked, and the next power cut left a wifi-only device off
    // the network for good — unreachable over the LAN it is administered from.
    const calls = nmcli({ connectedOn: 'wlan0' });
    await service().connect('wlan0', 'Home', 'secret', { band: 'bg' });
    expect(calls.some((c) => /^c modify \S+ connection\.autoconnect yes$/.test(c))).toBe(true);
  });

  it('keeps the working profile until the new key has really joined', async () => {
    // The old order deleted it as soon as `nmcli c up` returned 0 — which only
    // means the activation started. A join that stalls on DHCP then left no
    // working profile at all and nothing to fall back to.
    const calls = nmcli({ saved: [SAVED_HOME], connectedOn: null });
    await expect(service().connect('wlan0', 'Home', 'newkey')).rejects.toMatchObject({
      reason: 'not-confirmed',
    });
    expect(calls.some((c) => /^c delete uuid-0$/.test(c))).toBe(false);
    // and the radio is put back on what was serving it
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(true);
  });

  it('promotes the probe once the radio is actually on the network', async () => {
    const calls = nmcli({ saved: [SAVED_HOME], connectedOn: 'wlan0' });
    await expect(service().connect('wlan0', 'Home', 'newkey')).resolves.toMatchObject({
      connected: true,
    });
    expect(calls.some((c) => /^c delete uuid-0$/.test(c))).toBe(true);
    expect(calls.some((c) => /connection\.id Home$/.test(c))).toBe(true);
    expect(calls.some((c) => /connection\.autoconnect yes$/.test(c))).toBe(true);
  });

  it('leaves a band the user pinned earlier alone on a plain reconnect', async () => {
    // The UI's picker is per visit, so a reconnect carries no band. Writing ''
    // then silently un-pinned 2.4 GHz and let NetworkManager go back to 5 GHz —
    // the very failure the band choice exists to prevent.
    const calls = nmcli({ saved: [SAVED_HOME], connectedOn: 'wlan0' });
    await service().connect('wlan0', 'Home', null);
    expect(calls.some((c) => c.includes('802-11-wireless.band'))).toBe(false);
  });

  it('still clears it when the user picks auto', async () => {
    const calls = nmcli({ saved: [SAVED_HOME], connectedOn: 'wlan0' });
    await service().connect('wlan0', 'Home', null, { band: '' });
    expect(calls.some((c) => c.startsWith('c modify uuid-0 802-11-wireless.band'))).toBe(true);
  });

  it('releases a profile bound to the other radio instead of failing on it', async () => {
    // An Apollo II with a USB dongle: nmcli refuses a wlan0-bound profile on the
    // dongle with "not available on device", which reaches the user as "check
    // the password" — for a password that is right.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { 'connection.interface-name': 'wlan0' },
      connectedOn: 'wlx98',
    });
    await service().connect('wlx98', 'Home', null);
    expect(calls.some((c) => /^c modify uuid-0 connection\.interface-name/.test(c))).toBe(true);
  });

  it('releases the binding even when it matches the radio in use', async () => {
    // A profile tied to one radio cannot be activated — or AUTO-activated — on
    // another. On an Apollo II that pins the network to the USB dongle, so a
    // dongle unplugged or failed leaves the device unable to come back on the
    // built-in. The activation names the radio; the profile does not have to.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { 'connection.interface-name': 'wlan0' },
      connectedOn: 'wlan0',
    });
    await service().connect('wlan0', 'Home', null);
    expect(
      calls.some((c) => /^c modify \S+ connection\.interface-name\s*$/.test(c.trim()))
    ).toBe(true);
  });

  it('does not bind a profile it creates to the radio it was built on', async () => {
    const calls = nmcli({ saved: [], connectedOn: 'wlan0' });
    // The profile is built before the join is verified, and this fixture never
    // reports the radio landing on `Fresh` — the creation arguments are what
    // this pins down, so let the verification fail.
    await service().connect('wlan0', 'Fresh', 'secret', { band: 'bg' }).catch(() => {});
    const add = calls.find((c) => c.startsWith('c add type wifi'));
    expect(add).toBeDefined();
    expect(add).not.toContain('ifname');
  });
});

describe('the route lookup cannot hang the panel', () => {
  it('gives up on an `ip` that never answers', async () => {
    // listInterfaces is awaited by status(), by the connect verification poll and
    // by both wifi queries: an unbounded child here left the panel on its
    // loading skeleton until the API was restarted.
    jest.useFakeTimers();
    try {
      spawn.mockImplementation((cmd) => {
        const c = new EventEmitter();
        c.stdout = new EventEmitter();
        c.stderr = new EventEmitter();
        c.kill = jest.fn();
        // nmcli answers; `ip` is the one wedged in the kernel.
        if (cmd === 'ip') return c;
        setTimeout(() => {
          c.stdout.emit('data', Buffer.from('wlan0:wifi:connected:Home'));
          c.emit('close', 0, null);
        }, 0);
        return c;
      });

      const pending = require('../src/services/wifi')().listInterfaces();
      await jest.advanceTimersByTimeAsync(6000);
      await expect(pending).resolves.toEqual([
        expect.objectContaining({ device: 'wlan0', carriesDefaultRoute: false }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
