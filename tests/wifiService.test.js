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
    // Both operations read what they are about to act on first, so find the call
    // that matters rather than assuming it is the first one.
    const argv = spawn.mock.calls.map((c) => c[1]).find((a) => a.includes('disconnect'));
    expect(argv).toEqual(expect.arrayContaining(['dev', 'disconnect', 'wlan0']));
    // The bug being fixed: never `c delete` behind a disconnect.
    expect(argv).not.toContain('delete');
  });

  it('forget addresses ONE profile by uuid, never by a name match', async () => {
    // The old code deleted every connection whose row matched "wlan" — on an
    // Apollo II that is the link the built-in radio serves.
    install({ stdout: '' });
    await wifiService().forget('6502ecf9-01cf-44dc-8556-65592d68c2a7');
    const argv = spawn.mock.calls.map((c) => c[1]).find((a) => a.includes('delete'));
    expect(argv).toEqual(
      expect.arrayContaining(['c', 'delete', 'uuid', '6502ecf9-01cf-44dc-8556-65592d68c2a7'])
    );
  });

  it('refuses to disconnect something that is not a radio', async () => {
    // A stale ifname from an open panel, or a caller that is not the shipped UI:
    // `nmcli dev disconnect eth0` takes an Apollo off the Ethernet it is
    // administered over, and nothing brings it back at the next boot.
    install({ stdout: 'eth0:ethernet:connected:Wired connection 1' });
    await expect(wifiService().disconnect('eth0')).rejects.toMatchObject({
      reason: 'not-a-wifi-interface',
    });
    expect(spawn.mock.calls.map((c) => c[1]).some((a) => a.includes('disconnect'))).toBe(false);
  });

  it('refuses to forget a profile that is not wifi', async () => {
    install({ stdout: '802-3-ethernet' });
    await expect(wifiService().forget('1f0b0b3e-0000-4000-8000-0000000000ff')).rejects.toMatchObject(
      { reason: 'not-a-wifi-profile' }
    );
    expect(spawn.mock.calls.map((c) => c[1]).some((a) => a.includes('delete'))).toBe(false);
  });

  it('scan asks the chosen radio, not "the wifi"', async () => {
    install({ stdout: '' });
    await wifiService().scan('wlx98254aa4b822', { rescan: false });
    const argv = spawn.mock.calls[0][1];
    expect(argv).toEqual(expect.arrayContaining(['ifname', 'wlx98254aa4b822']));
  });

  it('really suppresses the scan when asked for the cache', async () => {
    // Skipping the explicit `dev wifi rescan` is not enough: nmcli's default is
    // `--rescan auto`, which scans on its own once the cache is 30s old. On the
    // join path — which reads the cache precisely because the radio is about to
    // associate — that disassociates it for the length of a scan.
    install({ stdout: '' });
    await wifiService().scan('wlan0', { rescan: false });
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--rescan', 'no']));
  });

  it('leaves probe profiles out of the saved networks it reports', async () => {
    // A probe outlives its attempt when apollo-api dies mid-join. Reported as a
    // saved network it resolves to the real SSID, so the panel shows the network
    // twice and Forget can be pressed on the internal one.
    install({
      stdout: [
        'apollo-wifi-probe-uuid-0:uuid-9:802-11-wireless::no',
        'Home:uuid-0:802-11-wireless::no',
      ].join('\n'),
    });
    const saved = await wifiService().savedNetworks();
    expect(saved.map((n) => n.uuid)).toEqual(['uuid-0']);
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

  it('reads a qualified state as connected', async () => {
    // nmcli says `connected (site only)` for a network with no way out — a
    // captive portal, a router whose WAN is down. The radio IS associated, and
    // an exact match on the bare word reported it as disconnected: no SSID, no
    // Disconnect button, and a first-time join deleted its own profile as
    // unconfirmed.
    twoRadios('wlan0:wifi:connected (site only):HomeNet');
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({
      connected: true,
      interface: 'wlan0',
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

  it('still reports a genuine failure, with a reason of its own', async () => {
    // Classified, not raw: an error without a `reason` reaches the panel through
    // the connect-specific fallback, which tells someone who asked to LEAVE a
    // network that the device could not join it. nmcli's own words stay in
    // `detail`, for the journal.
    install({ stderr: 'Error: Device not found', code: 1 });
    const wifiService = require('../src/services/wifi');
    await expect(wifiService().disconnect('nope0')).rejects.toMatchObject({
      reason: 'disconnect-failed',
      detail: expect.stringContaining('Device not found'),
    });
  });

  it('classifies a failed forget too, instead of rethrowing nmcli', async () => {
    install({ stderr: 'Error: Connection could not be deleted', code: 1 });
    const wifiService = require('../src/services/wifi');
    await expect(
      wifiService().forget('6502ecf9-01cf-44dc-8556-65592d68c2a7')
    ).rejects.toMatchObject({ reason: 'forget-failed' });
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
    const calls = nmcli({ saved: ['Home:uuid-0:802-11-wireless:wlan0:yes'], connectedOn: null });
    await expect(service().connect('wlan0', 'Home', 'newkey')).rejects.toMatchObject({
      reason: 'not-confirmed',
    });
    expect(calls.some((c) => /^c delete uuid-0$/.test(c))).toBe(false);
    // and the radio is put back on what was serving it
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(true);
  });

  it('puts the radio back on the network it was on, not on the one it was trying', async () => {
    // A wifi-only Apollo administered over `Other` while the user retries the
    // key of `Home`. The probe takes the radio off `Other`; rolling back onto
    // `Home` — inactive, and holding the key that was just refused — moves the
    // device onto a network it was never on and drops the session with it.
    const calls = nmcli({
      saved: ['Other:uuid-7:802-11-wireless:wlan0:yes', SAVED_HOME],
      properties: { '802-11-wireless.ssid': '' },
      connectedOn: null,
    });
    await expect(service().connect('wlan0', 'Home', 'newkey')).rejects.toMatchObject({
      reason: 'not-confirmed',
    });
    expect(calls.some((c) => c.startsWith('c up uuid-7'))).toBe(true);
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(false);
  });

  it('restores nothing when the radio was on nothing', async () => {
    const calls = nmcli({ saved: [SAVED_HOME], connectedOn: null });
    await expect(service().connect('wlan0', 'Home', 'newkey')).rejects.toMatchObject({
      reason: 'not-confirmed',
    });
    expect(calls.some((c) => /^c up uuid-\d+/.test(c))).toBe(false);
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

  it('carries the retired profile’s band pin onto the probe that replaces it', async () => {
    // The probe is built from what the caller sent, and a retyped password sends
    // no band. Promoting it as-is dropped a pin made in an earlier session:
    // NetworkManager then prefers 5 GHz, which the built-in radio of an Apollo II
    // may not hold, and the device does not come back from the next power cut.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { '802-11-wireless.band': 'bg' },
      connectedOn: 'wlan0',
    });
    await service().connect('wlan0', 'Home', 'newkey');
    expect(
      calls.some((c) => /^c modify apollo-wifi-probe\S* 802-11-wireless\.band bg$/.test(c))
    ).toBe(true);
  });

  it('does not rename the probe over a profile it failed to delete', async () => {
    // Two profiles under one id, both autoconnecting and one holding the stale
    // key, is a device that can pick the wrong one at the next boot. The delete
    // failing used to be swallowed and the rename went ahead anyway.
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.join(' ') === 'c delete uuid-0') {
          c.stderr.emit('data', Buffer.from('Error: Connection is read-only'));
          c.emit('close', 1, null);
          return;
        }
        if (argv.includes('-g')) {
          c.stdout.emit('data', Buffer.from(''));
        } else if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from(SAVED_HOME));
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        } else if (argv.includes('dev') && !argv.includes('wifi')) {
          c.stdout.emit('data', Buffer.from('wlan0:wifi:connected:Home'));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });

    await service().connect('wlan0', 'Home', 'newkey');
    expect(calls.some((c) => /connection\.id Home$/.test(c))).toBe(false);
    expect(calls.some((c) => c.includes('connection.id Home (wlan0)'))).toBe(true);
    // and the one that could not be removed is taken out of the running, so the
    // stale key cannot win the next boot
    expect(calls).toContain('c modify uuid-0 connection.autoconnect no');
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

  it('binds the profile to the radio it ended up on, never leaving it unbound', async () => {
    // The release is only justified by the activation it was made for. Once that
    // activation has landed the profile belongs to THIS radio; left naming none,
    // NetworkManager auto-activates it on whichever adapter comes up first at the
    // next boot — a network moved onto the wrong radio, which is exactly what the
    // binding exists to prevent.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { 'connection.interface-name': 'wlan0' },
      connectedOn: 'wlx98',
    });
    await service().connect('wlx98', 'Home', null);
    expect(calls).toContain('c modify uuid-0 connection.interface-name wlx98');
  });

  it('takes back a band it pinned for an activation that never landed', async () => {
    // The pin is written before the activation because the activation has to
    // honour it. When the radio cannot hold that band the write outlives the
    // attempt: an autoconnecting profile pinned to a band it can never satisfy
    // stops rejoining at all, and a wifi-only device needs physical access.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { '802-11-wireless.band': 'bg' },
      joins: false,
    });
    await expect(service().connect('wlan0', 'Home', null, { band: 'a' })).rejects.toMatchObject({
      reason: 'activation-failed',
    });
    expect(calls).toContain('c modify uuid-0 802-11-wireless.band a');
    expect(calls.lastIndexOf('c modify uuid-0 802-11-wireless.band bg')).toBeGreaterThan(
      calls.indexOf('c modify uuid-0 802-11-wireless.band a')
    );
  });

  it('places an idle profile by its binding, since nmcli names no device on one', async () => {
    // Two saved profiles for one network, one per radio, neither active: the
    // DEVICE column is empty on both, so "the one on THIS radio" matched neither
    // and the first row won — a join on the dongle rewriting, or deleting, the
    // profile the built-in owns.
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('-g')) {
          const field = argv[argv.indexOf('-g') + 1];
          const uuid = argv[argv.indexOf('show') + 1];
          if (field === 'connection.interface-name')
            c.stdout.emit('data', Buffer.from(uuid === 'uuid-0' ? 'wlan0' : 'wlx98'));
        } else if (argv.includes('c') && argv.includes('show')) {
          c.stdout.emit(
            'data',
            Buffer.from('Home:uuid-0:802-11-wireless::no\nHome:uuid-1:802-11-wireless::no')
          );
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        } else if (argv.includes('dev') && !argv.includes('wifi')) {
          c.stdout.emit('data', Buffer.from('wlx98:wifi:connected:Home'));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });

    await service().connect('wlx98', 'Home', null);
    expect(calls.some((c) => c.startsWith('c up uuid-1'))).toBe(true);
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(false);
  });

  it('leaves a binding that already names the radio in use', async () => {
    // On a device with two radios the binding is what keeps each network on the
    // adapter it belongs to — observed on apollo2, where the house network lives
    // on the USB dongle and the inverter on the built-in, every profile bound.
    // Stripping it lets NetworkManager move a network onto the wrong adapter,
    // including the one serving the session doing the stripping.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { 'connection.interface-name': 'wlan0' },
      connectedOn: 'wlan0',
    });
    await service().connect('wlan0', 'Home', null);
    expect(
      calls.some((c) => /^c modify \S+ connection\.interface-name\s*$/.test(c.trim()))
    ).toBe(false);
  });

  it('keeps the profile the OTHER radio is running instead of deleting it', async () => {
    // An Apollo II administered over its USB dongle, with the built-in joining
    // the same network: promoting the probe over the saved profile would tear
    // down the link the request arrived on. Each radio keeps a profile.
    const calls = nmcli({
      saved: ['Home:uuid-0:802-11-wireless:wlx98:yes'],
      connectedOn: 'wlan0',
    });
    await service().connect('wlan0', 'Home', 'newkey');
    expect(calls.some((c) => /^c delete uuid-0$/.test(c))).toBe(false);
    expect(calls.some((c) => c.includes('connection.id Home (wlan0)'))).toBe(true);
  });

  it('puts a released binding back when the activation it was released for fails', async () => {
    // The binding is only given up to let THIS activation through. Left off, the
    // profile auto-activates on whichever radio is free at the next boot — the
    // network moved onto the wrong adapter, which is what the binding prevents.
    const calls = nmcli({
      saved: [SAVED_HOME],
      properties: { 'connection.interface-name': 'wlan0' },
      joins: false,
    });
    await expect(service().connect('wlx98', 'Home', null)).rejects.toMatchObject({
      reason: 'activation-failed',
    });
    expect(calls).toContain('c modify uuid-0 connection.interface-name wlan0');
  });

  it('clears a probe left behind by an API restart, and never promotes over it', async () => {
    // A probe outlives its attempt when apollo-api dies mid-join. It then shows
    // up in the saved list under its internal name, and the next attempt could
    // pick it as the saved profile — leaving the real one holding the stale key.
    const calls = nmcli({
      saved: ['apollo-wifi-probe-uuid-0:uuid-9:802-11-wireless::no', SAVED_HOME],
      properties: { '802-11-wireless.ssid': 'Home' },
      connectedOn: 'wlan0',
    });
    await service().connect('wlan0', 'Home', null);
    expect(calls).toContain('c delete uuid uuid-9');
    expect(calls.some((c) => c.startsWith('c up uuid-0'))).toBe(true);
  });

  it('binds a profile it creates to the radio it was made for', async () => {
    const calls = nmcli({ saved: [], connectedOn: 'wlan0' });
    // The profile is built before the join is verified, and this fixture never
    // reports the radio landing on `Fresh` — the creation arguments are what
    // this pins down, so let the verification fail.
    await service().connect('wlan0', 'Fresh', 'secret', { band: 'bg' }).catch(() => {});
    const add = calls.find((c) => c.startsWith('c add type wifi'));
    expect(add).toBeDefined();
    expect(add).toContain('ifname wlan0');
  });
});

