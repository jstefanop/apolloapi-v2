// Parsing of nmcli's terse output.
//
// This lives in Node, not in the shell script that calls nmcli, and that is the
// whole point. The previous scanner built JSON by concatenating strings in bash:
// an SSID containing `"` produced invalid JSON and killed the entire scan, not
// just that network — and the SSID is chosen by the neighbour, not by us.
//
// Two decisions make this robust rather than merely fixed:
//
//  - **The SSID is read as hex** (`SSID-HEX`), so there is nothing to unescape
//    and any byte survives: `:`, `"`, `\`, newlines, emoji, even non-UTF-8 names.
//    Verified present on nmcli 1.36.6, 1.46.0 and 1.54.3 — every device in the
//    field. An empty hex is how nmcli reports a hidden network.
//  - **Splitting respects nmcli's escaping.** In terse mode nmcli escapes `:`
//    and `\` inside values as `\:` and `\\`; a plain split on `:` shifts every
//    field after a BSSID (which is full of colons) or after an SSID containing
//    one.

// Fields requested from `nmcli -t -f ... dev wifi`, in order. SSID-HEX carries
// the name; the plain SSID is deliberately not requested — it is the field that
// cannot be parsed safely, and asking for it invites using it.
const SCAN_FIELDS = [
  'SSID-HEX',
  'BSSID',
  'MODE',
  'CHAN',
  'FREQ',
  'SIGNAL',
  'SECURITY',
  'ACTIVE',
];

// Split one terse line on unescaped colons. `\:` is a literal colon inside a
// value, `\\` a literal backslash — both are unescaped here, once, in the only
// place that knows about the encoding.
const splitTerse = (line) => {
  const fields = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      current += line[i + 1];
      i += 1;
    } else if (ch === ':') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

// Hex -> name. Returns null for a hidden network (nmcli reports it as empty),
// which is a state to show as such, not a blank row in the list.
const decodeSsid = (hex) => {
  const clean = (hex || '').trim();
  if (!clean) return null;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const name = Buffer.from(clean, 'hex').toString('utf8');
  return name.length ? name : null;
};

