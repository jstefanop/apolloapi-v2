 const { join } = require('path')
const { exec } = require('child_process')

const bitcoin = require('litecoin');

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    try {
      const [ settings ] = await knex('settings').select(['node_rpc_password as nodeRpcPassword'])
      const bitcoinClient = new bitcoin.Client({
        host: process.env.BITCOIN_NODE_HOST || '127.0.0.1',
        port: 8332,
        user: 'futurebit',
        pass: settings.nodeRpcPassword,
        timeout: 30000,
        ssl: false
      });

      const unrefinedStats = await getNodeStats(bitcoinClient);

      // At this point, no error present

      const unrefinedBlockchainInfo = unrefinedStats[0];

      // Convert sizeOnDisk to String because number too large
      const blockchainInfo = {
        blocks: unrefinedBlockchainInfo.blocks,
        blockTime: unrefinedBlockchainInfo.blockTime,
        headers: unrefinedBlockchainInfo.headers,
        sizeOnDisk: unrefinedBlockchainInfo.size_on_disk.toString()
      };

      // Strip miningInfo of unnecessary properties
      const unrefinedMiningInfo = unrefinedStats[2];
      const miningInfo = {
        difficulty: unrefinedMiningInfo.difficulty,
        networkhashps: unrefinedMiningInfo.networkhashps
      };

      // Strip peerInfo of unnecessary properties
      const unrefinedPeerInfo = unrefinedStats[3];
      const peerInfo = unrefinedPeerInfo.map(({ addr, subver }) => ({
        addr,
        subver
      }));

      // Strip networkInfo of unnecessary properties
      const unrefinedNetworkInfo = unrefinedStats[4];
      const networkInfo = {
        version: unrefinedNetworkInfo.version,
        subversion: unrefinedNetworkInfo.subversion,
        localaddresses: unrefinedNetworkInfo.localaddresses,
      };

      // Convert unrefinedStats to object
      const stats = {
        blockchainInfo: blockchainInfo,
        connectionCount: unrefinedStats[1],
        miningInfo: miningInfo,
        peerInfo: peerInfo,
        networkInfo: networkInfo,
        error: null
      };

      stats.timestamp = new Date().toISOString();

      return { stats }
    } catch (error) {
      // Use errno for API not available, and use description for API loading
      const stats = {
        error: {
          code: error.code,
          message: error.errno || error.message
        },
        timestamp: new Date().toISOString()
      };

      return { stats };
    }
  }, {
    auth: true
  })
}

function getNodeStats (bitcoinClient) {
  const getBlockchainInfoPromise = new Promise((resolve, reject) => {
    bitcoinClient.getBlockchainInfo((error, blockchainInfo) => {
      if (error) {
        reject(error)
      } else {
        try {
          // Use bestblockhash to call bestBlock, to retrieve time of last block calculation
          const bestBlockHash = blockchainInfo.bestblockhash
          bitcoinClient.getBlock(bestBlockHash, (error, block) => {
            if (error) {
              reject(error)
            } else {
              // Add blockTime to blockchainInfo
              blockchainInfo.blockTime = block.time;
              resolve(blockchainInfo)
            }
          })
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  const getNetworkInfoPromise = new Promise((resolve, reject) => {
    bitcoinClient.cmd('getnetworkinfo', (error, networkInfo) => {
      if (error) {
        reject(error)
      } else {
        try {
          resolve(networkInfo)
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  const getConnectionCountPromise = new Promise((resolve, reject) => {
    bitcoinClient.getConnectionCount((error, connectionCount) => {
      if (error) {
        reject(error)
      } else {
        try {
          resolve(connectionCount)
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  const getMiningInfoPromise = new Promise((resolve, reject) => {
    bitcoinClient.getMiningInfo((error, miningInfo) => {
      if (error) {
        reject(error)
      } else {
        try {
          resolve(miningInfo)
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  const getPeerInfoPromise = new Promise((resolve, reject) => {
    bitcoinClient.getPeerInfo((error, peerInfo) => {
      if (error) {
        reject(error)
      } else {
        try {
          resolve(peerInfo)
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  return Promise.all(
    [
      getBlockchainInfoPromise,
      getConnectionCountPromise,
      getMiningInfoPromise,
      getPeerInfoPromise,
      getNetworkInfoPromise
    ]
  )
}

