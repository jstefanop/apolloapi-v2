const fs = require('fs');
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
			'fan',
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
		
	let localNetmask = '255.255.255.0',
		localIp = '127.0.0.1',
		mainInterface = [];

	if (interfaces['wlan0']) mainInterface = interfaces['wlan0'];
	if (interfaces['en0']) mainInterface = interfaces['en0'];

	if (mainInterface[0]) {
		localNetmask = mainInterface[0].netmask;
		localIp = mainInterface[0].address;
	}

	const localNetwork = ip.subnet(localIp, localNetmask);

	let configuration = {
		'pools': pools,
		'api-listen': true,
		'api-allow': `W:${localNetwork.networkAddress}/${localNetwork.subnetMaskLength}`,
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


	const confDir = (process.env.NODE_ENV === 'production') ? '/var/local/apollo/hwmon' : '/tmp/hwmon';

	const voltageStep = parseInt((settings.voltage - 644) / 4.15);

	// Write all configuration files
	// Bfgminer
	fs.writeFile('/opt/bfgminer.conf', JSON.stringify(configuration, null, 4), (err) => {  
		// Conf dir
		fs.mkdir(confDir, { recursive: true }, (err) => {
			// Mode
			fs.writeFile(confDir + '/hwmon_state', minerMode, (err) => {  
				// Fan
				fs.writeFile(confDir + '/fan_speed', settings.fan, (err) => {  
					// Voltage
					if (settings.minerMode === 'custom') {
						fs.writeFile(confDir + '/reg_voltage', parseInt(voltageStep), (err) => {  
							console.log('Configuration saved');
						});
					}
				});
			});
		});
	});
}

module.exports = generate;