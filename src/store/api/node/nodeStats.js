const { join } = require('path')
const { exec } = require('child_process')

const litecoin = require('litecoin');

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const unrefinedStats = await getNodeStats()

    // Strip peerInfo of unnecessary properties
    const unrefinedPeerInfo = unrefinedStats[2]
    const peerInfo = unrefinedPeerInfo.map(({ addr, subver }) => ({
      addr,
      subver
    }));

    // Convert unrefinedStats to object
    const stats = {
      blockCount: unrefinedStats[0],
      connectionCount: unrefinedStats[1],
      peerInfo: peerInfo
    }

    stats.timestamp = new Date().toISOString()

    return { stats }
  }, {
    auth: true
  })
}

const litecoinClient = new litecoin.Client({
  host: '127.0.0.1',
  port: 9332,
  user: 'futurebit',
  pass: 'futurebit',
  timeout: 30000,
  ssl: false
});

function getNodeStats () {
  const getBlockCountPromise = new Promise((resolve, reject) => {
    litecoinClient.getBlockCount((error, blockCount) => {
      if (error) {
        reject(error)
      } else {
        try {
          resolve(blockCount)
        } catch (error) {
          reject(error)
        }
      }
    })
  })

  const getConnectionCountPromise = new Promise((resolve, reject) => {
    litecoinClient.getConnectionCount((error, connectionCount) => {
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

  const getPeerInfoPromise = new Promise((resolve, reject) => {
    litecoinClient.getPeerInfo((error, peerInfo) => {
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
      getBlockCountPromise,
      getConnectionCountPromise,
      getPeerInfoPromise
    ]
  )
}
