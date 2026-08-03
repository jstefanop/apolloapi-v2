const fs = require('fs').promises;
const { run, NmcliError } = require('./runner');
const {
  SCAN_FIELDS,
  parseScan,
  parseDevices,
  parseConnections,
  parseDefaultRouteDevice,
  isUsbPath,
  classifyError,
} = require('./nmcli');

// The wifi domain. Three rules hold the whole thing together:
//
//  1. **Only nmcli touches configuration.** Where the profiles live differs
//     across the fleet — NetworkManager's own store on Apollo II, netplan with
//     volatile runtime copies on Solo Node and Apollo III — and nmcli abstracts
//     that. Reading or writing those files directly would work on one device and
//     corrupt another.
//  2. **The interface is discovered, never assumed.** It is `wlan0` on Apollo II
//     and `wlP2p33s0` on the newer boards, and an Apollo II may have a USB
//     dongle as well.
//  3. **Disconnect and forget are different operations.** The old code offered
//     only "disconnect" and implemented it as "delete every profile whose row
//     matches wlan" — which on an Apollo II deletes the connection to whatever
//     the built-in radio serves.

const CONNECT_TIMEOUT_MS = 45000;
const VERIFY_TIMEOUT_MS = 20000;
const VERIFY_INTERVAL_MS = 1000;

const wifiService = () => {
  // Which physical bus the adapter hangs off. A USB dongle is labelled as such
  // in the UI, never hidden: on many Apollo II it is the only radio that works
  // well, and the built-in may be serving something else entirely.
  const adapterKind = async (device) => {
    try {
      const real = await fs.realpath(`/sys/class/net/${device}`);
      return isUsbPath(real) ? 'usb' : 'builtin';
    } catch {
      return 'unknown';
    }
  };

  // Which interface carries traffic. Read from `ip route`, not from nmcli: an
  // adapter can be "connected" to a network that goes nowhere — on an Apollo II
  // the built-in radio sits on the inverter's access point, with no route out.
  const defaultRouteDevice = async () =>
    new Promise((resolve) => {
      const { spawn } = require('child_process');
      const child = spawn('ip', ['-o', 'route', 'show', 'default']);
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.on('close', () => resolve(parseDefaultRouteDevice(out)));
      child.on('error', () => resolve(null));
    });

  // Every usable wifi radio, labelled. The UI shows a picker only when there is
  // more than one (most devices have exactly one), and preselects the adapter
  // that actually carries traffic.
  const listInterfaces = async () => {
    const { stdout } = await run(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev'], {
      sudo: false,
    });
    const devices = parseDevices(stdout);
    const routeDevice = await defaultRouteDevice();

    return Promise.all(
      devices.map(async (d) => ({
        device: d.device,
        kind: await adapterKind(d.device),
        state: d.state,
        connected: d.state === 'connected',
        connection: d.connection,
        carriesDefaultRoute: d.device === routeDevice,
      }))
    );
  };

  // Preselection for the UI: the radio carrying traffic, else the first
  // connected one, else the built-in, else whatever exists.
  const preferredInterface = (interfaces) =>
    interfaces.find((i) => i.carriesDefaultRoute) ||
    interfaces.find((i) => i.connected) ||
    interfaces.find((i) => i.kind === 'builtin') ||
    interfaces[0] ||
    null;

  // Scanning is per radio, not per device: two adapters see different signals
  // for the same network, and merging them would not say which one can actually
  // reach it.
  const scan = async (device, { rescan = true } = {}) => {
    if (rescan) {
      // A rescan that fails is not fatal — the cached list is still worth
      // showing, and nmcli refuses to rescan while one is already running.
      await run(['dev', 'wifi', 'rescan', 'ifname', device], { timeoutMs: 20000 }).catch(
        () => {}
      );
    }
    const { stdout } = await run(
      ['-t', '-f', SCAN_FIELDS.join(','), 'dev', 'wifi', 'list', 'ifname', device],
      { sudo: false }
    );
    return parseScan(stdout);
  };

  const savedNetworks = async () => {
    const { stdout } = await run(['-t', '-f', 'NAME,UUID,TYPE,DEVICE,ACTIVE', 'c', 'show'], {
      sudo: false,
    });
    return parseConnections(stdout);
  };

  const status = async (device) => {
    const interfaces = await listInterfaces();
    const iface = interfaces.find((i) => i.device === device) || preferredInterface(interfaces);
    if (!iface) return { connected: false, interface: null };

    let ipAddress = null;
    if (iface.connected) {
      try {
        const { stdout } = await run(['-t', '-f', 'IP4.ADDRESS', 'dev', 'show', iface.device], {
          sudo: false,
        });
        const m = stdout.match(/IP4\.ADDRESS\[\d+\]:([^/\s]+)/);
        ipAddress = m ? m[1] : null;
      } catch {
        ipAddress = null;
      }
    }

    return {
      connected: iface.connected,
      ssid: iface.connection,
      interface: iface.device,
      kind: iface.kind,
      carriesDefaultRoute: iface.carriesDefaultRoute,
      ipAddress,
    };
  };

  // Connect, then CHECK. nmcli returning 0 means it started the activation, and
  // the previous code read the IP immediately after — before DHCP had answered,
  // so it reported the old address or none. Poll until the radio really is on
  // the requested network.
  const waitUntilConnected = async (device, ssid) => {
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await status(device).catch(() => null);
      if (current?.connected && current.ssid === ssid && current.ipAddress) return current;
      await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
    }
    return null;
  };

  const connect = async (device, ssid, passphrase, { hidden = false } = {}) => {
    const args = ['dev', 'wifi', 'connect', ssid, 'ifname', device];
    if (passphrase) args.push('password', passphrase);
    if (hidden) args.push('hidden', 'yes');

    try {
      await run(args, { timeoutMs: CONNECT_TIMEOUT_MS });
    } catch (err) {
      const reason = err.timedOut ? 'timeout' : classifyError(err.code, err.output);
      throw Object.assign(new Error(reason), { reason, detail: err.output });
    }

    const confirmed = await waitUntilConnected(device, ssid);
    if (!confirmed) {
      throw Object.assign(new Error('not-confirmed'), {
        reason: 'not-confirmed',
        detail: 'nmcli reported success but the interface never came up on that network',
      });
    }
    return confirmed;
  };

  // Disconnect the radio and LEAVE the profile in place, so reconnecting does
  // not mean typing the passphrase again. This is what "Disconnect" always
  // should have meant.
  const disconnect = async (device) => {
    await run(['dev', 'disconnect', device], { timeoutMs: 20000 });
    return { disconnected: true, interface: device };
  };

  // Forget ONE network, addressed by its uuid so a name containing odd
  // characters cannot select the wrong profile.
  const forget = async (uuid) => {
    await run(['c', 'delete', 'uuid', uuid], { timeoutMs: 20000 });
    return { forgotten: true, uuid };
  };

  return {
    listInterfaces,
    preferredInterface,
    scan,
    savedNetworks,
    status,
    connect,
    disconnect,
    forget,
  };
};

module.exports = wifiService;
module.exports.NmcliError = NmcliError;
