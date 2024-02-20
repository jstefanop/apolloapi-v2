const { promisify } = require('util');
const bitcoin = require('bitcoin');

module.exports = ({ define }) => {
  define(
    'stats',
    async (payload, { knex, errors, utils }) => {
      try {
        const settings = await knex('settings')
          .select(['node_rpc_password as nodeRpcPassword'])
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(1);

        const bitcoinClient = createBitcoinClient(settings[0]);

        const unrefinedStats = await getNodeStats(bitcoinClient);

        const blockchainInfo = await formatBlockchainInfo(
          bitcoinClient,
          unrefinedStats[0]
        );
        const miningInfo = formatMiningInfo(unrefinedStats[2]);
        const peerInfo = formatPeerInfo(unrefinedStats[3]);
        const networkInfo = formatNetworkInfo(unrefinedStats[4]);

        const stats = {
          blockchainInfo,
          connectionCount: unrefinedStats[1],
          miningInfo,
          peerInfo,
          networkInfo,
          error: null,
          timestamp: new Date().toISOString(),
        };

        return { stats };
      } catch (error) {
        const stats = {
          error: {
            code: error.code,
            message: error.errno || error.message,
          },
          timestamp: new Date().toISOString(),
        };

        return { stats };
      }
    },
    {
      auth: true,
    }
  );
};

const createBitcoinClient = (settings) => {
  try {
    const bitcoinClient = new bitcoin.Client({
      host: process.env.BITCOIN_NODE_HOST || '127.0.0.1',
      port: process.env.BITCOIN_NODE_PORT || 8332,
      user: process.env.BITCOIN_NODE_USER || 'futurebit',
      pass: process.env.BITCOIN_NODE_PASS || settings.nodeRpcPassword,
      timeout: 30000,
    });

    return bitcoinClient;
  } catch (error) {
    throw error;
  }
};

const formatBlockchainInfo = async (bitcoinClient, unrefinedBlockchainInfo) => {
  try {
    const bestBlockHash = unrefinedBlockchainInfo.bestblockhash;
    const block = await getBitcoinBlock(bitcoinClient, bestBlockHash);

    unrefinedBlockchainInfo.blockTime = block.time;

    return {
      blocks: unrefinedBlockchainInfo.blocks,
      blockTime: unrefinedBlockchainInfo.blockTime,
      headers: unrefinedBlockchainInfo.headers,
      sizeOnDisk: unrefinedBlockchainInfo.size_on_disk.toString(),
    };
  } catch (error) {
    throw error;
  }
};

const getBitcoinBlock = (bitcoinClient, blockHash) => {
  return new Promise((resolve, reject) => {
    bitcoinClient.getBlock(blockHash, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

const formatMiningInfo = (unrefinedMiningInfo) => {
  try {
    return {
      difficulty: unrefinedMiningInfo.difficulty,
      networkhashps: unrefinedMiningInfo.networkhashps,
    };
  } catch (error) {
    throw error;
  }
};

const formatPeerInfo = (unrefinedPeerInfo) => {
  try {
    return unrefinedPeerInfo.map(({ addr, subver }) => ({ addr, subver }));
  } catch (error) {
    throw error;
  }
};

const formatNetworkInfo = (unrefinedNetworkInfo) => {
  try {
    return {
      version: unrefinedNetworkInfo.version,
      subversion: unrefinedNetworkInfo.subversion,
      localaddresses: unrefinedNetworkInfo.localaddresses,
    };
  } catch (error) {
    throw error;
  }
};

const getNodeStats = async (bitcoinClient) => {
  try {
    const getBlockchainInfoPromise = promisify(
      bitcoinClient.getBlockchainInfo
    ).bind(bitcoinClient);
    const getConnectionCountPromise = promisify(
      bitcoinClient.getConnectionCount
    ).bind(bitcoinClient);
    const getMiningInfoPromise = promisify(bitcoinClient.getMiningInfo).bind(
      bitcoinClient
    );
    const getPeerInfoPromise = promisify(bitcoinClient.getPeerInfo).bind(
      bitcoinClient
    );
    const getNetworkInfoPromise = promisify(bitcoinClient.getNetworkInfo).bind(
      bitcoinClient
    );

    return Promise.all([
      await getBlockchainInfoPromise(),
      await getConnectionCountPromise(),
      await getMiningInfoPromise(),
      await getPeerInfoPromise(),
      await getNetworkInfoPromise(),
    ]);
  } catch (error) {
    throw error;
  }
};
