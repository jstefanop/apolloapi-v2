const fsPromises = require('fs').promises;
const _ = require('lodash');
const { knex } = require('./db')

// Apollo III accepts a different CLI vocabulary from the USB miners, so the two
// config files are built INDEPENDENTLY rather than one derived from the other.
// Deriving miner_config3 by appending to miner_config leaked every legacy flag
// (-brd_ocp, -osc, -fan_temp_low/-fan_temp_hi) into a binary that rejects them.
// Anything shared lives in buildCommonArgs(); everything else is per-family.

const V3_HASHRATE_MIN = 5;
const V3_HASHRATE_MAX = 20;
const V3_FAN_TEMP_MIN = 40;
const V3_FAN_TEMP_MAX = 80;
const V3_FAN_PWM_MIN = 10;
const V3_FAN_PWM_MAX = 100;

const LEGACY_FAN_LOW_DEFAULT = 40;
const LEGACY_FAN_HIGH_DEFAULT = 60;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// A tuning value counts as set only when it is a usable number. `0` in
// particular reads like "no fixed speed" to anyone calling the API, but it used
// to select the fixed-PWM branch and clamp up to 10 — pinning the fans at their
// minimum with the PID loop switched off, which is the opposite of what it looks
// like it asks for.
const isSet = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;

const hasText = (value) =>
  value !== null && value !== undefined && String(value).trim() !== '';

// Super ECO is spelled three ways: `super_eco` in the GraphQL enum and the DB
// (a hyphen is not a legal enum name), `supereco` on the Apollo III command line,
// and `super-eco` in older UI builds. Normalise on the way in so the rest of this
// file only deals with one of them.
const isSuperEco = (mode) => mode === 'super_eco' || mode === 'super-eco';

const splitPoolUrl = (url) => {
  const [host, port] = url.replace(/^.*\/\//, '').split(':');
  return { host, port };
};

/**
 * The primary pool and the power LED are spelled the same way by both binaries.
 * The backup pool is NOT shared: only Apollo III takes -host2 and friends.
 */
function buildCommonArgs(mainPool, settings) {
  const { host, port } = splitPoolUrl(mainPool.url);
  let args = `-host ${host} -port ${port} -user ${mainPool.username}`;

  if (hasText(mainPool.password)) args += ` -pswd ${mainPool.password}`;

  if (settings.powerLedOff) args += ' -pwrled off';

  return args;
}

/**
 * Apollo I/II (USB). Unchanged behaviour: custom mode drives board voltage and
 * oscillator directly, and the mode itself is reported as `config`. Super ECO is
 * an Apollo III power mode, so these boards get plain eco.
 */
function buildLegacyConfig(common, settings) {
  let args = common;
  let mode = settings.minerMode;

  if (mode === 'custom') {
    args += ` -brd_ocp ${settings.voltage} -osc ${settings.frequency}`;
    mode = 'config';
  } else if (isSuperEco(mode)) {
    mode = 'eco';
  }

  if (settings.fan_low && settings.fan_low !== LEGACY_FAN_LOW_DEFAULT) {
    args += ` -fan_temp_low ${settings.fan_low}`;
  }
  if (settings.fan_high && settings.fan_high !== LEGACY_FAN_HIGH_DEFAULT) {
    args += ` -fan_temp_hi ${settings.fan_high}`;
  }

  return `${args} -powermode ${mode}`;
}

/**
 * Apollo III. Custom tuning is a target hashrate — the board tunes its own
 * voltage, so there is no voltage/frequency to expose. Fan control is a single
 * PID target temperature, with a fixed-PWM override that replaces it.
 *
 * `-powermode custom` is emitted ONLY alongside a target hashrate: fan settings
 * are orthogonal to the power mode, so someone can run eco and still tune the
 * fan — which matters, because the III is far more sensitive to fan settings.
 */
function buildApollo3Config(common, settings, backupPool) {
  let args = common;

  // Failover is an Apollo III capability — the USB binaries have no second-pool
  // flags, so passing these to them would be a command line they reject.
  if (backupPool && backupPool.url) {
    const backup = splitPoolUrl(backupPool.url);
    if (backup.host && backup.port) {
      args += ` -host2 ${backup.host} -port2 ${backup.port}` +
        ` -user2 ${backupPool.username}`;
      if (hasText(backupPool.password)) args += ` -pswd2 ${backupPool.password}`;
    }
  }

  const hashrate = settings.minerHashrate;
  const hasHashrate = settings.minerMode === 'custom' && isSet(hashrate);

  if (hasHashrate) {
    args += ` -powermode custom -hashrate ${clamp(Number(hashrate), V3_HASHRATE_MIN, V3_HASHRATE_MAX)}`;
  } else {
    // The binary spells it `supereco`, with no separator.
    const mode = isSuperEco(settings.minerMode) ? 'supereco' : settings.minerMode;
    // `custom` without a hashrate would leave the binary with nothing to act on.
    args += ` -powermode ${mode === 'custom' ? 'eco' : mode}`;
  }

  // A fixed PWM disables automatic control, so the two are mutually exclusive.
  if (isSet(settings.fanPwm)) {
    args += ` -fan_pwm ${clamp(Number(settings.fanPwm), V3_FAN_PWM_MIN, V3_FAN_PWM_MAX)}`;
  } else if (isSet(settings.fanTemp)) {
    args += ` -fan_temp ${clamp(Number(settings.fanTemp), V3_FAN_TEMP_MIN, V3_FAN_TEMP_MAX)}`;
  }

  return args;
}

const generate = async function (pools = null, settings = null ) {
  	if (!settings) {
	    [ settings ] = await knex('settings').select([
			'miner_mode as minerMode',
			'voltage',
			'frequency',
			'fan_low',
			'fan_high',
			'miner_hashrate as minerHashrate',
			'fan_temp as fanTemp',
			'fan_pwm as fanPwm',
			'api_allow as apiAllow',
			'connected_wifi as connectedWifi',
			'left_sidebar_visibility as leftSidebarVisibility',
			'left_sidebar_extended as leftSidebarExtended',
			'right_sidebar_visibility as rightSidebarVisibility',
			'temperature_unit as temperatureUnit',
			'power_led_off as powerLedOff',
		])
		.orderBy('created_at', 'desc')
		.orderBy('id', 'desc')
		.limit(1)
	}

	if (!pools) {
		pools = await knex('pools').select([
			'id',
			'enabled',
			'donation',
			'url',
			'username',
			'password',
			'proxy',
			'index'
		])
		.where('enabled', 1)
		.orderBy('index', 'asc')
	} else {
		pools = _.filter(pools, { enabled: 1 });
	}

	const orderedPools = _.sortBy(pools, 'index');
	const mainPool = orderedPools[0];
	const backupPool = orderedPools[1];

	// If no pool configured, skip miner configuration
	if (!mainPool || !mainPool.url) {
		console.log('No pool configured, skipping miner configuration');
		return;
	}

	const common = buildCommonArgs(mainPool, settings);
	const minerConfig = buildLegacyConfig(common, settings);
	const minerConfig3 = buildApollo3Config(common, settings, backupPool);

	const confDir = `${__dirname}/../backend/apollo-miner`;

	try {
		// Write all configuration file
		// Conf dir
		await fsPromises.mkdir(confDir, { recursive: true });
		// Conf files
		await fsPromises.writeFile(confDir + '/miner_config', minerConfig);
		await fsPromises.writeFile(confDir + '/miner_config3', minerConfig3);
		console.log('Configuration saved');
	} catch (err) {
		console.log('Error saving configuration files');
	}
}

module.exports = generate;
