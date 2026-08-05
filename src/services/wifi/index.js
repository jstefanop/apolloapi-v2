const fs = require('fs').promises;
const { run, NmcliError } = require('./runner');
const {
  SCAN_FIELDS,
  parseScan,
  parseDevices,
  isConnectedState,
  parseConnections,
  parseValues,
  parseDefaultRouteDevice,
  isUsbPath,
  classifyError,
  splitTerse,
  bandOf,
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
const ROUTE_TIMEOUT_MS = 5000;

// Profiles built to try a key out. The prefix is what makes one recognisable
// afterwards: an API restart mid-join leaves the probe behind, and nothing else
// would ever tell it apart from a network the user saved.
const PROBE_PREFIX = 'apollo-wifi-probe-';
const isProbeProfile = (profile) => String(profile?.name || '').startsWith(PROBE_PREFIX);

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
  //
  // Bounded like every nmcli call: this child is awaited by listInterfaces, and
  // listInterfaces by status(), by the connect verification poll and by both
  // wifi queries — so one wedged `ip` would hang the whole panel on its loading
  // skeleton until the API is restarted. Which radio carries the route is a
  // nicety; not answering at all is not.
  const defaultRouteDevice = async () =>
    new Promise((resolve) => {
      const { spawn } = require('child_process');
      const child = spawn('ip', ['-o', 'route', 'show', 'default']);
      let out = '';
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill?.('SIGKILL');
        done(null);
      }, ROUTE_TIMEOUT_MS);
      timer.unref?.();
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.on('close', () => done(parseDefaultRouteDevice(out)));
      child.on('error', () => done(null));
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
        connected: isConnectedState(d.state),
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
  const profileProperty = async (id, property) => {
    if (!id) return null;
    try {
      const { stdout } = await run(['-g', property, 'c', 'show', id], {
        sudo: false,
      });
      return parseValues(stdout)[0] || null;
    } catch {
      return null;
    }
  };

  const profileSsid = (id) => profileProperty(id, '802-11-wireless.ssid');

  // A profile remembers the radio it was built for — `addProfile` passes
  // `ifname`, and netplan writes the same binding — and nmcli then refuses to
  // activate it anywhere else: "Connection 'Home' is not available on device
  // wlx…", which classifies as activation-failed and reaches the user as "check
  // the password". An Apollo II with a USB dongle is exactly that case: the
  // password is right and retyping it can never work. The activation names the
  // radio anyway, so a binding that contradicts it is released.
  // Released only when it CONTRADICTS the radio being used — never merely
  // because it exists. Stripping it wholesale looked like a way to survive a
  // failed adapter, but on a device with two radios the binding is the only
  // thing keeping each network on the one it belongs to (observed on apollo2:
  // house network on the USB dongle, inverter on the built-in, every profile
  // bound). Removing it lets NetworkManager move a network onto the wrong
  // adapter — including the one serving the session doing the removing.
  // Returns the binding it removed, or null when there was nothing to remove —
  // because the release is only justified by the activation that follows it. If
  // that activation fails the profile must go back to naming its own radio:
  // leaving it unbound means NetworkManager auto-activates it on whichever radio
  // is free at the next boot, which is the outcome the binding exists to stop.
  const releaseInterfaceBinding = async (uuid, device) => {
    const bound = await profileProperty(uuid, 'connection.interface-name');
    if (!bound || bound === device) return null;
    await run(['c', 'modify', uuid, 'connection.interface-name', ''], { timeoutMs: 15000 });
    return bound;
  };

  const restoreInterfaceBinding = (uuid, bound) =>
    run(['c', 'modify', uuid, 'connection.interface-name', bound], { timeoutMs: 15000 }).catch(
      (err) => {
        console.error(`[wifi] could not restore the binding of ${uuid} to ${bound}: ${err.message}`);
      }
    );

  // The TYPE nmcli reports for a device, unfiltered — parseDevices keeps only
  // wifi, and the guards below need to tell "not a radio" from "not listed".
  // null means nmcli does not know the name; let it answer for itself.
  const deviceIsWifi = async (device) => {
    const { stdout } = await run(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev'], {
      sudo: false,
    });
    const row = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(splitTerse)
      .find((f) => f[0] === device);
    return row ? row[1] === 'wifi' : null;
  };

  // What a profile's security is set to right now, so an attempt that fails can
  // put it back. `-s` is what makes nmcli print the stored key at all: without it
  // the psk comes back as a placeholder, and "restoring" would write the
  // placeholder into the profile. null means it could not be read.
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

    // Which band the link is actually on, read WITHOUT rescanning. A rescan while
    // associated disturbs the link and its results lag behind reality: reading
    // them back reported the PREVIOUS channel, which is exactly how a working
    // band constraint can look inverted.
    let channel = null;
    let frequency = null;
    if (iface.connected) {
      try {
        const { stdout } = await run(
          ['-t', '-f', 'IN-USE,CHAN,FREQ', 'dev', 'wifi', 'list', 'ifname', iface.device, '--rescan', 'no'],
          { sudo: false }
        );
        // IN-USE is '*' on the associated AP and a space on every other row.
        const row = stdout.split('\n').find((l) => l.trim().startsWith('*'));
        if (row) {
          const f = splitTerse(row);
          const c = parseInt(f[1], 10);
          const q = parseInt(f[2], 10);
          channel = Number.isFinite(c) ? c : null;
          frequency = Number.isFinite(q) ? q : null;
        }
      } catch {
        /* the rest of the status is still worth returning */
      }
    }

    return {
      connected: iface.connected,
      ssid: iface.connection ? (await profileSsid(iface.connection)) || iface.connection : null,
      interface: iface.device,
      kind: iface.kind,
      carriesDefaultRoute: iface.carriesDefaultRoute,
      ipAddress,
      channel,
      frequency,
      band: bandOf(frequency),
    };
  };

  // Connect, then CHECK. nmcli returning 0 means it started the activation, and
  // the previous code read the IP immediately after — before DHCP had answered,
  // so it reported the old address or none. Poll until the radio really is on
  // the requested network.
  //
  // `associated` is reported separately from `confirmed` because the two failures
  // are not the same one: a radio that never joined leaves a useless profile
  // behind, while a radio that joined and is still waiting on a slow DHCP server
  // is holding the network the user asked for.
  const waitUntilConnected = async (device, ssid) => {
    const deadline = Date.now() + verifyTimeoutMs;
    let associated = false;
    do {
      const current = await status(device).catch(() => null);
      if (current?.connected && current.ssid === ssid) {
        associated = true;
        if (current.ipAddress) return { confirmed: current, associated };
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, verifyIntervalMs));
    } while (Date.now() < deadline);
    return { confirmed: null, associated };
  };

  // Remove the profile THIS attempt created, so the next try starts clean.
  // `knownBefore` is the set of uuids that existed beforehand, or null when that
  // read failed — and then nothing is deleted, because "I could not tell what was
  // saved" is not "nothing was saved", and the difference is the user's own
  // network. Best-effort otherwise: failing to tidy up must not mask why the
  // connect failed.
  const cleanupCreatedProfile = async (ssid, knownBefore) => {
    if (!knownBefore) return;
    try {
      const now = await savedNetworks();
      const created = now.find(
        (n) => (n.ssid === ssid || n.name === ssid) && !knownBefore.has(n.uuid)
      );
      if (created) await run(['c', 'delete', 'uuid', created.uuid], { timeoutMs: 15000 });
    } catch {
      /* the connect error is the one worth reporting */
    }
  };

  // NetworkManager picks the band on its own, and left alone it prefers 5 GHz —
  // verified on apollo3, where an unconstrained join landed on channel 40. On an
  // Apollo II whose built-in radio cannot hold 5 GHz that is the wrong choice,
  // and the user is the only one who knows. '' clears the constraint.
  const applyBand = (uuid, band) =>
    run(['c', 'modify', uuid, '802-11-wireless.band', band || ''], { timeoutMs: 15000 });

  // What makes the device rejoin on its own after a reboot or a power cut.
  // Profiles are created inert (see addProfile) and switched on once they are
  // the one the user keeps: on a wifi-only Apollo a saved network that never
  // auto-activates means the device comes back with no way in at all, over the
  // very LAN it is administered from.
  // Never best-effort at the call sites: a swallowed failure here is a device
  // that reports itself connected and then never comes back from a power cut.
  // One retry, and if that fails too it is said out loud in the journal rather
  // than dropped.
  const enableAutoconnect = async (uuid) => {
    try {
      await run(['c', 'modify', uuid, 'connection.autoconnect', 'yes'], { timeoutMs: 15000 });
      return true;
    } catch {
      try {
        await run(['c', 'modify', uuid, 'connection.autoconnect', 'yes'], { timeoutMs: 15000 });
        return true;
      } catch (err) {
        console.error(
          `[wifi] autoconnect could not be enabled on ${uuid}: ${err.output || err.message} — ` +
            'the device will NOT rejoin this network on its own after a reboot'
        );
        return false;
      }
    }
  };

  // Which key management the AP actually offers. `dev wifi connect` negotiates
  // this itself; a profile built by hand does not, and hardcoding wpa-psk made a
  // WPA3-only or WEP network refuse a passphrase that was right — with no way
  // out but Forget. The scan is read from the cache (no rescan) because the radio
  // is about to be asked to join.
  const securityArgs = async (device, ssid, passphrase) => {
    if (!passphrase) return [];
    const seen = await scan(device, { rescan: false })
      .then((networks) => networks.find((n) => n.ssid === ssid))
      .catch(() => null);
    // Unknown (hidden network, empty cache) keeps the WPA2 default: it is what
    // nearly every network is, and getting it wrong only costs one attempt.
    if (!seen) return ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', passphrase];
    if (seen.open) return [];
    const security = (seen.security || []).map((s) => s.toUpperCase());
    // Transition mode advertises WPA2 alongside WPA3, and wpa-psk is what joins
    // it — only a WPA3-ONLY network needs SAE.
    const wpa3 = security.some((s) => s.includes('WPA3') || s === 'SAE');
    const legacyWpa = security.some((s) => /^WPA[12]?$/.test(s));
    if (wpa3 && !legacyWpa) return ['wifi-sec.key-mgmt', 'sae', 'wifi-sec.psk', passphrase];
    if (security.some((s) => s.includes('WEP')))
      return ['wifi-sec.key-mgmt', 'none', 'wifi-sec.wep-key0', passphrase];
    return ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', passphrase];
  };

  // Build a profile explicitly. `dev wifi connect` cannot express a band, so any
  // join that constrains one goes through here.
  const addProfile = async ({ name, device, ssid, passphrase, hidden, band }) => {
    const args = [
      'c', 'add', 'type', 'wifi',
      'con-name', name,
      // Bound to the radio it was made for. On a device with two, that binding
      // is what keeps each network on the adapter it belongs to: on an Apollo II
      // the house network lives on the USB dongle and the inverter on the
      // built-in, and NetworkManager only respects that because every profile
      // says which radio is its own.
      'ifname', device,
      'ssid', ssid,
      // Inert on creation: NetworkManager activates a new profile the moment
      // `c add` returns, which would race the explicit activation below — and on
      // the probe path, race the profile it may still have to give way to.
      // `enableAutoconnect` switches it on once the profile is a keeper.
      'autoconnect', 'no',
    ];
    args.push(...(await securityArgs(device, ssid, passphrase)));
    if (hidden) args.push('802-11-wireless.hidden', 'yes');
    if (band) args.push('802-11-wireless.band', band);
    await run(args, { timeoutMs: 15000 });
    const created = (await savedNetworks().catch(() => [])).find((n) => n.name === name);
    return created?.uuid || name;
  };

  // Joining a network whose profile already exists, with a NEW passphrase, is
  // the one case that cannot be done in place. The stored key cannot be read
  // back — nmcli returns an empty psk even with --show-secrets on these devices
  // — so there is nothing to restore if the new key turns out wrong, and
  // `c modify` persists the moment it runs. Supplying the key at activation
  // time does not help either: passwd-file only answers a request for secrets,
  // and a profile that already holds a key is never asked (verified on
  // apollo3 — a deliberately wrong passwd-file activated the network anyway).
  //
  // So the new key is proven on a throwaway profile first, and only a profile
  // that actually joined replaces the saved one.

  // The probe held the network: the new key is the good one. Retire the old
  // profile and give the probe its name, so the user is left with one network,
  // not two.
  //
  // Unless the old profile is RUNNING on another radio. An Apollo II can be
  // administered over its USB dongle while the built-in joins the same network:
  // deleting the profile then tears down the link the request arrived on, and
  // the session dies mid-swap. The two radios keep a profile each instead — the
  // arrangement the interface binding exists to preserve.
  const promoteProbe = async (tmpUuid, preexisting, device) => {
    const heldElsewhere = preexisting.active && preexisting.device && preexisting.device !== device;
    const name = heldElsewhere ? `${preexisting.name} (${device})` : preexisting.name;
    if (!heldElsewhere) {
      await run(['c', 'delete', preexisting.uuid], { timeoutMs: 15000 }).catch(() => {});
    }
    await run(['c', 'modify', tmpUuid, 'connection.id', name], {
      timeoutMs: 15000,
    }).catch(() => {});
    await enableAutoconnect(tmpUuid);
  };

  // It did not: drop the probe and put the radio back on the profile that was
  // working. Activating the probe took the radio off it, so leaving it at that
  // is a device sitting on no network — and on a wifi-only Apollo, out of reach.
  const discardProbe = async (tmpUuid, device, preexisting) => {
    await run(['c', 'delete', tmpUuid], { timeoutMs: 15000 }).catch(() => {});
    await run(['c', 'up', preexisting.uuid, 'ifname', device], {
      timeoutMs: CONNECT_TIMEOUT_MS,
    }).catch(() => {});
  };

  const connectWithNewKey = async (device, ssid, passphrase, { hidden, band, preexisting }) => {
    const tmpName = `${PROBE_PREFIX}${preexisting.uuid.slice(0, 8)}`;
    const tmpUuid = await addProfile({ name: tmpName, device, ssid, passphrase, hidden, band });

    try {
      await run(['c', 'up', tmpUuid, 'ifname', device], { timeoutMs: CONNECT_TIMEOUT_MS });
    } catch (err) {
      // The saved profile was never touched, so the working key is still there.
      await discardProbe(tmpUuid, device, preexisting);
      throw err;
    }

    // nmcli returning 0 means it started the activation, which is NOT the same
    // as being on the network — so the swap waits for the verification below.
    // Retiring the saved profile here left a join that stalled on DHCP with no
    // working profile at all, and nothing to roll back to.
    return tmpUuid;
  };

  const connect = async (device, ssid, passphrase, { hidden = false, band = null } = {}) => {
    // null, not [], when the read fails: an empty list would claim nothing was
    // saved and arm the cleanup below against a profile we never created.
    const before = await savedNetworks().catch(() => null);
    const knownBefore = before && new Set(before.map((n) => n.uuid));
    // A probe outlives its attempt only when the API died between creating it
    // and settling it — an apollo-api restart, a power cut. Left there it shows
    // up in the saved list under its internal name, and worse, the next attempt
    // can pick it as the saved profile and promote over the real one. Inactive
    // only: an active one is holding a radio right now.
    await Promise.all(
      (before || [])
        .filter((n) => isProbeProfile(n) && !n.active)
        .map((n) =>
          run(['c', 'delete', 'uuid', n.uuid], { timeoutMs: 15000 }).catch(() => {})
        )
    );

    // By SSID first: on a netplan device the profile for `Home` is called
    // `netplan-wlan0-Home`, and matching on the name alone would miss it and
    // build a duplicate profile on every join. Never a probe: it is ours, not a
    // network the user saved.
    const candidates = (before || []).filter((n) => !isProbeProfile(n));
    const bySsid = candidates.filter((n) => n.ssid === ssid);
    const matches = bySsid.length ? bySsid : candidates.filter((n) => n.name === ssid);
    // And on THIS radio first: two adapters can hold a profile each for the same
    // network, and reaching for the other one's is how a join on the built-in
    // ends up rewriting what the dongle is running.
    const preexisting = matches.find((n) => n.device === device) || matches[0] || null;

    // Set while a probe profile is on trial, so the verification below knows
    // there is a swap left to settle one way or the other.
    let probeUuid = null;
    // The binding taken off the saved profile, to be put back if the activation
    // it was taken off for does not land.
    let releasedBinding = null;

    try {
      if (preexisting && passphrase) {
        probeUuid = await connectWithNewKey(device, ssid, passphrase, {
          hidden,
          band,
          preexisting,
        });
      } else if (preexisting) {
        // Band is a property of the saved profile, so it is applied before the
        // activation that has to honour it — but only when the caller said
        // something about it. The UI's picker is per visit, so a plain reconnect
        // carries no band, and writing '' then would silently drop a pin the
        // user made in an earlier session. '' is how they clear it deliberately.
        if (band != null) await applyBand(preexisting.uuid, band).catch(() => {});
        releasedBinding = await releaseInterfaceBinding(preexisting.uuid, device).catch(
          () => null
        );
        // No new key: activate what is saved. This is what makes reconnecting
        // without retyping the passphrase work.
        if (hidden) {
          // The flag has to reach the profile: on one saved without it,
          // NetworkManager waits for a beacon a hidden network never sends.
          await run(['c', 'modify', preexisting.uuid, '802-11-wireless.hidden', 'yes'], {
            timeoutMs: 15000,
          }).catch(() => {});
        }
        await run(['c', 'up', preexisting.uuid, 'ifname', device], {
          timeoutMs: CONNECT_TIMEOUT_MS,
        });
      } else if (band) {
        // `dev wifi connect` has no way to express a band, so a constrained join
        // builds the profile first and activates it.
        const uuid = await addProfile({ name: ssid, device, ssid, passphrase, hidden, band });
        await run(['c', 'up', uuid, 'ifname', device], { timeoutMs: CONNECT_TIMEOUT_MS });
        await enableAutoconnect(uuid);
      } else {
        // Never seen and no constraint: `dev wifi connect` creates the profile as
        // it joins. It refuses when one already exists for the name, which is why
        // the branches above exist.
        const args = ['dev', 'wifi', 'connect', ssid, 'ifname', device];
        if (passphrase) args.push('password', passphrase);
        if (hidden) args.push('hidden', 'yes');
        await run(args, { timeoutMs: CONNECT_TIMEOUT_MS });
      }
    } catch (err) {
      const reason = err.timedOut ? 'timeout' : classifyError(err.code, err.output);
      if (releasedBinding) await restoreInterfaceBinding(preexisting.uuid, releasedBinding);
      if (!preexisting) await cleanupCreatedProfile(ssid, knownBefore);
      // The classified reason is what the user sees, and `activation-failed` is
      // genuinely ambiguous — a wrong key, a missing regulatory domain and a
      // radio that dropped all land there. nmcli's own text is the only thing
      // that tells them apart, so it goes to the journal, where support can read
      // it back off a device that is not in the room. It carries no secret: the
      // runner collects the child's output, never its arguments.
      console.error(
        `[wifi] connect to ${ssid} on ${device} failed (${reason}): ${err.output || err.message}`
      );
      throw Object.assign(new Error(reason), { reason, detail: err.output });
    }

    const { confirmed, associated } = await waitUntilConnected(device, ssid);

    // A probe that carried the radio onto the network proved its key, address or
    // not; one that never got there is undone, and the profile the device had
    // comes back.
    if (probeUuid) {
      if (associated) await promoteProbe(probeUuid, preexisting, device);
      else await discardProbe(probeUuid, device, preexisting);
    }
    if (!confirmed) {
      // A radio that DID join is on the network the user asked for; only the
      // address is late (a slow DHCP server, or one handing out v6 only).
      if (!preexisting && !associated) await cleanupCreatedProfile(ssid, knownBefore);
      // The radio never landed, so the release that let it try is undone too.
      if (!associated && releasedBinding)
        await restoreInterfaceBinding(preexisting.uuid, releasedBinding);
      const reason = associated ? 'no-ip-address' : 'not-confirmed';
      const detail = associated
        ? 'the radio joined that network but no address arrived in time'
        : 'nmcli reported success but the interface never came up on that network';
      console.error(`[wifi] connect to ${ssid} on ${device} failed (${reason}): ${detail}`);
      throw Object.assign(new Error(reason), { reason, detail });
    }
    return confirmed;
  };

  // Disconnect the radio and LEAVE the profile in place, so reconnecting does
  // not mean typing the passphrase again. This is what "Disconnect" always
  // should have meant.
  const disconnect = async (device) => {
    // Every read path here is filtered to wifi; these two mutations were the
    // only ones addressing whatever name they were handed. A stale ifname from
    // an open panel, or any authenticated caller that is not the shipped UI,
    // could take down the Ethernet an Apollo is administered over — the class of
    // collateral damage splitting disconnect from forget was meant to close.
    if ((await deviceIsWifi(device).catch(() => null)) === false)
      throw Object.assign(new Error('not-a-wifi-interface'), { reason: 'not-a-wifi-interface' });
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
    // Same guard as disconnect: a wired profile deleted here does not come back
    // at the next boot. A type that cannot be read is left to nmcli — "I could
    // not tell" is not "it is not wifi".
    const type = await profileProperty(uuid, 'connection.type');
    if (type && type !== '802-11-wireless')
      throw Object.assign(new Error('not-a-wifi-profile'), { reason: 'not-a-wifi-profile' });
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