describe('a profile built by hand has to match the AP', () => {
  // `dev wifi connect` negotiates key management itself; a profile built for a
  // band or for a probe does not, and hardcoding wpa-psk made a WPA3-only
  // network refuse a passphrase that was right — with no way out but Forget.
  const withScan = (security) => {
    const calls = [];
    const row = [
      Buffer.from('Casa', 'utf8').toString('hex'),
      'AABBCCDDEEFF',
      'Infra',
      '36',
      '5180 MHz',
      '70',
      security,
      'no',
    ].join(':');
    spawn.mockImplementation((cmd, argv) => {
      calls.push(argv.join(' '));
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (argv.includes('wifi') && argv.includes('list')) {
          c.stdout.emit('data', Buffer.from(row));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
    return calls;
  };

  const addArgs = (calls) => calls.find((c) => c.startsWith('c add type wifi')) || '';

  it('asks for SAE on a WPA3-only network', async () => {
    const calls = withScan('WPA3');
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Casa', 'secret', { band: 'a' }).catch(() => {});
    expect(addArgs(calls)).toContain('wifi-sec.key-mgmt sae');
  });

  it('still asks for wpa-psk in WPA2/WPA3 transition mode', async () => {
    // Both are advertised and wpa-psk is what joins it; SAE here would refuse a
    // network the device can hold.
    const calls = withScan('WPA2 WPA3');
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Casa', 'secret', { band: 'a' }).catch(() => {});
    expect(addArgs(calls)).toContain('wifi-sec.key-mgmt wpa-psk');
  });

  it('writes a WEP key as a WEP key', async () => {
    const calls = withScan('WEP');
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Casa', 'secret', { band: 'a' }).catch(() => {});
    expect(addArgs(calls)).toContain('wifi-sec.wep-key0 secret');
  });

  it('sets no security at all on an open network', async () => {
    const calls = withScan('');
    const svc = require('../src/services/wifi')({ verifyTimeoutMs: 0, verifyIntervalMs: 0 });
    await svc.connect('wlan0', 'Casa', 'secret', { band: 'a' }).catch(() => {});
    expect(addArgs(calls)).not.toContain('wifi-sec');
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

describe('status reports how strong the link is', () => {
  // The panel had strength only in the scan list, so the network you were
  // actually on was the one network whose signal you could not see.
  const radio = ({ state = 'connected', iw = 'signal: -55 dBm\n', iwFails = false } = {}) => {
    const calls = [];
    spawn.mockImplementation((cmd, argv) => {
      calls.push([cmd, argv.join(' ')]);
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = jest.fn();
      setTimeout(() => {
        if (cmd === 'iw') {
          if (iwFails) {
            const err = new Error('spawn iw ENOENT');
            err.code = 'ENOENT';
            c.emit('error', err);
            return;
          }
          c.stdout.emit('data', Buffer.from(iw));
        } else if (argv.includes('dev') && argv.includes('show')) {
          c.stdout.emit('data', Buffer.from('IP4.ADDRESS[1]:192.168.1.9/24'));
        } else if (argv.includes('dev')) {
          c.stdout.emit('data', Buffer.from(`wlan0:wifi:${state}:HomeNet`));
        }
        c.emit('close', 0, null);
      }, 0);
      return c;
    });
    return calls;
  };

  it('reads the live signal from the interface', async () => {
    const calls = radio();
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({
      connected: true,
      signalDbm: -55,
      signal: 90,
    });
    // Straight to the radio, and without sudo: iw reads this as any user.
    expect(calls).toContainEqual(['iw', 'dev wlan0 link']);
  });

  it('does not probe a radio that is not associated', async () => {
    const calls = radio({ state: 'disconnected' });
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({
      connected: false,
      signal: null,
      signalDbm: null,
    });
    expect(calls.some(([cmd]) => cmd === 'iw')).toBe(false);
  });

  // iw is present across the fleet, but the status query is what draws the whole
  // panel: a board without it must still get its SSID and its Disconnect button.
  it('keeps the rest of the status when iw is missing', async () => {
    radio({ iwFails: true });
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({
      connected: true,
      ssid: 'HomeNet',
      signal: null,
      signalDbm: null,
    });
  });

  it('leaves the signal unknown when iw answers without one', async () => {
    radio({ iw: 'Not connected.\n' });
    const svc = require('../src/services/wifi')();
    await expect(svc.status('wlan0')).resolves.toMatchObject({
      connected: true,
      signal: null,
      signalDbm: null,
    });
  });
});
