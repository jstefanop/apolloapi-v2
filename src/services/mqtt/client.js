/**
 * A single MQTT connection to the user's broker (their Home Assistant broker),
 * shared by the whole automation. It reads and writes:
 *   - reads: subscribes to the topics the user mapped and caches the latest value
 *     per input, so the `input.<name>` signals can react to them (e.g. the solar
 *     surplus published by the SUN2000→MQTT bridge);
 *   - writes: publishes the device's own state and (optionally) exposes command
 *     topics, so Home Assistant can watch and control the miner. The output side
 *     lives in ./output; here we only own the connection, publish() and command
 *     routing.
 *
 * Singleton module state: there is one broker connection for the process.
 */
const mqtt = require('mqtt');

let client = null;
let signature = null; // connection identity — reconnect only when it changes
let status = { connected: false, error: null };
let inputs = []; // [{ name, topic, jsonPath, unit }]
const cache = new Map(); // name -> { value, at }

// The output side registers itself here (set once at boot, before the first
// connect): { will, commandTopics, onCommand, onConnect }. Kept out of the
// connection signature so toggling output on/off never drops the input link.
let output = null;

const getByPath = (obj, path) =>
  String(path)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);

// A message payload → a number, via an optional JSON path (else the raw payload).
function extractValue(input, payloadStr) {
  if (input.jsonPath) {
    try {
      return Number(getByPath(JSON.parse(payloadStr), input.jsonPath));
    } catch (e) {
      return NaN;
    }
  }
  return Number(payloadStr);
}

function onMessage(topic, payload) {
  const str = payload.toString();

  // A command topic (miner/mode set from Home Assistant) — route it and stop; a
  // command topic is never also an input topic.
  if (output && output.commandTopics && output.commandTopics.includes(topic)) {
    if (output.onCommand) Promise.resolve(output.onCommand(topic, str)).catch(() => {});
    return;
  }

  for (const input of inputs) {
    if (input.topic !== topic) continue;
    const value = extractValue(input, str);
    if (Number.isFinite(value)) cache.set(input.name, { value, at: Date.now() });
  }
}

function disconnect() {
  if (client) {
    try {
      client.end(true);
    } catch (e) {
      /* ignore */
    }
    client = null;
  }
  status = { connected: false, error: null };
}

/**
 * Point the client at the current MQTT config. Reconnects only when the broker or
 * the set of topics changed; a jsonPath/unit-only edit just refreshes the mapping.
 */
function configure(mqttConfig) {
  const cfg = mqttConfig || {};
  const enabled = !!(cfg.enabled && cfg.host);
  const nextInputs = (cfg.inputs || []).filter((i) => i && i.name && i.topic);
  const topics = [...new Set(nextInputs.map((i) => i.topic))];

  const sig = JSON.stringify({
    enabled,
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    tls: cfg.tls,
    topics,
  });

  inputs = nextInputs; // always refresh the mappings (jsonPath/unit)
  if (sig === signature) return; // same connection + topics — nothing to redo
  signature = sig;

  disconnect();
  cache.clear();
  if (!enabled) return;

  const url = `${cfg.tls ? 'mqtts' : 'mqtt'}://${cfg.host}:${cfg.port || 1883}`;
  client = mqtt.connect(url, {
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 8000,
    // Last-will: if the link drops, the broker marks the device unavailable so
    // Home Assistant greys the entities out instead of showing stale values.
    ...(output && output.will
      ? { will: { topic: output.will.topic, payload: output.will.payload, qos: 1, retain: true } }
      : {}),
  });

  client.on('connect', () => {
    status = { connected: true, error: null };
    const subs = [...topics, ...((output && output.commandTopics) || [])];
    if (subs.length) client.subscribe(subs, () => {});
    // Let the output side (re)publish its discovery + availability + first state.
    if (output && output.onConnect) Promise.resolve(output.onConnect()).catch(() => {});
  });
  client.on('message', onMessage);
  client.on('error', (e) => {
    status = { connected: false, error: e.message };
  });
  client.on('close', () => {
    status = { connected: false, error: status.error };
  });
}

// Human-readable MQTT CONNACK refusal reasons.
const CONNACK = {
  1: 'unacceptable protocol version',
  2: 'client id rejected',
  3: 'broker unavailable',
  4: 'bad username or password',
  5: 'not authorized',
};

