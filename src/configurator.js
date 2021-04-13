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

	let donation = 0;
	pools = _.map(pools, (pool) => {
		if (pool.donation) {
			donation = pool.donation;
			pool.index = pools.length;
		}
		return pool;
	});

	const mainPool = _.minBy(pools, 'index');

	pools = _.chain(pools)
		.map(function (pool) {
			let quota = 0;
			if (donation && pool.donation) quota = pool.donation;
			if (donation && !pool.donation && mainPool.id === pool.id) quota = (100 - donation);

			let newPool = {
				quota: `${quota};${pool.url}`,
				user: pool.username,
				pass: pool.password
			}

			if (pool.proxy && pool.proxy.length) newPool['pool-proxy'] = pool.proxy
			return newPool;
		}).value()


	let minerMode = 0,
		frequency = 40;

	switch (settings.minerMode) {
		case 'eco':
			minerMode = 1
			voltage = 45
			frequency = 35
		break;
		case 'balanced':
			minerMode = 2
			voltage = 60
			frequency = 40
		break;
		case 'turbo':
			minerMode = 3
			voltage = 45
			frequency = 50
		break;
		default:
			minerMode = 0
			voltage = settings.voltage
			frequency = settings.frequency
	}

	const fan = (!settings.fan_low && !settings.fan_high) ? null : `-fan_temp_hi ${settings.fan_low} -fan_temp_low ${settings.fan_high}`;

	const interfaces = os.networkInterfaces();
		
	let apiAllow = 'W:127.0.0.1',
		mainInterface = [];

	if (settings.apiAllow) {
		const mainInterfaceName = (process.env.NODE_ENV === 'production') ? 'eth0' : 'en0';
		if (interfaces['wlan0']) mainInterface = interfaces['wlan0'];
		if (interfaces[mainInterfaceName]) mainInterface = interfaces[mainInterfaceName];

		if (mainInterface[0]) {
			const localNetmask = mainInterface[0].netmask;
			const localIp = mainInterface[0].address;
			const localNetwork = ip.subnet(localIp, localNetmask);
			apiAllow = `W:${localNetwork.networkAddress}/${localNetwork.subnetMaskLength},127.0.0.1`
		}
	}

	let configuration = {
		'pools': pools,
		'api-listen': true,
		'api-allow': apiAllow,
		'api-network': true,
		'api-mcast-port' : '4028',
		'api-port' : '4028',
		'expiry' : '120',
		'expiry-lp' : '3600',
		'failover-switch-delay' : '300',
		'log' : '20',
		'load-balance': true,
		'no-pool-disable' : true,
		'no-client-reconnect' : true,
		'no-show-processors' : true,
		'no-show-procs' : true,
		'queue' : '1',
		'quiet-work-updates' : true,
		'quiet-work-update' : true,
		'scan-time' : '60',
		'skip-security-checks' : '0',
		'submit-stale' : true,
		'scan' : [
			'APL:/dev/ttyS1'
		],
		'set-device' : [
			'APL:clock=' + frequency
		]
	};

	/*
	brd_ocp is voltage
	osc is frequency
	fan_temp_low is fan_low
	fan_temp_hi is fan_high
	*/

	let minerConfig = `-host us-east.stratum.slushpool.com -port 3333 -user jstefanop.worker1 -brd_ocp ${voltage} -osc ${frequency}`;
	if (fan) minerConfig += ` ${fan}`;

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