/**
 * A single MQTT connection to the user's broker (their Home Assistant broker),
 * shared by the whole automation. Right now it only reads: it subscribes to the
 * topics the user mapped and caches the latest value per input, so the
 * `input.<name>` signals can react to them (e.g. the solar surplus published by
 * the SUN2000→MQTT bridge).
 *
 * Singleton module state: there is one broker connection for the process.
 */
const mqtt = require('mqtt');

let client = null;
let signature = null; // connection identity — reconnect only when it changes
let status = { connected: false, error: null };
let inputs = []; // [{ name, topic, jsonPath, unit }]
const cache = new Map(); // name -> { value, at }

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
  });

  client.on('connect', () => {
    status = { connected: true, error: null };
    if (topics.length) client.subscribe(topics, () => {});
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

module.exports = {
  configure,
  disconnect,
  testConnection,
  getValue: (name) => cache.get(name) || null,
  getStatus: () => ({ ...status }),
  // Test helpers.
  _reset: () => {
    disconnect();
    signature = null;
    inputs = [];
    cache.clear();
  },
  _ingest: onMessage, // simulate an incoming message in tests
  _setStatus: (s) => {
    status = { ...status, ...s };
  },
};
