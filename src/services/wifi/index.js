const fs = require('fs').promises;
const { run, NmcliError } = require('./runner');
const {
  SCAN_FIELDS,
  parseScan,
  parseDevices,
  parseConnections,
  parseValues,
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

// Timeouts are injectable so tests can exercise the state machine without
// waiting on the real verification window.
const wifiService = ({
  verifyTimeoutMs = VERIFY_TIMEOUT_MS,
  verifyIntervalMs = VERIFY_INTERVAL_MS,
} = {}) => {
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

  // A profile's NAME — nmcli's CONNECTION column, and the NAME column of
  // `c show` — is its id, NOT the SSID. netplan generates `netplan-wlan0-Home`
  // for the network `Home`, and netplan is what Solo Node and Apollo III ship,
  // so the two differ on most of the fleet. Ask the profile which network it
  // actually joins.
  const profileSsid = async (id) => {
    if (!id) return null;
    try {
      const { stdout } = await run(['-g', '802-11-wireless.ssid', 'c', 'show', id], {
        sudo: false,
      });
      return parseValues(stdout)[0] || null;
    } catch {
      return null;
    }
  };

  const savedNetworks = async () => {
    const { stdout } = await run(['-t', '-f', 'NAME,UUID,TYPE,DEVICE,ACTIVE', 'c', 'show'], {
      sudo: false,
    });
    // Carry both: the name is what identifies the profile, the ssid is what the
    // radio joins, and matching a network by name misses on every netplan device.
    return Promise.all(
      parseConnections(stdout).map(async (p) => ({
        ...p,
        ssid: (await profileSsid(p.uuid)) || p.name,
      }))
    );
  };

  const status = async (device) => {
    const interfaces = await listInterfaces();
    // Choose for the caller only when they did not name a radio. Substituting
    // another adapter answers about a network nobody asked about — an unplugged
    // dongle would report the built-in's connection as its own — and inside the
    // connect verification it would confirm the join on the wrong radio.
    const iface = device
      ? interfaces.find((i) => i.device === device)
      : preferredInterface(interfaces);
    if (!iface) return { connected: false, interface: device || null };

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
      ssid: iface.connection ? (await profileSsid(iface.connection)) || iface.connection : null,
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
    const deadline = Date.now() + verifyTimeoutMs;
    do {
      const current = await status(device).catch(() => null);
      if (current?.connected && current.ssid === ssid && current.ipAddress) return current;
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, verifyIntervalMs));
    } while (Date.now() < deadline);
    return null;
  };

  // Remove a profile left behind by a failed attempt, so the next try starts
  // clean. Best-effort: failing to tidy up must not mask why the connect failed.
  const cleanupProfile = async (ssid) => {
    try {
      const now = await savedNetworks();
      const stale = now.find((n) => n.ssid === ssid || n.name === ssid);
      if (stale) await run(['c', 'delete', 'uuid', stale.uuid], { timeoutMs: 15000 });
    } catch {
      /* the connect error is the one worth reporting */
    }
  };

  const connect = async (device, ssid, passphrase, { hidden = false } = {}) => {
    // `nmcli dev wifi connect` SAVES a profile as it goes, including when the
    // passphrase is wrong — observed on apollo3, where a single typo left a
    // "Wiffy" profile holding the bad key and the radio stuck retrying against
    // it, so even the correct password then failed. Remember what existed
    // beforehand so a profile this attempt created can be taken back.
    const before = await savedNetworks().catch(() => []);
    // By SSID first: on a netplan device the profile for `Home` is called
    // `netplan-wlan0-Home`, and matching on the name alone would miss it and
    // build a duplicate profile on every join.
    const preexisting =
      before.find((n) => n.ssid === ssid) || before.find((n) => n.name === ssid) || null;

    // Two different commands, because nmcli treats a known network differently.
    // `dev wifi connect <ssid> password <x>` builds a NEW profile, and once one
    // exists for that name it fails with "802-11-wireless-security.key-mgmt:
    // property is missing" — even when the password is right (reproduced on
    // apollo3: connect, disconnect, then every later attempt refused). So a
    // saved network is joined by updating its key and activating it, which is
    // also what makes reconnecting without retyping the passphrase work.
    const args = preexisting
      ? ['c', 'up', preexisting.uuid, 'ifname', device]
      : ['dev', 'wifi', 'connect', ssid, 'ifname', device];
    if (!preexisting && passphrase) args.push('password', passphrase);
    if (!preexisting && hidden) args.push('hidden', 'yes');

    try {
      if (preexisting && passphrase) {
        // key-mgmt alongside the key: a profile that never had security set
        // rejects a bare psk.
        await run(
          ['c', 'modify', preexisting.uuid, 'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', passphrase],
          { timeoutMs: 15000 }
        );
      }
      await run(args, { timeoutMs: CONNECT_TIMEOUT_MS });
    } catch (err) {
      const reason = err.timedOut ? 'timeout' : classifyError(err.code, err.output);
      // Only what we just created: a profile the user already had may hold a
      // good key and have failed for a passing reason (out of range), and
      // deleting it would lose a working network over one bad moment.
      if (!preexisting) await cleanupProfile(ssid);
      throw Object.assign(new Error(reason), { reason, detail: err.output });
    }

    const confirmed = await waitUntilConnected(device, ssid);
    if (!confirmed) {
      if (!preexisting) await cleanupProfile(ssid);
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
    try {
      await run(['dev', 'disconnect', device], { timeoutMs: 20000 });
    } catch (err) {
      // "This device is not active" is the outcome the caller asked for, and
      // nmcli reports it as a failure (observed on apollo3). Surfacing that as
      // an error would alarm someone whose radio is already down.
      if (/not active/i.test(err.output || err.message || '')) {
        return { disconnected: true, interface: device, alreadyDisconnected: true };
      }
      throw err;
    }
    return { disconnected: true, interface: device, alreadyDisconnected: false };
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
