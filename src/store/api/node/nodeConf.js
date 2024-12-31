import fs from 'fs/promises';

export default ({ define }) => {
  define('conf', async (payload, { knex, errors, utils }) => {
    const bitcoinConf = await fs.readFile('/opt/apolloapi/backend/node/bitcoin.conf');

    return { bitcoinConf: bitcoinConf ? bitcoinConf.toString() : '' };
  });
};
