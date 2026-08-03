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
    install({ stdout: '' });
    // The verification poll runs for VERIFY_TIMEOUT_MS afterwards; what this
    // test is about is the argv handed to nmcli, so inspect that and let the
    // rest settle on its own.
    const pending = wifiService()
      .connect('wlan0', 'My:Net"work', "p'a$$ `word`")
      .catch(() => {});
    await new Promise((r) => setImmediate(r));
    const argv = spawn.mock.calls[0][1];
    expect(argv).toContain('My:Net"work');
    expect(argv).toContain("p'a$$ `word`");
    void pending;
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
