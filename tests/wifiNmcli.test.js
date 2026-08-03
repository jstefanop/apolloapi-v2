// tests/wifiNmcli.test.js
const {
  splitTerse,
  decodeSsid,
  parseScanLine,
  parseScan,
  dedupeBySsid,
} = require('../src/services/wifi/nmcli');

// Fixtures captured from real devices on 2026-08-02, not invented:
// apollo3 (nmcli 1.54.3), apollo2 (1.36.6), solo-node (1.46.0).
// Field order: SSID-HEX:BSSID:MODE:CHAN:FREQ:SIGNAL:SECURITY:ACTIVE

describe('splitTerse — nmcli escapes colons inside values', () => {
  it('keeps an escaped colon inside the field instead of splitting on it', () => {
    // A BSSID is a MAC, so nmcli's own output demonstrates the escaping: this is
    // exactly what the old IFS=':' parser shifted every field on.
    const line = 'Wiffy:80\\:69\\:1A\\:89\\:E0\\:CD:100';
    expect(splitTerse(line)).toEqual(['Wiffy', '80:69:1A:89:E0:CD', '100']);
  });

  it('unescapes a literal backslash', () => {
    expect(splitTerse('a\\\\b:c')).toEqual(['a\\b', 'c']);
  });

  it('keeps empty fields, which carry meaning (hidden ssid, open security)', () => {
    expect(splitTerse('::5180 MHz:55')).toEqual(['', '', '5180 MHz', '55']);
  });
});

describe('decodeSsid — the name travels as hex so nothing can corrupt it', () => {
  it('decodes a plain name', () => {
    expect(decodeSsid('5769666679')).toBe('Wiffy'); // observed on all three devices
  });

  it('decodes a name with spaces and punctuation', () => {
    expect(decodeSsid('4449524543542D36452D4850204F66666963654A65742038303130')).toBe(
      'DIRECT-6E-HP OfficeJet 8010'
    );
    expect(decodeSsid('57696666795F45585420322E34')).toBe('Wiffy_EXT 2.4');
  });

  it('survives the characters that used to break the scan', () => {
    // These are the ones that produced invalid JSON or shifted fields. Through
    // hex they are just bytes.
    for (const name of ['My:Network', 'He said "hi"', 'back\\slash', 'caffè ☕']) {
      expect(decodeSsid(Buffer.from(name, 'utf8').toString('hex'))).toBe(name);
    }
  });

  it('reports a hidden network as null rather than an empty name', () => {
    expect(decodeSsid('')).toBeNull();
    expect(decodeSsid('   ')).toBeNull();
  });

  it('refuses malformed hex instead of returning garbage', () => {
    expect(decodeSsid('zzzz')).toBeNull();
    expect(decodeSsid('abc')).toBeNull(); // odd length
  });
});

describe('parseScanLine — real rows from apollo3', () => {
  it('parses a dual-band WPA2/WPA3 network', () => {
    const line = '5769666679:80\\:69\\:1A\\:89\\:E0\\:CD:Infra:10:2457 MHz:100:WPA2 WPA3:no';
    expect(parseScanLine(line)).toEqual({
      ssid: 'Wiffy',
      hidden: false,
      bssid: '80:69:1A:89:E0:CD',
      mode: 'Infra',
      channel: 10,
      frequency: 2457,
      band: '2.4',
      signal: 100,
      security: ['WPA2', 'WPA3'], // a LIST, not a single value
      open: false,
      active: false,
    });
  });

  it('recognises the 5 GHz band', () => {
    const line = '5769666679:80\\:69\\:1A\\:89\\:DF\\:D4:Infra:36:5180 MHz:100:WPA2 WPA3:no';
    expect(parseScanLine(line)).toMatchObject({ band: '5', channel: 36 });
  });

  it('marks a hidden network instead of emitting a blank row', () => {
    // Two of these were live in the neighbourhood; today they reach the UI as
    // empty lines you cannot tell apart.
    const line = '::Infra:3:2422 MHz:55:WPA2 WPA3:no';
    expect(parseScanLine(line)).toMatchObject({
      ssid: null,
      hidden: true,
      signal: 55,
    });
  });

  it('flags an open network, so the UI does not ask for a passphrase', () => {
    const line = '4672656557694669:AA\\:BB\\:CC\\:DD\\:EE\\:FF:Infra:6:2437 MHz:70::no';
    expect(parseScanLine(line)).toMatchObject({
      ssid: 'FreeWiFi',
      open: true,
      security: [],
    });
  });

  it('reads the active flag', () => {
    const line = '5769666679:80\\:69\\:1A\\:89\\:E0\\:CD:Infra:10:2457 MHz:100:WPA2:yes';
    expect(parseScanLine(line).active).toBe(true);
  });

  it('ignores blank and truncated lines rather than throwing', () => {
    expect(parseScanLine('')).toBeNull();
    expect(parseScanLine('   ')).toBeNull();
    expect(parseScanLine('5769666679:80\\:69')).toBeNull();
  });

  it('does not throw on empty numeric fields', () => {
    // The old script interpolated these unquoted: an empty channel produced
    // `"channel": ,` and took the whole scan down with it.
    const line = '5769666679:BSSID:Infra:::  :WPA2:no';
    const parsed = parseScanLine(line);
    expect(parsed.channel).toBeNull();
    expect(parsed.frequency).toBeNull();
    expect(parsed.signal).toBe(0);
  });
});

