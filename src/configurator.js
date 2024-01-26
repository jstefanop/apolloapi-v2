const fsPromises = require('fs').promises;
const _ = require('lodash');
const os = require('os');
const ip = require('ip');
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


	let minerMode = 0,
		frequency = 40;

	switch (settings.minerMode) {
		case 'eco':
			minerMode = 1
			voltage = 48
			frequency = 30
		break;
		case 'balanced':
			minerMode = 2
			voltage = 60
			frequency = 40
		break;
		case 'turbo':
			minerMode = 3
			voltage = 75
			frequency = 50
		break;
		default:
			minerMode = 0
			voltage = settings.voltage
			frequency = settings.frequency
	}

	const fanLow = (settings.fan_low && settings.fan_low !== 40) ? `-fan_temp_low ${settings.fan_low}` : null;
	const fanHigh = (settings.fan_high && settings.fan_high !== 60) ? `-fan_temp_hi ${settings.fan_high}` : null;

	const poolUrl = mainPool.url.replace(/^.*\/\//, '');

	const [poolHost, poolPort] = poolUrl.split(':');

	let minerConfig = `-host ${poolHost} -port ${poolPort} -user ${mainPool.username} -pswd ${mainPool.password} -brd_ocp ${voltage} -osc ${frequency}`;
	if (fanLow) minerConfig += ` ${fanLow}`;
	if (fanHigh) minerConfig += ` ${fanHigh}`;

	const confDir = `${__dirname}/../backend/apollo-miner`;

	try {
		// Write all configuration file
		// Conf dir
		await fsPromises.mkdir(confDir, { recursive: true });
		// Conf file
		await fsPromises.writeFile(confDir + '/miner_config', minerConfig);
		console.log('Configuration saved');
	} catch (err) {
		console.log('Error saving configuration files');
	}
}

module.exports = generate;