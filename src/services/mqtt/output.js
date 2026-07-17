/**
 * MQTT output — the device publishing itself to the user's broker.
 *
 * The input side (./client, ./signals/mqttInput) lets rules react to external
 * topics; this is the opposite direction. It publishes the device state, one
 * topic per domain, and announces everything with Home Assistant MQTT Discovery.
 * The user picks what to export (miner / node / solo / mcu) in Settings → MQTT.
 *
 *   apollo/<id>/state   miner + automation (retained JSON)   ← miner devices only
 *   apollo/<id>/node    bitcoind (height, sync, peers, …)
 *   apollo/<id>/solo    ckpool (best share, workers, …)
 *   apollo/<id>/mcu     the SBC (temperature, load)
 *   apollo/<id>/status  retained "online"/"offline" (also the LWT)
 *   apollo/<id>/miner/set, /mode/set   commands (control only)
 *   homeassistant/<comp>/<id>/<key>/config   discovery (retained)
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

const round = (n, d = 1) => {
  const f = Math.pow(10, d);
  return Math.round(Number(n) * f) / f;
};

class MqttOutput {
  constructor(knex, deps) {
    this.knex = knex;
    this.deps = deps; // { miner, settings, automation, mqtt, node, solo, mcu }
    this.id = deviceId();
    this.base = `apollo/${this.id}`;
    this.availabilityTopic = `${this.base}/status`;
    this.minerCmdTopic = `${this.base}/miner/set`;
    this.modeCmdTopic = `${this.base}/mode/set`;
    this.topics = {
      miner: `${this.base}/state`,
      node: `${this.base}/node`,
      solo: `${this.base}/solo`,
      mcu: `${this.base}/mcu`,
    };
    // A solo-node has no miner, so the miner domain is skipped there.
    this.hasMiner = process.env.NEXT_PUBLIC_DEVICE_TYPE !== 'solo-node';
  }

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
    const exports = out.exports || {};
    return {
      // Output rides on the broker link: it needs the connection enabled too.
      enabled: !!(mqtt.enabled && out.enabled),
      control: out.control !== false, // default on
      exports: {
        miner: exports.miner !== false && this.hasMiner,
        node: exports.node !== false,
        solo: exports.solo !== false,
        mcu: !!exports.mcu, // default off
      },
    };
  }

  _device() {
    return {
      identifiers: [this.id],
      name: 'FutureBit Apollo',
      manufacturer: 'FutureBit',
      model: process.env.NEXT_PUBLIC_DEVICE_TYPE || 'Apollo',
      sw_version: pkgVersion,
    };
  }

  _entity(component, key, stateTopic, extra) {
    return {
      topic: `homeassistant/${component}/${this.id}/${key}/config`,
      payload: {
        availability_topic: this.availabilityTopic,
        device: this._device(),
        unique_id: `${this.id}_${key}`,
        state_topic: stateTopic,
        ...extra,
      },
    };
  }

  // ------------------------------------------------------------- discovery

  // [{ topic, payload }] for each domain. The switch/select (control) hang off the
  // miner domain. Keys are prefixed so unique_ids never collide across topics.
  _entities(domain, { control } = {}) {
    const t = this.topics[domain];
    const s = (key, extra) => this._entity('sensor', key, t, extra);

    if (domain === 'miner') {
      const list = [
        this._entity('binary_sensor', 'mining', t, {
          name: 'Mining',
          value_template: '{{ value_json.mining }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          device_class: 'running',
        }),
        s('hashrate', { name: 'Hashrate', value_template: '{{ value_json.hashrate }}', unit_of_measurement: 'TH/s', icon: 'mdi:speedometer' }),
        s('temperature', { name: 'Board temperature', value_template: '{{ value_json.temp }}', unit_of_measurement: '°C', device_class: 'temperature' }),
        s('power', { name: 'Power', value_template: '{{ value_json.power }}', unit_of_measurement: 'W', device_class: 'power' }),
        s('efficiency', { name: 'Efficiency', value_template: '{{ value_json.efficiency }}', unit_of_measurement: 'W/TH', icon: 'mdi:leaf' }),
        s('fan', { name: 'Fan', value_template: '{{ value_json.fan }}', unit_of_measurement: 'rpm', icon: 'mdi:fan' }),
        s('shares_accepted', { name: 'Shares accepted', value_template: '{{ value_json.shares_accepted }}', icon: 'mdi:check' }),
        s('shares_rejected', { name: 'Shares rejected', value_template: '{{ value_json.shares_rejected }}', icon: 'mdi:close' }),
        s('mode', { name: 'Miner mode', value_template: '{{ value_json.mode }}', icon: 'mdi:tune' }),
        s('automation', { name: 'Automation', value_template: '{{ value_json.automation }}', icon: 'mdi:robot' }),
      ];
      if (control) {
        list.push(
          this._entity('switch', 'miner', t, {
            name: 'Miner',
            value_template: '{{ value_json.mining }}',
            command_topic: this.minerCmdTopic,
            payload_on: 'ON',
            payload_off: 'OFF',
            icon: 'mdi:pickaxe',
          }),
          this._entity('select', 'minermode', t, {
            name: 'Miner mode',
            value_template: '{{ value_json.mode }}',
            command_topic: this.modeCmdTopic,
            options: [...MINER_MODES],
            icon: 'mdi:tune',
          })
        );
      }
      return list;
    }

    if (domain === 'node') {
      return [
        s('node_status', { name: 'Node status', value_template: '{{ value_json.status }}', icon: 'mdi:bitcoin' }),
        s('node_height', { name: 'Block height', value_template: '{{ value_json.block_height }}', icon: 'mdi:cube-outline' }),
        s('node_sync', { name: 'Sync progress', value_template: '{{ value_json.sync_progress }}', unit_of_measurement: '%', icon: 'mdi:sync' }),
        s('node_size', { name: 'Blockchain size', value_template: '{{ value_json.blockchain_gb }}', unit_of_measurement: 'GB', icon: 'mdi:database' }),
        s('node_last_block', { name: 'Minutes since last block', value_template: '{{ value_json.minutes_since_block }}', unit_of_measurement: 'min', icon: 'mdi:timer-outline' }),
        s('node_connections', { name: 'Node connections', value_template: '{{ value_json.connections }}', icon: 'mdi:lan' }),
        s('node_difficulty', { name: 'Network difficulty', value_template: '{{ value_json.difficulty }}', icon: 'mdi:chart-line' }),
        s('node_nethashrate', { name: 'Network hashrate', value_template: '{{ value_json.network_hashrate_eh }}', unit_of_measurement: 'EH/s', icon: 'mdi:speedometer' }),
        s('node_software', { name: 'Node software', value_template: '{{ value_json.software }}', icon: 'mdi:tag-outline' }),
      ];
    }

    if (domain === 'solo') {
      return [
        s('solo_status', { name: 'Solo pool', value_template: '{{ value_json.status }}', icon: 'mdi:pickaxe' }),
        s('solo_best_share', { name: 'Best share', value_template: '{{ value_json.best_share }}', icon: 'mdi:trophy-outline' }),
        s('solo_workers', { name: 'Workers', value_template: '{{ value_json.workers }}', icon: 'mdi:account-hard-hat' }),
        s('solo_hashrate', { name: 'Solo hashrate', value_template: '{{ value_json.hashrate }}', icon: 'mdi:speedometer' }),
        s('solo_accepted', { name: 'Solo shares accepted', value_template: '{{ value_json.shares_accepted }}', icon: 'mdi:check' }),
        s('solo_rejected', { name: 'Solo shares rejected', value_template: '{{ value_json.shares_rejected }}', icon: 'mdi:close' }),
      ];
    }

    // mcu
    return [
      s('mcu_temp', { name: 'System temperature', value_template: '{{ value_json.system_temp }}', unit_of_measurement: '°C', device_class: 'temperature' }),
      s('mcu_load', { name: 'System load', value_template: '{{ value_json.load }}', icon: 'mdi:chip' }),
    ];
  }

  // ------------------------------------------------------------- telemetry

  async buildMinerState() {
    const [statusRow, statsRes, settings, config] = await Promise.all([
      this.knex('service_status').select('status').where({ service_name: 'miner' }).first(),
      this.deps.miner.getStats(),
      this.deps.settings.read(),
      this.deps.automation.getConfig(),
    ]);

    let hashrateGh = 0;
    let power = 0;
    let temp = null;
    const fans = [];
    let sharesAccepted = 0;
    let sharesRejected = 0;
    for (const board of statsRes?.stats || []) {
      const h = Number(board?.master?.intervals?.int_30?.bySol);
      if (Number.isFinite(h)) hashrateGh += h;
      const w = Number(board?.master?.boardsW);
      if (Number.isFinite(w)) power += w;
      const t = Number(board?.slots?.int_0?.temperature);
      if (Number.isFinite(t) && t > 0) temp = Math.max(temp ?? 0, t);
      const rpm = Number((board?.fans?.int_0?.rpm || [])[0]);
      if (Number.isFinite(rpm) && rpm > 0) fans.push(rpm);
      const sa = Number(board?.pool?.intervals?.int_0?.sharesAccepted);
      if (Number.isFinite(sa)) sharesAccepted += sa;
      const sr = Number(board?.pool?.intervals?.int_0?.sharesRejected);
      if (Number.isFinite(sr)) sharesRejected += sr;
    }

    const hashrateTh = hashrateGh / 1000;
    const automation = config.enabled ? (config.dryRun ? 'observing' : 'on') : 'off';

    return {
      mining: statusRow?.status === 'online' ? 'ON' : 'OFF',
      hashrate: round(hashrateTh, 3), // apollo-miner reports GH/s; HA shows TH/s
      power: Math.round(power),
      temp: temp == null ? null : round(temp, 1),
      efficiency: hashrateTh > 0 && power > 0 ? round(power / hashrateTh, 1) : null,
      fan: fans.length ? Math.round(fans.reduce((a, b) => a + b, 0) / fans.length) : null,
      shares_accepted: sharesAccepted,
      shares_rejected: sharesRejected,
      mode: settings?.minerMode || 'unknown',
      automation,
    };
  }

  async buildNodeState() {
    const row = await this.knex('service_status').select('status').where({ service_name: 'node' }).first();
    if (row?.status !== 'online') return { status: 'offline' };

    const { stats } = await this.deps.node.getStats();
    if (!stats || stats.error) return { status: 'offline' };

    const bc = stats.blockchainInfo || {};
    const vp = Number(bc.verificationprogress) || 0;
    return {
      status: vp >= 0.9999 ? 'online' : 'syncing',
      block_height: bc.blocks ?? null,
      sync_progress: round(vp * 100, 2),
      blockchain_gb: bc.sizeOnDisk ? round(Number(bc.sizeOnDisk) / 1e9, 1) : null,
      minutes_since_block: bc.blockTime ? Math.round((Date.now() - bc.blockTime * 1000) / 60000) : null,
      connections: stats.connectionCount ?? null,
      difficulty: stats.miningInfo?.difficulty ?? null,
      network_hashrate_eh: stats.miningInfo?.networkhashps ? round(Number(stats.miningInfo.networkhashps) / 1e18, 2) : null,
      software: stats.networkInfo?.subversion || null,
    };
  }

  async buildSoloState() {
    const row = await this.knex('service_status').select('status').where({ service_name: 'solo' }).first();
    if (row?.status !== 'online') return { status: 'offline' };

    const s = await this.deps.solo.getStats();
    const pool = s?.pool || {};
    return {
      status: 'online',
      hashrate: pool.hashrate15m || '0',
      best_share: Number(pool.bestshare) || 0,
      workers: pool.Workers ?? 0,
      shares_accepted: pool.accepted ?? 0,
      shares_rejected: pool.rejected ?? 0,
    };
  }

  async buildMcuState() {
    const { stats } = await this.deps.mcu.getStats();
    const s = stats || {};
    const temp = Number(s.temperature);
    const load = s.loadAverage ? parseFloat(String(s.loadAverage).split(' ')[0]) : NaN;
    return {
      system_temp: Number.isFinite(temp) ? round(temp / 1000, 1) : null,
      load: Number.isFinite(load) ? load : null,
    };
  }

  _build(domain) {
    if (domain === 'node') return this.buildNodeState();
    if (domain === 'solo') return this.buildSoloState();
    if (domain === 'mcu') return this.buildMcuState();
    return this.buildMinerState();
  }

  // ------------------------------------------------------------- publish

  async _publishDomain(domain, cfg) {
    const c = cfg || (await this._outputConfig());
    if (!c.enabled || !client.isConnected() || !c.exports[domain]) return;
    client.publish(this.topics[domain], await this._build(domain), { retain: true });
  }

  // Miner state — the fast one, pushed every scheduler tick.
  async publishState() {
    await this._publishDomain('miner');
  }

  // Node / solo / mcu — pushed on a slower timer.
  async publishExtras() {
    const cfg = await this._outputConfig();
    await Promise.all(['node', 'solo', 'mcu'].map((d) => this._publishDomain(d, cfg)));
  }

  /**
   * Reconcile Home Assistant with the current output config: publish the discovery
   * for each enabled domain (and a first value), clear the discovery for disabled
   * domains, and set availability. Called on every connect and on config change.
   *
   * Runs are serialized: this fires from both the client's onConnect hook (every
   * reconnect) and reconfigure() (every save), and each run holds its config
   * across long awaits (_build does DB + miner/node RPC). Interleaving lets a
   * reconnect run re-publish retained discovery for domains a concurrent save
   * just cleared. Chaining makes the newest run reconcile last — the true final
   * state — instead of racing.
   */
  async syncDiscovery() {
    const next = (this._syncChain || Promise.resolve()).then(() => this._runSyncDiscovery());
    this._syncChain = next.catch(() => {});
    return next;
  }

  async _runSyncDiscovery() {
    if (!client.isConnected()) return;
    const cfg = await this._outputConfig();

    if (!cfg.enabled) {
      for (const d of Object.keys(this.topics)) this._clearDomain(d);
      client.publish(this.availabilityTopic, 'offline', { retain: true, qos: 1 });
      return;
    }

    client.publish(this.availabilityTopic, 'online', { retain: true, qos: 1 });
    for (const domain of Object.keys(this.topics)) {
      if (cfg.exports[domain]) {
        for (const e of this._entities(domain, { control: cfg.control })) {
          client.publish(e.topic, e.payload, { retain: true, qos: 1 });
        }
        // Miner control entities: clear a stale switch/select when control is off.
        if (domain === 'miner' && !cfg.control) {
          const withControl = this._entities('miner', { control: true });
          const readOnly = this._entities('miner', { control: false });
          withControl
            .filter((e) => !readOnly.some((k) => k.topic === e.topic))
            .forEach((e) => client.publish(e.topic, '', { retain: true }));
        }
        await this._publishDomain(domain, cfg);
      } else {
        this._clearDomain(domain);
      }
    }
  }

  // Remove a domain's HA entities (empty retained payload on each config topic).
  _clearDomain(domain) {
    for (const e of this._entities(domain, { control: true })) {
      client.publish(e.topic, '', { retain: true });
    }
  }

  // A command from Home Assistant. Runs as a user action so it pauses the
  // automation, then re-publishes the state so HA reflects the result at once.
  async handleCommand(topic, payload) {
    const { enabled, control } = await this._outputConfig();
    if (!enabled || !control || !this.hasMiner) return;

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
