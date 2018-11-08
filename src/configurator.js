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
			'url',
			'username',
			'password',
			'proxy',
			'index'
		])
		.where('enabled', 1)
		.orderBy('index', 'asc')
	}

	pools = _.chain(pools)
		.filter(function (pool) {
			if (pool.enabled) return pool
		})
		.map(function (pool) {
			let newPool = {
				url: pool.url,
				user: pool.username,
				pass: pool.password,
				'pool-priority': pool.index,
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
			'APL:clock=' + settings.frequency,
			'APL:voltage=' + settings.voltage,
			'APL:mode=' + settings.minerMode,
			'APL:fan=' + settings.fan
		]
	};

	fs.writeFile('/opt/bfgminer.conf', JSON.stringify(configuration, null, 4), (err) => {  
		// console.log(configuration);
		console.log('Configuration saved');
	});
}

module.exports = generate;