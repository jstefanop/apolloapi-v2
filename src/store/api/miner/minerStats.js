const { join } = require('path')
const { exec } = require('child_process')
const fs =require('fs');
const path = require('path')
const _ = require('lodash')

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getMinerStats(errors)
    return { stats }    
  }, {
    auth: true
  })
}

function getMinerStats (errors) {
  return new Promise((resolve, reject) => {
 
   fs.readFile(path.resolve(__dirname, '../../../../backend/apollo-miner/apollo-miner.stat'), (err, data) => {
    let received = data.toString('utf8').trim();
    
    try {
      // JSON from miner is dirty, clean it
      received = received
        .replace(/\-nan/g, '0')
        .replace(/[^\x00-\x7F]/g, '')
        .replace('}{', '},{')
        .replace(String.fromCharCode(0), '')
        .replace(/[^\}]+$/, '')

      received = JSON.parse(received);

      received.master.intervals = _.mapKeys(received.master.intervals, (value, name) => {
        return `int_${name}`
      });

      received.pool.intervals = _.mapKeys(received.pool.intervals, (value, name) => {
        return `int_${name}`
      });

      received.fans = _.mapKeys(received.fans, (value, name) => {
        return `int_${name}`
      });

      received.slots = _.mapKeys(received.slots, (value, name) => {
        return `int_${name}`
      });

      resolve(received)
    } catch (err) {
      reject(new errors.InternalError(err.toString()));
    }

   });
  });
}
