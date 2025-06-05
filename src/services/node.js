const fs = require('fs').promises;
const path = require('path');
const { spawn, exec } = require('child_process');
const axios = require('axios');
const config = require('config');
const { GraphQLError } = require('graphql');
const util = require('util');

// Convert exec to use promises
const execPromise = util.promisify(exec);

class NodeService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Start the Bitcoin node
  async start() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'node' })
        .update({
          status: 'pending',
          requested_status: 'online',
          requested_at: new Date()
        });

      // Start the node service
      await this._execCommand('sudo systemctl start node');
    } catch (error) {
      throw new GraphQLError(`Failed to start node: ${error.message}`);
    }
  }

  // Stop the Bitcoin node
  async stop() {
    try {
      // Update service status in the database
      await this.knex('service_status')
        .where({ service_name: 'node' })
        .update({
          status: 'pending',
          requested_status: 'offline',
          requested_at: new Date()
        });

      // Stop the node service
      await this._execCommand('sudo systemctl stop node');
    } catch (error) {
      throw new GraphQLError(`Failed to stop node: ${error.message}`);
    }
  }

  // Get Bitcoin node statistics
  async getStats() {
    try {
      // Create RPC client
      const rpcClient = await this._createRpcClient();

      // Fetch node statistics
      const unrefinedStats = await this._getNodeStats(rpcClient);

      // Format the statistics
      const blockchainInfo = await this._formatBlockchainInfo(rpcClient, unrefinedStats[0]);
      const miningInfo = this._formatMiningInfo(unrefinedStats[2]);
      const peerInfo = this._formatPeerInfo(unrefinedStats[3]);
      const networkInfo = this._formatNetworkInfo(unrefinedStats[4]);

      // Build the full stats object
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
      // Return error information
      const stats = {
        error: {
          code: error.code || 'UNKNOWN',
          message: error.message,
        },
        timestamp: new Date().toISOString(),
      };

      return { stats };
    }
  }

  // Get Bitcoin configuration
  async getConf() {
    try {
      // Read Bitcoin configuration file
      const bitcoinConf = await fs.readFile('/opt/apolloapi/backend/node/bitcoin.conf', 'utf8');
      return { bitcoinConf: bitcoinConf || '' };
    } catch (error) {
      throw new GraphQLError(`Failed to read Bitcoin configuration: ${error.message}`);
    }
  }

  // Get format progress
  async getFormatProgress() {
    try {
      // Check if the progress file exists
      const filePath = '/tmp/format_node_disk_c_done';
      let fileExists = true;

      try {
        await fs.access(filePath, fs.constants.F_OK);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist
          console.log('format_node_disk_c_done file not found. Returning default progress.');
          fileExists = false;
        } else {
          throw error;
        }
      }

      if (!fileExists) {
        return { value: 0 };
      }

      // Read the progress value from the file
      const data = await fs.readFile(filePath);
      const progress = parseInt(data.toString());

      return { value: progress };
    } catch (error) {
      console.log('Error getting format progress:', error);
      return { value: 0 };
    }
  }

  // Format the Bitcoin node disk
  async format() {
    try {
      await this._formatDisk();
    } catch (error) {
      throw new GraphQLError(`Failed to format disk: ${error.message}`);
    }
  }

  // Check if the Bitcoin node is online
  async checkOnline() {
    try {
      // Fetch requested status from database
      const dbStatus = await this.knex('service_status')
        .select(
          'requested_status as requestedStatus',
          'requested_at as requestedAt'
        )
        .where({ service_name: 'node' })
        .first();

      if (!dbStatus) {
        throw new GraphQLError('Node status not found in the database.');
      }

      // Create RPC client
      const rpcClient = await this._createRpcClient();

      // Check if node is online
      const online = await this._isNodeOnline(dbStatus, rpcClient);
      online.timestamp = new Date().toISOString();

      return { online };
    } catch (error) {
      console.error('Error checking node status:', error.message);
      throw new GraphQLError('Failed to check node status.');
    }
  }

  // Helper method to create RPC client
  async _createRpcClient() {
    // Get RPC password from settings
    const settings = await this.knex('settings')
      .select(['node_rpc_password as nodeRpcPassword'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1);

    // Create axios client with authentication
    return axios.create({
      baseURL: `http://${process.env.BITCOIN_NODE_HOST || '127.0.0.1'}:${process.env.BITCOIN_NODE_PORT || 8332}`,
      auth: {
        username: process.env.BITCOIN_NODE_USER || 'futurebit',
        password: process.env.BITCOIN_NODE_PASS || settings[0]?.nodeRpcPassword,
      },
      timeout: 30000,
    });
  }

  // Helper method to call RPC method
  async _callRpcMethod(rpcClient, method, params = []) {
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
  }

  // Helper method to get node statistics
  async _getNodeStats(rpcClient) {
    try {
      const blockchainInfo = await this._callRpcMethod(rpcClient, 'getblockchaininfo');
      const connectionCount = await this._callRpcMethod(rpcClient, 'getconnectioncount');
      const miningInfo = await this._callRpcMethod(rpcClient, 'getmininginfo');
      const peerInfo = await this._callRpcMethod(rpcClient, 'getpeerinfo');
      const networkInfo = await this._callRpcMethod(rpcClient, 'getnetworkinfo');

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
  }

  // Helper method to format blockchain info
  async _formatBlockchainInfo(rpcClient, unrefinedBlockchainInfo) {
    try {
      const bestBlockHash = unrefinedBlockchainInfo.bestblockhash;
      const block = await this._callRpcMethod(rpcClient, 'getblock', [bestBlockHash]);

      unrefinedBlockchainInfo.blockTime = block.time;

      return {
        blocks: unrefinedBlockchainInfo.blocks,
        blockTime: unrefinedBlockchainInfo.blockTime,
        headers: unrefinedBlockchainInfo.headers,
        sizeOnDisk: unrefinedBlockchainInfo.size_on_disk.toString(),
        verificationprogress: unrefinedBlockchainInfo.verificationprogress,
      };
    } catch (error) {
      throw error;
    }
  }

  // Helper method to format mining info
  _formatMiningInfo(unrefinedMiningInfo) {
    try {
      return {
        difficulty: unrefinedMiningInfo.difficulty,
        networkhashps: unrefinedMiningInfo.networkhashps,
      };
    } catch (error) {
      throw error;
    }
  }

  // Helper method to format peer info
  _formatPeerInfo(unrefinedPeerInfo) {
    try {
      return unrefinedPeerInfo.map(({ addr, subver }) => ({ addr, subver }));
    } catch (error) {
      throw error;
    }
  }

  // Helper method to format network info
  _formatNetworkInfo(unrefinedNetworkInfo) {
    try {
      return {
        version: unrefinedNetworkInfo.version,
        subversion: unrefinedNetworkInfo.subversion,
        localaddresses: unrefinedNetworkInfo.localaddresses,
        connections_in: unrefinedNetworkInfo.connections_in,
        connections_out: unrefinedNetworkInfo.connections_out,
      };
    } catch (error) {
      throw error;
    }
  }

  // Helper method to check if node is online
  async _isNodeOnline(dbStatus, rpcClient) {
    try {
      // Define thresholds
      const pendingThresholdMs = 120000; // Pending timeout for "online" request
      const pendingStopTimeoutMs = 10000; // Pending timeout for "offline" request

      // Get current time and requested time
      const currentTime = Date.now();
      const requestedAtTime = dbStatus.requestedAt
        ? new Date(dbStatus.requestedAt).getTime()
        : 0;

      if (dbStatus.requestedStatus === 'online') {
        try {
          // Call RPC method to check if the node responds
          await this._callRpcMethod(rpcClient, 'getblockchaininfo');
          return { status: 'online' };
        } catch (err) {
          console.log('Error checking node status:', err.message);

          // If the node doesn't respond, check the pending threshold
          if (currentTime - requestedAtTime <= pendingThresholdMs) {
            return { status: 'pending' }; // Waiting for the node to start
          } else {
            return { status: 'offline' }; // Timeout reached, mark as offline
          }
        }
      }

      if (dbStatus.requestedStatus === 'offline') {
        try {
          // If node responds but requested to stop, return pending or error
          await this._callRpcMethod(rpcClient, 'getblockchaininfo');

          if (currentTime - requestedAtTime <= pendingStopTimeoutMs) {
            return { status: 'pending' }; // Waiting for the node to stop
          } else {
            return { status: 'offline' }; // Timeout for stopping, mark as offline
          }
        } catch {
          // If the node is unreachable, it is offline
          return { status: 'offline' };
        }
      }

      return { status: 'error' }; // Catch-all fallback for unexpected cases
    } catch (error) {
      console.error('Error checking node status:', error.message);
      return { status: 'error' };
    }
  }

  // Helper method to format disk
  async _formatDisk() {
    return new Promise((resolve, reject) => {
      const scriptName = (process.env.NODE_ENV === 'production')
        ? 'format_node_disk'
        : 'format_node_disk_fake';

      const scriptPath = path.join(
        __dirname,
        '../../backend',
        scriptName
      );

      const cmd = (process.env.NODE_ENV === 'production')
        ? spawn('sudo', ['bash', scriptPath])
        : spawn('bash', [scriptPath]);

      cmd.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });

      cmd.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        reject(data);
      });

      cmd.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        resolve();
      });
    });
  }

  // Helper method to execute shell commands
  async _execCommand(command) {
    try {
      const { stdout, stderr } = await execPromise(command);
      if (stderr) {
        console.error(`Command stderr: ${stderr}`);
      }
      return stdout.trim();
    } catch (error) {
      throw error;
    }
  }
}

module.exports = (knex, utils) => new NodeService(knex, utils);