// One-off connection attempt with the given config — does not touch the shared
// client. Resolves { ok, error } so the UI can tell the user exactly what failed.
function testConnection(mqttConfig) {
  return new Promise((resolve) => {
    const cfg = mqttConfig || {};
    if (!cfg.host) return resolve({ ok: false, error: 'No broker host set' });

    const url = `${cfg.tls ? 'mqtts' : 'mqtt'}://${cfg.host}:${cfg.port || 1883}`;
    const probe = mqtt.connect(url, {
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      connectTimeout: 6000,
      reconnectPeriod: 0, // one shot
    });

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        probe.end(true);
      } catch (e) {
        /* ignore */
      }
      resolve(result);
    };

    probe.on('connect', () => finish({ ok: true, error: null }));
    probe.on('error', (e) =>
      finish({ ok: false, error: e.code && CONNACK[e.code] ? `Rejected: ${CONNACK[e.code]}` : e.code ? `Error ${e.code}` : e.message })
    );
    setTimeout(() => finish({ ok: false, error: 'Timed out — no response from the broker' }), 7000);
  });
}

// Dot-paths to numeric-ish leaves in a JSON payload — the candidate jsonPaths a
// user would map (e.g. "battery.soc", "active_power").
function numericPaths(obj, prefix = '', out = [], depth = 0) {
  if (depth > 4 || out.length > 50) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      numericPaths(v, path, out, depth + 1);
    } else if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))) {
      out.push(path);
    }
  }
  return out;
}

// A Home Assistant discovery `value_template` -> the dot-path it reads, e.g.
// "{{ value_json.total_yield }}" -> "total_yield", "{{ value_json['a']['b'] }}"
// -> "a.b". Null when the template does not pull a field out of value_json.
function jsonPathFromTemplate(tpl) {
  if (!tpl || typeof tpl !== 'string') return null;
  const i = tpl.indexOf('value_json');
  if (i < 0) return null;
  let rest = tpl.slice(i + 'value_json'.length);
  const parts = [];
  const re = /^\s*(?:\.([A-Za-z0-9_]+)|\[\s*['"]([^'"]+)['"]\s*\])/;
  let m = rest.match(re);
  while (m) {
    parts.push(m[1] || m[2]);
    rest = rest.slice(m[0].length);
    m = rest.match(re);
  }
  return parts.length ? parts.join('.') : null;
}

/**
 * Resolve a Home Assistant sensor discovery config to the value it describes.
 * The `homeassistant/sensor/<x>/config` topics carry a definition, not a value:
 * the real reading lives on the `state_topic` inside, pulled out by the
 * `value_template`. Browsing showed users these config topics and they mapped the
 * wrong one; here we turn each into a ready-to-use { topic, jsonPath, name, unit }.
 */
function resolveHaSensorConfig(topic, sample) {
  if (!/^homeassistant\/sensor\/.+\/config$/.test(topic)) return null;
  let cfg;
  try {
    cfg = JSON.parse(sample);
  } catch (e) {
    return null;
  }
  if (!cfg || typeof cfg !== 'object' || !cfg.state_topic) return null;
  return {
    topic: cfg.state_topic,
    jsonPath: jsonPathFromTemplate(cfg.value_template),
    name: cfg.name || null,
    unit: cfg.unit_of_measurement || null,
    sample: null,
    jsonPaths: null,
  };
}

// The current reading behind a resolved sensor: pull the field out of the state
// topic's payload (or the raw payload when there is no jsonPath). Null when the
// state topic has published nothing yet — which itself tells the user something.
function currentValue(payload, jsonPath) {
  if (payload === undefined || payload === null) return null;
  if (!jsonPath) return String(payload).slice(0, 80);
  try {
    const v = getByPath(JSON.parse(payload), jsonPath);
    return v === undefined || v === null ? null : String(v).slice(0, 80);
  } catch (e) {
    return null;
  }
}

/**
 * Browse the broker: subscribe to a wildcard for a few seconds and collect the
 * topics that publish (retained ones arrive immediately). One-off connection,
 * separate from the shared client.
 */
