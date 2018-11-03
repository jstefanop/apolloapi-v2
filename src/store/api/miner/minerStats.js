const { join } = require('path')
const { exec } = require('child_process')
const normalize = require('normalize-object')
const Client =require('../../../app/minerClient');

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getMinerStats(errors)
    return { stats }    
  }, {
    auth: true
  })
}

function getMinerStats (errors) {
  const client = new Client();
  return new Promise((resolve, reject) => {
 
   client.socket.write('{"command":"summary+devs+pools"}');
 
   client.socket.on('data', (data) => {
    let received = data.toString('utf8').trim();
    try {
      // JSON from bfgminer is dirty, clean it
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
      
      // Always converts pools in an array
      let poolsArray = pools.POOLS || [];
      if (poolsArray && !Array.isArray(poolsArray)) poolsArray = [poolsArray];

      let results = {
        summary: {
          status: (summary.STATUS && summary.STATUS[0]) ? summary.STATUS[0] : null,
          data: (summary.SUMMARY && summary.SUMMARY[0]) ? summary.SUMMARY[0] : null
        },
        devs: {
          status: (devs.STATUS && devs.STATUS[0]) ? devs.STATUS[0] : null,
          data: devs.DEVS || null
        },
        pools: {
          status: (pools.STATUS && pools.STATUS[0]) ? pools.STATUS[0] : null,
          data: poolsArray
        }
      }

      // Normalize object keys to fit GraphQL and be code-friendly
      results = normalize(results, 'camel');

      resolve(results)
    } catch (err) {
      reject(new errors.InternalError(err.toString()));
    }

    client.socket.destroy();
   });
 
   client.socket.on('error', (err) => {
    reject(
      new errors.InternalError(err.toString()).addReason({
        path: 'stats',
        message: err.code
      })
    );
   });
 
  });
}
