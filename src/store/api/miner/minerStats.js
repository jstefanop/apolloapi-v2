const { join } = require('path')
const { exec } = require('child_process')
const normalize = require('normalize-object')
const fs =require('fs');
const path = require('path')

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

      // Normalize object keys to fit GraphQL and be code-friendly
      const results = normalize(received, 'camel');

      resolve(results)
    } catch (err) {
      reject(new errors.InternalError(err.toString()));
    }

   });
  });
}