describe('parseScan — the whole scan, as the device returned it', () => {
  // Verbatim from apollo3, with BSSIDs added: three rows for "Wiffy" is what a
  // router on two bands plus a repeater actually looks like.
  const STDOUT = [
    '5769666679:80\\:69\\:1A\\:89\\:E0\\:CD:Infra:10:2457 MHz:100:WPA2 WPA3:no',
    '5769666679:80\\:69\\:1A\\:89\\:DF\\:D4:Infra:36:5180 MHz:100:WPA2 WPA3:no',
    '4449524543542D36452D4850204F66666963654A65742038303130:CA\\:5A\\:CF\\:CC\\:92\\:6E:Infra:40:5200 MHz:100:WPA2:no',
    '5769666679:80\\:69\\:1A\\:89\\:E0\\:CE:Infra:40:5200 MHz:99:WPA2 WPA3:no',
    '534B593445433933:11\\:22\\:33\\:44\\:55\\:66:Infra:36:5180 MHz:74:WPA2:no',
    '::Infra:3:2422 MHz:55:WPA2 WPA3:no',
    '::Infra:56:5280 MHz:14:WPA2:no',
    '',
  ].join('\n');

  const networks = parseScan(STDOUT);

  it('collapses the three "Wiffy" rows into one network', () => {
    const wiffy = networks.filter((n) => n.ssid === 'Wiffy');
    expect(wiffy).toHaveLength(1);
    expect(wiffy[0].signal).toBe(100); // the strongest reading represents it
  });

  it('remembers both bands it was seen on', () => {
    const wiffy = networks.find((n) => n.ssid === 'Wiffy');
    expect(wiffy.bands.sort()).toEqual(['2.4', '5']);
  });

  it('keeps hidden networks separate — they have no name to merge on', () => {
    expect(networks.filter((n) => n.hidden)).toHaveLength(2);
  });

  it('sorts by signal, strongest first', () => {
    const signals = networks.map((n) => n.signal);
    expect([...signals].sort((a, b) => b - a)).toEqual(signals);
  });

  it('returns every distinct network and nothing else', () => {
    expect(networks.map((n) => n.ssid)).toEqual([
      'Wiffy',
      'DIRECT-6E-HP OfficeJet 8010',
      'SKY4EC93',
      null,
      null,
    ]);
  });

  it('survives an SSID that would have broken the old scanner', () => {
    // `My:Net"work` — a colon AND a quote. The bash version shifted fields on the
    // first and produced invalid JSON on the second, losing every other network.
    const evil = Buffer.from('My:Net"work', 'utf8').toString('hex');
    const out = parseScan(`${evil}:BSSID:Infra:6:2437 MHz:80:WPA2:no\n${STDOUT}`);
    expect(out.find((n) => n.ssid === 'My:Net"work')).toBeDefined();
    expect(out.find((n) => n.ssid === 'Wiffy')).toBeDefined(); // others intact
  });

  it('returns an empty list, not a throw, when there is nothing to report', () => {
    expect(parseScan('')).toEqual([]);
    expect(parseScan(null)).toEqual([]);
  });
});

