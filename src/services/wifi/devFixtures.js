// Canned nmcli output for a development machine, which has no nmcli at all.
//
// The old scanner shipped `backend/wifi_scan_fake` and chose it by NODE_ENV, so
// the wifi page could be opened on a laptop. Routing everything through the real
// binary lost that: `spawn nmcli` fails with ENOENT on macOS, and the page shows
// an error instead of a network list. This puts it back at the one place the
// absence is detected — the runner's spawn error — and never in production.
//
// The list is deliberately awkward: an SSID with a colon and quotes, a name on
// two bands, and a hidden network. Those are the cases that broke the bash
// parser, and a fixture that only contains easy names would not exercise them.

const { SCAN_FIELDS } = require('./nmcli');

const DEVICE = 'wlan0';
const PROFILE = 'Wiffy';
const UUID = '6502ecf9-01cf-44dc-8556-65592d68c2a7';

// SSID, BSSID, MODE, CHAN, FREQ, SIGNAL, SECURITY, ACTIVE — an empty SSID is how
// nmcli reports a hidden network.
const NETWORKS = [
  ['Wiffy', '80:69:1A:89:E0:CD', 'Infra', 6, '2437 MHz', 82, 'WPA2', 'yes'],
  ['Wiffy', '80:69:1A:89:E0:CE', 'Infra', 44, '5220 MHz', 74, 'WPA2', 'no'],
  ['Wiffy_EXT 2.4', '3C:84:6A:11:22:33', 'Infra', 11, '2462 MHz', 55, 'WPA2', 'no'],
  ['DIRECT-6E-HP OfficeJet 8010', '9A:B1:C2:D3:E4:F5', 'Infra', 1, '2412 MHz', 39, 'WPA2', 'no'],
  ['Ospiti: casa "bella"', 'AA:BB:CC:DD:EE:FF', 'Infra', 3, '2422 MHz', 47, '', 'no'],
  ['', 'AA:BB:CC:DD:EE:00', 'Infra', 9, '2452 MHz', 31, 'WPA3', 'no'],
];

// nmcli escapes `:` and `\` inside terse values; the parser unescapes them, so a
// fixture that did not escape would be read wrong exactly where it matters.
const terse = (fields) =>
  fields.map((v) => String(v).replace(/([\\:])/g, '\\$1')).join(':');

const scanRow = ([ssid, ...rest]) =>
  terse([Buffer.from(ssid, 'utf8').toString('hex'), ...rest]);

// The stdout nmcli would have produced, or null to let the caller fail as it
// normally would.
const fixtureFor = (args) => {
  if (process.env.NODE_ENV === 'production') return null;

  const a = args.map(String);
  const valueAfter = (flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : null);
  const field = valueAfter('-g') || valueAfter('-f');

  if (a.includes('wifi') && a.includes('list')) return NETWORKS.map(scanRow).join('\n');
  if (field === SCAN_FIELDS.join(',')) return NETWORKS.map(scanRow).join('\n');
  if (field === 'DEVICE,TYPE,STATE,CONNECTION')
    return [`${DEVICE}:wifi:connected:${PROFILE}`, `p2p-dev-${DEVICE}:wifi-p2p:disconnected:`].join(
      '\n'
    );
  if (field === 'NAME,UUID,TYPE,DEVICE,ACTIVE')
    return [
      terse([PROFILE, UUID, '802-11-wireless', DEVICE, 'yes']),
      terse(['Wired connection 1', '1f0b0b3e-0000-4000-8000-0000000000ff', '802-3-ethernet', '', 'no']),
    ].join('\n');
  if (field === '802-11-wireless.ssid') return PROFILE;
  if (field && field.startsWith('802-11-wireless-security')) return 'wpa-psk:devpassword';
  if (field === 'IP4.ADDRESS') return 'IP4.ADDRESS[1]:192.168.86.42/24';

  // rescan, connect, disconnect, modify, delete: nmcli says nothing on success,
  // which is what the old fake did too.
  return '';
};

module.exports = { fixtureFor };
