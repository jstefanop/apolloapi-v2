const fs = require('fs')

module.exports = ({ define }) => {
  define('conf', async (payload, { knex, errors, utils }) => {
    const bitcoinConf = await fs.promises.readFile('/opt/apolloapi/backend/node/bitcoin.conf');

    return { bitcoinConf: bitcoinConf.toString() };
  })
}
