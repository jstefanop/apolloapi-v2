const fsPromises = require('fs').promises;
const _ = require('lodash');
const { knex } = require('./db')

const generate = async function (pools = null, settings = null ) {
  	if (!settings) {
	    [ settings ] = await knex('settings').select([
			'miner_mode as minerMode',
			'voltage',
			'frequency',
			'fan_low',
			'fan_high',
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

	const mainPool = _.minBy(pools, 'index');

	// If no pool configured, skip miner configuration
	if (!mainPool || !mainPool.url) {
		console.log('No pool configured, skipping miner configuration');
		return;
	}

	// Get miner mode
	let minerMode = settings.minerMode;

	// Get fan settings
	const fanLow = (settings.fan_low && settings.fan_low !== 40) ? `-fan_temp_low ${settings.fan_low}` : null;
	const fanHigh = (settings.fan_high && settings.fan_high !== 60) ? `-fan_temp_hi ${settings.fan_high}` : null;

	// Get pool url
	const poolUrl = mainPool.url.replace(/^.*\/\//, '');

	const [poolHost, poolPort] = poolUrl.split(':');

	// Parse miner configuration
	let minerConfig = `-host ${poolHost} -port ${poolPort} -user ${mainPool.username} -pswd ${mainPool.password}`;

	// Add custom configuration if needed
	if (settings.minerMode === 'custom') {
		minerConfig += ` -brd_ocp ${settings.voltage} -osc ${settings.frequency}`;
		minerMode = 'config';
	}
	
	// Add fan configuration if needed
	if (fanLow) minerConfig += ` ${fanLow}`;
	if (fanHigh) minerConfig += ` ${fanHigh}`;

	if (settings.powerLedOff) minerConfig += ` -pwrled off`;

	const confDir = `${__dirname}/../backend/apollo-miner`;

	try {
		// Write all configuration file
		// Conf dir
		await fsPromises.mkdir(confDir, { recursive: true });
		// Conf files
		await fsPromises.writeFile(confDir + '/miner_config', minerConfig);
		await fsPromises.writeFile(confDir + '/mode', minerMode);
		console.log('Configuration saved');
	} catch (err) {
		console.log('Error saving configuration files');
	}
}

module.exports = generate;