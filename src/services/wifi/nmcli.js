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

module.exports = {
  SCAN_FIELDS,
  splitTerse,
  decodeSsid,
  parseScanLine,
  dedupeBySsid,
  parseScan,
};