// "2457 MHz" -> 2457. Also tolerates a bare number.
const parseFreq = (raw) => {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const bandOf = (freqMhz) => {
  if (freqMhz == null) return null;
  if (freqMhz >= 2400 && freqMhz < 2500) return '2.4';
  if (freqMhz >= 4900 && freqMhz < 5900) return '5';
  if (freqMhz >= 5900) return '6';
  return null;
};

const parseInteger = (raw) => {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

// nmcli reports security as a space-separated LIST ("WPA2 WPA3"), and an empty
// value means the network is open — which the UI must know, or it asks for a
// passphrase that does not exist.
const parseSecurity = (raw) => {
  const parts = String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { security: parts, open: parts.length === 0 };
};

// One scan line -> one access point. Returns null for a line that is not one.
const parseScanLine = (line) => {
  if (!line || !line.trim()) return null;
  const f = splitTerse(line);
  if (f.length < SCAN_FIELDS.length) return null;

  const [hex, bssid, mode, chan, freq, signal, security, active] = f;
  const freqMhz = parseFreq(freq);
  const { security: securityList, open } = parseSecurity(security);

  return {
    ssid: decodeSsid(hex), // null = hidden
    hidden: decodeSsid(hex) === null,
    bssid: bssid || null,
    mode: mode || null,
    channel: parseInteger(chan),
    frequency: freqMhz,
    band: bandOf(freqMhz),
    signal: parseInteger(signal) ?? 0,
    security: securityList,
    open,
    active: String(active ?? '').trim() === 'yes',
  };
};

// A network is one SSID, not one radio. The same router answers on 2.4 and 5 GHz
// (and repeaters add more), so a raw scan lists it several times — three rows for
// the same name is normal. Merge on the name, keep the strongest signal, and
// remember which bands it was seen on.
//
// Hidden networks are NOT merged: they have no name to merge on, and collapsing
// them would present several different networks as one.
const dedupeBySsid = (networks) => {
  const byName = new Map();
  const hidden = [];

  for (const n of networks) {
    if (n.hidden) {
      hidden.push(n);
      continue;
    }
    const seen = byName.get(n.ssid);
    if (!seen) {
      byName.set(n.ssid, { ...n, bands: n.band ? [n.band] : [] });
      continue;
    }
    if (n.band && !seen.bands.includes(n.band)) seen.bands.push(n.band);
    seen.active = seen.active || n.active;
    // Keep the strongest reading as the representative one.
    if (n.signal > seen.signal) {
      Object.assign(seen, n, { bands: seen.bands, active: seen.active });
    }
  }

  return [...byName.values(), ...hidden].sort((a, b) => b.signal - a.signal);
};

// Full stdout of `nmcli -t -f <SCAN_FIELDS> dev wifi` -> networks, deduped.
const parseScan = (stdout) =>
  dedupeBySsid(
    String(stdout ?? '')
      .split('\n')
      .map(parseScanLine)
      .filter(Boolean)
  );


// ---------------------------------------------------------------------------
// Interfaces, saved profiles, routing
// ---------------------------------------------------------------------------

// `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev` -> the wifi radios.
//
// `wifi-p2p` entries (`p2p-dev-wlan0`) are filtered out: NetworkManager exposes
// one per radio for Wi-Fi Direct, they cannot hold a normal connection, and
// showing them would offer the user an adapter that does nothing.
const parseDevices = (stdout) =>
  String(stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitTerse)
    .filter((f) => f.length >= 4)
    .map(([device, type, state, connection]) => ({
      device,
      type,
      state,
      connection: connection || null,
    }))
    .filter((d) => d.type === 'wifi');

// nmcli QUALIFIES the connected state: `connected (site only)` when the network
// has no way out, `connected (local only)`, `connected (externally)` for a link
// another daemon brought up. All of them are a radio that is associated with a
// network, which is what the panel and the connect verification ask about — an
// exact match on the bare word reported a joined radio as disconnected, and the
// join then tore its own profile back down as unconfirmed.
const isConnectedState = (state) => /^connected\b/.test(String(state ?? '').trim());

// `nmcli -t -f NAME,UUID,TYPE,DEVICE,ACTIVE c show` -> the saved wifi profiles.
// A profile with no device is simply not active right now; it is still saved.
const parseConnections = (stdout) =>
  String(stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitTerse)
    .filter((f) => f.length >= 5)
    .map(([name, uuid, type, device, active]) => ({
      name,
      uuid,
      type,
      device: device || null,
      active: active === 'yes',
    }))
    .filter((c) => c.type === '802-11-wireless');

// `nmcli -g <fields> ...` prints the values alone, one line, still escaping `:`
// and `\` — so the same splitter that reads a terse table reads them here.
const parseValues = (stdout) => {
  const line =
    String(stdout ?? '')
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .find((l) => l.length) ?? '';
  return splitTerse(line);
};

// `ip -o route show default` -> which interface actually carries traffic.
// Used to preselect the adapter when a device has more than one radio: on an
// Apollo II with a USB dongle the built-in may be attached to something else
// entirely, so "built-in" is the wrong default.
const parseDefaultRouteDevice = (stdout) => {
  const m = String(stdout ?? '').match(/\bdev\s+(\S+)/);
  return m ? m[1] : null;
};

// An adapter plugged into USB sits under a usb bus in sysfs; a built-in one
// hangs off the platform or PCI bus. Used to LABEL the adapter, never to hide
// it — on many Apollo II the USB dongle is the only wifi that works well.
const isUsbPath = (sysfsPath) => /\/usb\d|\/usb[/:]/.test(String(sysfsPath ?? ''));

// nmcli exit codes are stable enough to branch on, and its messages are the only
// thing that says WHY. Mapping them here keeps "wrong password" from reaching the
// user as "exited with code 4".
const classifyError = (code, output = '') => {
  const text = String(output);
  if (/No network with SSID/i.test(text)) return 'ssid-not-found';
  if (/Secrets were required|password.*required|invalid password|802\.1X supplicant/i.test(text))
    return 'bad-passphrase';
  if (/Timeout|timed out/i.test(text)) return 'timeout';
  if (/not authorized|Not authorized|permission/i.test(text)) return 'not-authorized';
  // Observed on apollo3 with a wrong passphrase: nmcli exits 4 saying "Connection
  // activation failed: The Wi-Fi network could not be found", which is neither a
  // timeout nor the truth. The cause is genuinely ambiguous at this layer — a
  // wrong key, a radio that dropped, an AP that refused — so say what happened
  // rather than guess why. The UI can suggest checking the password without the
  // backend pretending to know.
  if (/activation failed/i.test(text)) return 'activation-failed';
  if (code === 10) return 'ssid-not-found';
  if (code === 4) return 'activation-failed';
  return 'failed';
};

// The associated link's signal, in dBm, from `iw dev <iface> link`. Null when the
// radio is not associated — `iw` prints "Not connected." and nothing else.
const parseIwSignal = (stdout) => {
  const m = String(stdout || '').match(/signal:\s*(-?\d+)\s*dBm/i);
  if (!m) return null;
  const dbm = parseInt(m[1], 10);
  return Number.isFinite(dbm) ? dbm : null;
};

// dBm to the 0-100 scale nmcli reports and the UI's bars already speak, so a
// live reading and a scanned one can be drawn by the same component.
// -50 and better is full, -100 and worse is nothing; linear between.
const signalQuality = (dbm) => {
  if (!Number.isFinite(dbm)) return null;
  return Math.max(0, Math.min(100, Math.round(2 * (dbm + 100))));
};

module.exports = {
  parseIwSignal,
  signalQuality,
  SCAN_FIELDS,
  splitTerse,
  decodeSsid,
  parseScanLine,
  dedupeBySsid,
  parseScan,
  parseDevices,
  isConnectedState,
  parseConnections,
  parseValues,
  parseDefaultRouteDevice,
  isUsbPath,
  classifyError,
  bandOf,
};
