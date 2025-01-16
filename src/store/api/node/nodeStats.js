const axios = require('axios');

module.exports = ({ define }) => {
  define(
    'stats',
    async (payload, { knex, errors, utils }) => {
      try {
        const rpcClient = await createRpcClient(knex);

        const unrefinedStats = await getNodeStats(rpcClient);

        const blockchainInfo = await formatBlockchainInfo(
          rpcClient,
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
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        };

        return { stats };
      }
    },
    (payload) => ({
      auth: payload.useAuth || true,
    })
  );
};

const createRpcClient = async (knex) => {
  const settings = await knex('settings')
    .select(['node_rpc_password as nodeRpcPassword'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1);

  return axios.create({
    baseURL: `http://${process.env.BITCOIN_NODE_HOST || '127.0.0.1'}:${process.env.BITCOIN_NODE_PORT || 8332
      }`,
    auth: {
      username: process.env.BITCOIN_NODE_USER || 'futurebit',
      password: process.env.BITCOIN_NODE_PASS || settings.nodeRpcPassword,
    },
    timeout: 30000,
  });
};

const callRpcMethod = async (rpcClient, method, params = []) => {
  try {
    const response = await rpcClient.post('/', {
      jsonrpc: '1.0',
      id: 'axios',
      method,
      params,
    });
    return response.data.result;
  } catch (error) {
    throw error;
  }
};

const formatBlockchainInfo = async (rpcClient, unrefinedBlockchainInfo) => {
  try {
    const bestBlockHash = unrefinedBlockchainInfo.bestblockhash;
    const block = await callRpcMethod(rpcClient, 'getblock', [bestBlockHash]);

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

const getNodeStats = async (rpcClient) => {
  try {
    const blockchainInfo = await callRpcMethod(rpcClient, 'getblockchaininfo');
    const connectionCount = await callRpcMethod(rpcClient, 'getconnectioncount');
    const miningInfo = await callRpcMethod(rpcClient, 'getmininginfo');
    const peerInfo = await callRpcMethod(rpcClient, 'getpeerinfo');
    const networkInfo = await callRpcMethod(rpcClient, 'getnetworkinfo');

    return [
      blockchainInfo,
      connectionCount,
      miningInfo,
      peerInfo,
      networkInfo,
    ];
  } catch (error) {
    throw error;
  }
};

module.exports.createRpcClient = createRpcClient;
module.exports.callRpcMethod = callRpcMethod;
