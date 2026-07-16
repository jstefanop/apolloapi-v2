/**
 * System-level MQTT service — owns the broker config, the input mappings and the
 * output settings, and is the single place that (re)configures the shared client.
 *
 * The connection serves both directions: it subscribes to the input topics (fed
 * to automation signals) and publishes the device telemetry (Home Assistant
 * discovery). Because it belongs to the whole device, it lives here and in
 * Settings → MQTT, not inside the automation feature.
 */
const client = require('./client');

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

const DEFAULT_OUTPUT = { enabled: false, control: true, exports: { miner: true, node: true, solo: true, mcu: false } };

class MqttService {
  constructor(knex) {
    this.knex = knex;
  }

  async getConfig() {
    const row = await this.knex('mqtt_config').where({ id: 1 }).first();
    if (!row) {
      return { enabled: false, host: null, port: 1883, username: null, password: null, tls: false, output: { ...DEFAULT_OUTPUT }, inputs: [] };
    }
    return {
      enabled: !!row.enabled,
      host: row.host || null,
      port: row.port || 1883,
      username: row.username || null,
      password: row.password || null,
      tls: !!row.tls,
      output: { ...DEFAULT_OUTPUT, ...parseJson(row.output, {}) },
      inputs: parseJson(row.inputs, []),
    };
  }

  async updateConfig(input = {}) {
    const update = {};
    if (input.enabled !== undefined) update.enabled = input.enabled;
    if (input.host !== undefined) update.host = input.host;
    if (input.port !== undefined) update.port = input.port;
    if (input.username !== undefined) update.username = input.username;
    if (input.tls !== undefined) update.tls = input.tls;
    if (input.output !== undefined) update.output = input.output === null ? null : JSON.stringify(input.output);
    if (input.inputs !== undefined) update.inputs = input.inputs === null ? null : JSON.stringify(input.inputs);
    // The password is never returned to the UI, so a blank one on save means
    // "unchanged" — keep the stored one.
    if (input.password) update.password = input.password;

    if (Object.keys(update).length) {
      update.updated_at = this.knex.fn.now();
      await this.knex('mqtt_config').where({ id: 1 }).update(update);
    }

    const config = await this.getConfig();
    await this.reconfigure(config);
    return config;
  }

  /**
   * Point the shared client at the current broker + input mappings, and reconcile
   * the Home Assistant output discovery. The client reconnects only when the
   * broker or topics changed; an output-only edit just re-syncs discovery.
   */
  async reconfigure(config) {
    const cfg = config || (await this.getConfig());
    try {
      client.configure({
        enabled: cfg.enabled,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        tls: cfg.tls,
        inputs: cfg.inputs,
      });
    } catch (e) {
      console.log('[mqtt] configure failed:', e.message);
    }
    // Reconcile output discovery (toggling output does not change the connection,
    // so the client's onConnect hook won't fire). Lazy require avoids a cycle.
    try {
      await require('../index').mqttOutput.syncDiscovery();
    } catch (e) {
      /* output not wired (tests) */
    }
  }

  // Called by the scheduler at boot to open the connection from stored config.
  async init() {
    await this.reconfigure(await this.getConfig());
  }

  // Fill in the stored password when the form left it blank (test/discovery probes).
  async _withPassword(input) {
    let cfg = input || {};
    if (!cfg.password) {
      const existing = await this.getConfig();
      if (existing.password) cfg = { ...cfg, password: existing.password };
    }
    return cfg;
  }

  async testConnection(input) {
    return client.testConnection(await this._withPassword(input));
  }

  async discoverTopics(input, opts) {
    return client.discoverTopics(await this._withPassword(input), opts);
  }
}

module.exports = (knex) => new MqttService(knex);
