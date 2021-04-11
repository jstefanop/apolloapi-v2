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
		frequency = 793;

	switch (settings.minerMode) {
		case 'eco':
			minerMode = 1
			frequency = 598
		break;
		case 'balanced':
			minerMode = 2
			frequency = 715
		break;
		case 'turbo':
			minerMode = 3
			frequency = 793
		break;
		default:
			minerMode = 0
			frequency = 793
	}

	if (settings.minerMode === 'custom') frequency = settings.frequency;

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


	const confDir = '../backend/apollo-miner';

	// -host us-east.stratum.slushpool.com -port 3333 -user jstefanop.worker1 -brd_ocp 75 -osc 50 -fan_temp_hi 80 -fan_temp_low 65

	const voltageStep = parseInt((settings.voltage - 644) / 4.15);

	try {
		// Write all configuration files
		// Bfgminer
		await fsPromises.writeFile('/opt/bfgminer.conf', JSON.stringify(configuration, null, 4));
		// Conf dir
		await fsPromises.mkdir(confDir, { recursive: true });
		// Mode
		await fsPromises.writeFile(confDir + '/hwmon_state', parseInt(minerMode).toFixed());
		// Fan
		await fsPromises.writeFile(confDir + '/fan_speed', parseInt(settings.fan).toFixed());
		// Voltage
		if (settings.minerMode === 'custom') {
			await fsPromises.writeFile(confDir + '/reg_voltage', parseInt(voltageStep).toFixed());
		}
		console.log('Configuration saved');
	} catch (err) {
		console.log('Error saving configuration files');
	}
}

module.exports = generate;