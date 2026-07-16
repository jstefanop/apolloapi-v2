/**
 * MQTT output — the device publishing itself to the user's broker.
 *
 * The input side (./client, ./signals/mqttInput) lets rules react to external
 * topics; this is the opposite direction. It publishes the miner's state and,
 * when the user allows control, exposes command topics so Home Assistant can
 * start/stop the miner and pick a mode. It also announces itself with Home
 * Assistant MQTT Discovery, so the Apollo shows up as a device in HA with no
 * manual YAML.
 *
 *   telemetry   apollo/<id>/state        (retained JSON: mining, hashrate, temp, …)
 *   presence    apollo/<id>/status       (retained "online"/"offline"; also the LWT)
 *   commands    apollo/<id>/miner/set    ("ON"/"OFF")
 *               apollo/<id>/mode/set     (eco|balanced|turbo|custom)
 *   discovery   homeassistant/<comp>/<id>/<key>/config   (retained)
 *
 * A command counts as a *user* action: it pauses the automation exactly like a
 * manual start/stop from the UI (miner.js does this for source:'user').
 */

const os = require('os');
const fs = require('fs');
const client = require('./client');
const { MINER_MODES } = require('../../constants/minerModes');

let pkgVersion = '2';
try {
  pkgVersion = require('../../../package.json').version || '2';
} catch (e) {
  /* ignore */
}

/**
 * A stable, unique id for this device — the same across reboots and unique on the
 * LAN, so Home Assistant keeps the same entities. Prefer the systemd machine-id,
 * fall back to the first real MAC, then the hostname.
 */
