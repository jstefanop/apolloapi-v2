const { join } = require('path')
const { exec } = require('child_process')
const normalize = require('normalize-object')
const Client =require('../../../app/minerClient');

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getMinerStats()
    return { stats }    
  }, {
    auth: true
  })
}

function getMinerStats () {
  const client = new Client();
  return new Promise((resolve, reject) => {
 
   client.socket.write('{"command":"summary+devs+pools"}');
 
   client.socket.on('data', (data) => {
    let received = data.toString('utf8').trim();
    try {
      received = received
        .replace(/\-nan/g, '0')
        .replace(/[^\x00-\x7F]/g, '')
        .replace('}{', '},{')
        .replace(String.fromCharCode(0), '')
        .replace(/[^\}]+$/, '')
      received = JSON.parse(received);
      const summary = (received.summary && received.summary[0]) ? received.summary[0] : null;
      const devs = (received.devs && received.devs[0]) ? received.devs[0] : null;
      const pools = (received.pools && received.pools[0]) ? received.pools[0] : null;
      
      let results = {
        summary: {
          status: (summary.STATUS && summary.STATUS[0]) ? summary.STATUS[0] : null,
          data: (summary.SUMMARY && summary.SUMMARY[0]) ? summary.SUMMARY[0] : null
        },
        devs: {
          status: (devs.STATUS && devs.STATUS[0]) ? devs.STATUS[0] : null,
          data: (devs.DEVS && devs.DEVS[0]) ? devs.DEVS[0] : null
        },
        pools: {
          status: (pools.STATUS && pools.STATUS[0]) ? pools.STATUS[0] : null,
          data: (pools.POOLS && pools.POOLS[0]) ? pools.POOLS[0] : null
        }
      }

      results = normalize(results, 'camel');

      resolve(results)
    } catch (err) {
      reject(err);
    }

    client.socket.destroy();
   });
 
   client.socket.on('error', (err) => {
    reject(err);
   });
 
  });
}
