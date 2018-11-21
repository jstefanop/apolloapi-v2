const fs = require('fs');
const _ = require('lodash');
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

	let configuration = {
		'pools': pools,
		'api-listen': true,
		'api-allow': 'W:127.0.0.1',
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
			'ALL'
		],
		'set-device' : [
			'APL:clock=' + settings.frequency
		]
	};


	const confDir = (process.env.NODE_ENV === 'production') ? '/var/local/apollo/hwmon' : '/tmp/hwmon';
	let minerMode = 0;

	switch (settings.minerMode) {
		case 'eco':
			minerMode = 1
		break;
		case 'balanced':
			minerMode = 2
		break;
		case 'turbo':
			minerMode = 3
		break;
		default:
			minerMode = 0
	}

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
					fs.writeFile(confDir + '/reg_voltage', parseInt(voltageStep), (err) => {  
						console.log('Configuration saved');
					});
				});
			});
		});
	});
}

module.exports = generate;