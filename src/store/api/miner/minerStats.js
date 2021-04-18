const { join } = require('path')
const { exec } = require('child_process')
const fs = require('fs').promises
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

async function getMinerStats (errors) {
  return new Promise((resolve, reject) => {
    (async () => {      
      try {
        const statsDir = path.resolve(__dirname, '../../../../backend/apollo-miner/');
        const statsFilePattern = 'apollo-miner.*';
        let statsFiles = await fs.readdir(statsDir);
        statsFiles = _.filter(statsFiles, (f) => { return f.match(statsFilePattern) })

        let stats = [];

        await Promise.all(statsFiles.map(async (file) => {
          const data = await fs.readFile(`${statsDir}/${file}`);
          let received = data.toString('utf8').trim();
          // JSON from miner is dirty, clean it
          received = received
            .replace(/\-nan/g, '0')
            .replace(/[^\x00-\x7F]/g, '')
            .replace('}{', '},{')
            .replace(String.fromCharCode(0), '')
            .replace(/[^\}]+$/, '')

          received = JSON.parse(received);

          received.uuid = file.replace('apollo-miner.', '');

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

          stats.push(received);
        }));

        resolve(stats)
      } catch (err) {
        reject(new errors.InternalError(err.toString()));
      }
    })()
  });
}