function deviceId() {
  try {
    const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (machineId) return `apollo_${machineId.slice(0, 12)}`;
  } catch (e) {
    /* not systemd / no permission */
  }
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return `apollo_${iface.mac.replace(/:/g, '').toLowerCase()}`;
      }
    }
  }
  return `apollo_${(os.hostname() || 'device').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
}

class MqttOutput {
  constructor(knex, deps) {
    this.knex = knex;
    this.deps = deps; // { miner, settings, automation, mqtt }
    this.id = deviceId();
    this.base = `apollo/${this.id}`;
    this.stateTopic = `${this.base}/state`;
    this.availabilityTopic = `${this.base}/status`;
    this.minerCmdTopic = `${this.base}/miner/set`;
    this.modeCmdTopic = `${this.base}/mode/set`;
  }

  // Register with the shared client (last-will, command subscriptions, hooks).
  // Called once at boot; the client applies the will on its next connect.
  init() {
    client.setOutput({
      will: { topic: this.availabilityTopic, payload: 'offline' },
      commandTopics: [this.minerCmdTopic, this.modeCmdTopic],
      onCommand: (topic, payload) => this.handleCommand(topic, payload),
      onConnect: () => this.syncDiscovery(),
    });
  }

  async _outputConfig() {
    const mqtt = await this.deps.mqtt.getConfig();
    const out = mqtt.output || {};
    return {
      // Output rides on the broker link: it needs the connection enabled too.
      enabled: !!(mqtt.enabled && out.enabled),
      control: out.control !== false, // default on
    };
  }

  // The device object every discovery entity shares — this is what groups them
  // into one "FutureBit Apollo" device in Home Assistant.
  _device() {
    return {
      identifiers: [this.id],
      name: 'FutureBit Apollo',
      manufacturer: 'FutureBit',
      model: process.env.NEXT_PUBLIC_DEVICE_TYPE || 'Apollo',
      sw_version: pkgVersion,
    };
  }

  // [{ topic, payload }] — one retained config message per HA entity. Sensors read
  // the shared state JSON; the switch/select add command topics (control only).
  _discoveryConfigs({ control }) {
    const device = this._device();
    const common = { availability_topic: this.availabilityTopic, device };
    const sensor = (key, extra) => ({
      component: 'sensor',
      key,
      payload: { ...common, unique_id: `${this.id}_${key}`, state_topic: this.stateTopic, ...extra },
    });

    const entities = [
      {
        component: 'binary_sensor',
        key: 'mining',
        payload: {
          ...common,
          name: 'Mining',
          unique_id: `${this.id}_mining`,
          state_topic: this.stateTopic,
          value_template: '{{ value_json.mining }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: 'running',
        },
      },
      sensor('hashrate', {
        name: 'Hashrate',
        value_template: '{{ value_json.hashrate }}',
        unit_of_measurement: 'TH/s',
        icon: 'mdi:speedometer',
      }),
      sensor('temperature', {
        name: 'Board temperature',
        value_template: '{{ value_json.temp }}',
        unit_of_measurement: '°C',
        device_class: 'temperature',
      }),
      sensor('power', {
        name: 'Power',
        value_template: '{{ value_json.power }}',
        unit_of_measurement: 'W',
        device_class: 'power',
      }),
      sensor('mode', { name: 'Miner mode', value_template: '{{ value_json.mode }}', icon: 'mdi:tune' }),
      sensor('automation', {
        name: 'Automation',
        value_template: '{{ value_json.automation }}',
        icon: 'mdi:robot',
      }),
    ];

    if (control) {
      entities.push({
        component: 'switch',
        key: 'miner',
        payload: {
          ...common,
          name: 'Miner',
          unique_id: `${this.id}_miner`,
          state_topic: this.stateTopic,
          value_template: '{{ value_json.mining }}',
          command_topic: this.minerCmdTopic,
          payload_on: 'ON',
          payload_off: 'OFF',
          icon: 'mdi:pickaxe',
        },
      });
      entities.push({
        component: 'select',
        key: 'minermode',
        payload: {
          ...common,
          name: 'Miner mode',
          unique_id: `${this.id}_minermode`,
          state_topic: this.stateTopic,
          value_template: '{{ value_json.mode }}',
          command_topic: this.modeCmdTopic,
          options: [...MINER_MODES],
          icon: 'mdi:tune',
        },
      });
    }

    return entities.map((e) => ({
      topic: `homeassistant/${e.component}/${this.id}/${e.key}/config`,
      payload: e.payload,
    }));
  }

  // The single retained telemetry snapshot the HA entities read from.
  async buildTelemetry() {
    const [statusRow, statsRes, settings, config] = await Promise.all([
      this.knex('service_status').select('status').where({ service_name: 'miner' }).first(),
      this.deps.miner.getStats(),
      this.deps.settings.read(),
      this.deps.automation.getConfig(),
    ]);

    let hashrateGh = 0;
    let power = 0;
    let temp = null;
    for (const board of statsRes?.stats || []) {
      const h = Number(board?.master?.intervals?.int_30?.bySol);
      if (Number.isFinite(h)) hashrateGh += h;
      const w = Number(board?.master?.boardsW);
      if (Number.isFinite(w)) power += w;
      const t = Number(board?.slots?.int_0?.temperature);
      if (Number.isFinite(t) && t > 0) temp = Math.max(temp ?? 0, t);
    }

    const automation = config.enabled ? (config.dryRun ? 'observing' : 'on') : 'off';

    return {
      mining: statusRow?.status === 'online' ? 'ON' : 'OFF',
      // apollo-miner reports GH/s; Home Assistant shows TH/s.
      hashrate: Math.round((hashrateGh / 1000) * 1000) / 1000,
      power: Math.round(power),
      temp: temp == null ? null : Math.round(temp * 10) / 10,
      mode: settings?.minerMode || 'unknown',
      automation,
    };
  }

  // Publish the current telemetry (retained), if output is on and the link is up.
  async publishState() {
    const { enabled } = await this._outputConfig();
    if (!enabled || !client.isConnected()) return;
    client.publish(this.stateTopic, await this.buildTelemetry(), { retain: true });
  }

  /**
   * Reconcile Home Assistant with the current output config. On enable: announce
   * availability, (re)publish the discovery configs and a first state. On disable:
   * clear the discovery configs (empty retained payload removes the entities) and
   * mark the device offline. Called on every connect and whenever the config changes.
   */
  async syncDiscovery() {
    if (!client.isConnected()) return;
    const { enabled, control } = await this._outputConfig();

    if (enabled) {
      client.publish(this.availabilityTopic, 'online', { retain: true, qos: 1 });
      for (const cfg of this._discoveryConfigs({ control })) {
        client.publish(cfg.topic, cfg.payload, { retain: true, qos: 1 });
      }
      // If control is off, make sure a previously-published switch/select is gone.
      if (!control) {
        const controls = this._discoveryConfigs({ control: true }).filter(
          (c) => !this._discoveryConfigs({ control: false }).some((k) => k.topic === c.topic)
        );
        for (const c of controls) client.publish(c.topic, '', { retain: true });
      }
      await this.publishState();
    } else {
      for (const cfg of this._discoveryConfigs({ control: true })) {
        client.publish(cfg.topic, '', { retain: true });
      }
      client.publish(this.availabilityTopic, 'offline', { retain: true, qos: 1 });
    }
  }

  // A command from Home Assistant. Runs as a user action so it pauses the
  // automation, then re-publishes the state so HA reflects the result at once.
  async handleCommand(topic, payload) {
    const { enabled, control } = await this._outputConfig();
    if (!enabled || !control) return;

    const value = String(payload).trim();

    if (topic === this.minerCmdTopic) {
      if (value.toUpperCase() === 'ON') await this.deps.miner.start({ source: 'user' });
      else if (value.toUpperCase() === 'OFF') await this.deps.miner.stop({ source: 'user' });
      else return;
    } else if (topic === this.modeCmdTopic) {
      if (!MINER_MODES.includes(value)) return;
      await this.deps.settings.update({ minerMode: value });
      const row = await this.knex('service_status').select('status').where({ service_name: 'miner' }).first();
      if (row?.status === 'online') await this.deps.miner.restart({ source: 'user' });
    } else {
      return;
    }

    await this.publishState();
  }
}

module.exports = (knex, deps) => new MqttOutput(knex, deps);
module.exports.deviceId = deviceId;
