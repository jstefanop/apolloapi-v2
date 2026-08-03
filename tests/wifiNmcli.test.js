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