describe('dedupeBySsid — an active radio marks the whole network active', () => {
  it('keeps active when only the weaker band is the connected one', () => {
    const merged = dedupeBySsid([
      { ssid: 'Home', hidden: false, band: '5', signal: 90, active: false },
      { ssid: 'Home', hidden: false, band: '2.4', signal: 40, active: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ signal: 90, active: true });
  });
});

// ---------------------------------------------------------------------------
// Interfaces, saved profiles, routing — fixtures captured 2026-08-02
// ---------------------------------------------------------------------------
const {
  parseDevices,
  parseConnections,
  parseDefaultRouteDevice,
  isUsbPath,
  classifyError,
} = require('../src/services/wifi/nmcli');

describe('parseDevices — which radios the user can actually use', () => {
  it('drops the wifi-p2p pseudo-interfaces', () => {
    // NetworkManager exposes one per radio for Wi-Fi Direct; offering it would
    // give the user an adapter that cannot hold a connection.
    const stdout = [
      'enP4p65s0:ethernet:connected:Wired connection 1',
      'lo:loopback:connected (externally):lo',
      'wlP2p33s0:wifi:disconnected:',
      'p2p-dev-wlP2p33s0:wifi-p2p:disconnected:',
    ].join('\n');
    expect(parseDevices(stdout)).toEqual([
      { device: 'wlP2p33s0', type: 'wifi', state: 'disconnected', connection: null },
    ]);
  });

  it('reports both radios of an Apollo II, with what each is attached to', () => {
    // Verbatim from apollo2: the built-in serves the inverter, the USB dongle
    // carries the LAN. Neither may be hidden from the user.
    const stdout = [
      'wlx98254aa4b822:wifi:connected:Wiffy_EXT 2.4',
      'wlan0:wifi:connected:sun2000',
      'p2p-dev-wlan0:wifi-p2p:disconnected:',
      'eth0:ethernet:unavailable:',
      'lo:loopback:unmanaged:',
    ].join('\n');
    expect(parseDevices(stdout)).toEqual([
      { device: 'wlx98254aa4b822', type: 'wifi', state: 'connected', connection: 'Wiffy_EXT 2.4' },
      { device: 'wlan0', type: 'wifi', state: 'connected', connection: 'sun2000' },
    ]);
  });

  it('returns nothing rather than throwing on empty output', () => {
    expect(parseDevices('')).toEqual([]);
    expect(parseDevices(null)).toEqual([]);
  });
});

describe('parseConnections — the saved networks', () => {
  const SOLONODE = [
    'Wiffy:6fc2dda0-1d8b-4e69-b973-7c7cfe2bd99d:802-11-wireless:wlP2p33s0:yes',
    'lo:0f2db2ec-9588-48e8-a087-77fe93ac16c4:loopback:lo:yes',
    'docker0:969f647c-6a04-4cb0-b656-185e1f0c6a27:bridge:docker0:yes',
    'FutureBit_5G:9b0ccb01-90b1-4fdf-9332-f9b88a6ea365:802-11-wireless::no',
    'Wired connection 1:fc196676-e51a-3753-bad6-2d99e68c8f5a:802-3-ethernet::no',
  ].join('\n');

  it('keeps only wifi profiles, ethernet and docker aside', () => {
    expect(parseConnections(SOLONODE).map((c) => c.name)).toEqual(['Wiffy', 'FutureBit_5G']);
  });

  it('a profile with no device is saved but not active', () => {
    const saved = parseConnections(SOLONODE).find((c) => c.name === 'FutureBit_5G');
    expect(saved).toMatchObject({ device: null, active: false });
  });

  it('marks the one currently in use', () => {
    const live = parseConnections(SOLONODE).find((c) => c.name === 'Wiffy');
    expect(live).toMatchObject({ device: 'wlP2p33s0', active: true });
  });
});

describe('parseDefaultRouteDevice — which adapter actually carries traffic', () => {
  it('finds the interface on an Apollo II where the USB dongle wins', () => {
    // The reason the built-in cannot simply be assumed: here it is on the
    // inverter, and the route goes out through the dongle.
    expect(
      parseDefaultRouteDevice(
        'default via 192.168.86.1 dev wlx98254aa4b822 proto dhcp metric 600 '
      )
    ).toBe('wlx98254aa4b822');
  });

  it('finds it on ethernet too', () => {
    expect(
      parseDefaultRouteDevice(
        'default via 192.168.86.1 dev enP4p65s0 proto dhcp src 192.168.86.237 metric 100 '
      )
    ).toBe('enP4p65s0');
  });

  it('returns null when there is no default route', () => {
    expect(parseDefaultRouteDevice('')).toBeNull();
  });
});

describe('isUsbPath — labelling the adapter, not filtering it', () => {
  it('recognises a USB dongle', () => {
    expect(isUsbPath('/sys/devices/platform/fe3c0000.usb/usb1/1-1/1-1:1.0/net/wlx98254aa4b822')).toBe(true);
  });

  it('recognises the built-in radios of both generations', () => {
    expect(isUsbPath('/sys/devices/platform/unisoc_wifi/net/wlan0')).toBe(false);
    expect(isUsbPath('/sys/devices/platform/a40800000.pcie/pci0002:20/net/wlP2p33s0')).toBe(false);
  });
});

describe('classifyError — say why, not "exit code 4"', () => {
  it('recognises an SSID that is not on the air', () => {
    // Observed verbatim on apollo3, exit 10.
    expect(classifyError(10, "Error: No network with SSID 'Nope' found.")).toBe('ssid-not-found');
  });

  it('recognises a wrong passphrase', () => {
    expect(classifyError(4, 'Error: Connection activation failed: Secrets were required, but not provided')).toBe('bad-passphrase');
  });

  it('recognises a timeout', () => {
    expect(classifyError(4, 'Error: Timeout expired (10 seconds)')).toBe('timeout');
  });

  it('falls back to a generic failure rather than inventing a cause', () => {
    expect(classifyError(1, 'something unexpected')).toBe('failed');
  });
});