function discoverTopics(mqttConfig, { prefix, seconds } = {}) {
  return new Promise((resolve) => {
    const cfg = mqttConfig || {};
    if (!cfg.host) return resolve({ ok: false, error: 'No broker host set', topics: [] });

    // Up to 45s: non-retained topics (e.g. a SUN2000 bridge that publishes every
    // ~40s) need a window near their interval for a value to be caught at all.
    const window = Math.min(Math.max(seconds || 4, 1), 45);
    const filter = prefix ? `${String(prefix).replace(/[/#\s]+$/, '')}/#` : '#';
    const url = `${cfg.tls ? 'mqtts' : 'mqtt'}://${cfg.host}:${cfg.port || 1883}`;
    const probe = mqtt.connect(url, {
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      connectTimeout: 6000,
      reconnectPeriod: 0,
    });

    const found = new Map(); // topic -> full payload (bounded; truncated only for display)
    const stateSubs = new Set(); // state topics we subscribed to for current values
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        probe.end(true);
      } catch (e) {
        /* ignore */
      }
      resolve(result);
    };

    probe.on('error', (e) =>
      finish({ ok: false, error: e.code && CONNACK[e.code] ? `Rejected: ${CONNACK[e.code]}` : e.code ? `Error ${e.code}` : e.message, topics: [] })
    );
    probe.on('connect', () => {
      probe.subscribe(filter, (err) => {
        if (err) finish({ ok: false, error: err.message, topics: [] });
      });
    });
    probe.on('message', (topic, payload) => {
      if (found.size >= 400 && !found.has(topic)) return;
      // Keep the whole payload (bounded) so HA discovery configs stay parseable;
      // they are long (the shared `device` object) and a 300-char cut broke them.
      const str = payload.toString().slice(0, 4000);
      found.set(topic, str);
      // When a sensor config arrives, also listen to the value it points at (often
      // outside the browse prefix), so we can show the current reading.
      const ha = resolveHaSensorConfig(topic, str);
      if (ha && ha.topic && !stateSubs.has(ha.topic)) {
        stateSubs.add(ha.topic);
        try {
          probe.subscribe(ha.topic, () => {});
        } catch (e) {
          /* ignore */
        }
      }
    });

    setTimeout(() => {
      const entities = []; // resolved HA sensors — the useful, named values
      const plain = []; // everything else

      for (const [topic, sample] of [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ha = resolveHaSensorConfig(topic, sample);
        if (ha) {
          ha.value = currentValue(found.get(ha.topic), ha.jsonPath);
          entities.push(ha);
          continue;
        }
        // Hide the rest of the Home Assistant discovery metadata (binary_sensor,
        // switch, select, … /config): it is definitions, not states/values.
        if (/^homeassistant\/.+\/config$/.test(topic)) continue;

        let jsonPaths = [];
        try {
          const parsed = JSON.parse(sample);
          if (parsed && typeof parsed === 'object') jsonPaths = numericPaths(parsed);
        } catch (e) {
          /* not JSON */
        }
        plain.push({ topic, sample: sample.slice(0, 300), jsonPaths, value: jsonPaths.length ? null : sample.slice(0, 80) });
      }

      entities.sort((a, b) => (a.name || a.jsonPath || '').localeCompare(b.name || b.jsonPath || ''));
      finish({ ok: true, error: null, topics: [...entities, ...plain] });
    }, window * 1000);
  });
}

/**
 * Register the output side (once, at boot). Stores the last-will, the command
 * topics to subscribe, and the callbacks. If the link is already up, subscribe
 * the command topics and fire onConnect now so a late registration still works.
 */
function setOutput(o) {
  output = o || null;
  if (client && status.connected && output) {
    if (output.commandTopics && output.commandTopics.length) client.subscribe(output.commandTopics, () => {});
    if (output.onConnect) Promise.resolve(output.onConnect()).catch(() => {});
  }
}

// Publish, but only when the link is up — telemetry is disposable, so a message
// sent while disconnected is simply dropped (retained state catches HA up on the
// next connect).
function publish(topic, payload, { retain = false, qos = 0 } = {}) {
  if (!client || !status.connected) return false;
  try {
    client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain, qos });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  configure,
  disconnect,
  testConnection,
  discoverTopics,
  setOutput,
  publish,
  isConnected: () => status.connected,
  getValue: (name) => cache.get(name) || null,
  getStatus: () => ({ ...status }),
  // Test helpers.
  _reset: () => {
    disconnect();
    signature = null;
    inputs = [];
    output = null;
    cache.clear();
  },
  _ingest: onMessage, // simulate an incoming message in tests
  _setStatus: (s) => {
    status = { ...status, ...s };
  },
  _jsonPathFromTemplate: jsonPathFromTemplate,
  _resolveHaSensorConfig: resolveHaSensorConfig,
  _currentValue: currentValue,
};
