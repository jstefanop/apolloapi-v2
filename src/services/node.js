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
      const blockchainInfo = this._formatBlockchainInfo(unrefinedStats[0], unrefinedStats[5]);
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
      // Extract the real error message from RPC response if available
      let errorMessage = error.message;
      let errorCode = error.code || 'UNKNOWN';

      // Check if we have a more specific error from the RPC response
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error.message || errorMessage;
        errorCode = error.response.data.error.code?.toString() || errorCode;
      }

      // Return error information
      const stats = {
        error: {
          code: errorCode,
          message: errorMessage,
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
      timeout: 60000,
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
      // First get blockchain info to get the best block hash
      const blockchainInfo = await this._callRpcMethod(rpcClient, 'getblockchaininfo');
      
      const batch = [
        { jsonrpc: '2.0', id: 1, method: 'getconnectioncount', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'getmininginfo', params: [] },
        { jsonrpc: '2.0', id: 3, method: 'getpeerinfo', params: [] },
        { jsonrpc: '2.0', id: 4, method: 'getnetworkinfo', params: [] },
        { jsonrpc: '2.0', id: 5, method: 'getblock', params: [blockchainInfo.bestblockhash] }
      ];

      const results = await rpcClient.post('', batch);
      
      if (!results.data || !Array.isArray(results.data)) {
        throw new Error('Invalid RPC response format');
      }

      // Check for errors in each response
      const errors = results.data.filter(r => r.error);
      if (errors.length > 0) {
        console.error('RPC Batch Errors:', errors);
        throw new Error(`RPC batch errors: ${errors.map(e => e.error.message).join(', ')}`);
      }

      // Extract results from the batch response with fallback values
      const [connectionCount, miningInfo, peerInfo, networkInfo, block] = results.data.map(r => {
        if (!r.result) {
          console.warn(`Missing result for RPC call ${r.id}`);
          return null;
        }
        return r.result;
      });

      // Validate and provide fallback values for each result
      return [
        blockchainInfo,
        connectionCount ?? 0, // Fallback to 0 if connection count is missing
        miningInfo ?? { difficulty: 0, networkhashps: 0 }, // Fallback mining info
        peerInfo ?? [], // Fallback to empty array if peer info is missing
        networkInfo ?? { version: '0', subversion: 'unknown', localaddresses: [], connections_in: 0, connections_out: 0 }, // Fallback network info
        block ?? { time: Math.floor(Date.now() / 1000) } // Fallback to current time if block info is missing
      ];
    } catch (error) {
      console.error('Error in _getNodeStats:', error.message);
      if (error.response) {
        console.error('RPC Error Response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }
      throw error;
    }
  }

  // Helper method to format blockchain info
  _formatBlockchainInfo(unrefinedBlockchainInfo, block) {
    try {
      return {
        blocks: unrefinedBlockchainInfo.blocks,
        blockTime: block.time,
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
      if (!unrefinedMiningInfo) {
        return { difficulty: 0, networkhashps: 0 };
      }
      return {
        difficulty: unrefinedMiningInfo.difficulty ?? 0,
        networkhashps: unrefinedMiningInfo.networkhashps ?? 0,
      };
    } catch (error) {
      console.error('Error in _formatMiningInfo:', error.message);
      return { difficulty: 0, networkhashps: 0 };
    }
  }

  // Helper method to format peer info
  _formatPeerInfo(unrefinedPeerInfo) {
    try {
      if (!unrefinedPeerInfo || !Array.isArray(unrefinedPeerInfo)) {
        console.log('Invalid peer info:', unrefinedPeerInfo);
        return [];
      }
      return unrefinedPeerInfo.map(peer => ({
        addr: peer?.addr ?? 'unknown',
        subver: peer?.subver ?? 'unknown'
      }));
    } catch (error) {
      console.error('Error in _formatPeerInfo:', error.message);
      return [];
    }
  }

  // Helper method to format network info
  _formatNetworkInfo(unrefinedNetworkInfo) {
    try {
      if (!unrefinedNetworkInfo) {
        return {
          version: '0',
          subversion: 'unknown',
          localaddresses: [],
          connections_in: 0,
          connections_out: 0
        };
      }
      return {
        version: unrefinedNetworkInfo.version ?? '0',
        subversion: unrefinedNetworkInfo.subversion ?? 'unknown',
        localaddresses: unrefinedNetworkInfo.localaddresses ?? [],
        connections_in: unrefinedNetworkInfo.connections_in ?? 0,
        connections_out: unrefinedNetworkInfo.connections_out ?? 0,
      };
    } catch (error) {
      console.error('Error in _formatNetworkInfo:', error.message);
      return {
        version: '0',
        subversion: 'unknown',
        localaddresses: [],
        connections_in: 0,
        connections_out: 0
      };
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

      // Handle case where requested_status is null (e.g., fresh installation)
      // In this case, just check if the node responds without any pending logic
      if (!dbStatus.requestedStatus || dbStatus.requestedStatus === null) {
        try {
          await this._callRpcMethod(rpcClient, 'getblockchaininfo');
          return { status: 'online' };
        } catch (err) {
          console.log('Node not responding and no requested status:', err.message);
          return { status: 'offline' };
        }
      }

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

  // Get recent blocks from Bitcoin node via RPC
  async getRecentBlocksFromNode(count = 15) {
    try {
      const rpcClient = await this._createRpcClient();
      
      // 1. Verify node is synchronized
      const blockchainInfo = await this._callRpcMethod(rpcClient, 'getblockchaininfo');
      
      if (blockchainInfo.initialblockdownload) {
        throw new Error('Node is still in initial block download');
      }
      
      if (blockchainInfo.verificationprogress < 0.99) {
        throw new Error(`Node verification progress: ${(blockchainInfo.verificationprogress * 100).toFixed(2)}%`);
      }
      
      const currentHeight = blockchainInfo.blocks;
      
      // 2. Prepare batch RPC for getblockstats and getblockhash
      const blockHeights = [];
      for (let i = 0; i < count; i++) {
        blockHeights.push(currentHeight - i);
      }
      
      // 3. Batch: getblockstats for statistics
      const statsRequests = blockHeights.map((height, index) => ({
        jsonrpc: '2.0',
        id: `stats_${index + 1}`,
        method: 'getblockstats',
        params: [height]
      }));
      
      // 4. Batch: getblockhash to get block hashes
      const hashRequests = blockHeights.map((height, index) => ({
        jsonrpc: '2.0',
        id: `hash_${index + 1}`,
        method: 'getblockhash',
        params: [height]
      }));
      
      const [statsResults, hashResults] = await Promise.all([
        rpcClient.post('', statsRequests),
        rpcClient.post('', hashRequests)
      ]);
      
      // Check for errors
      const statsErrors = statsResults.data.filter(r => r.error);
      const hashErrors = hashResults.data.filter(r => r.error);
      
      if (statsErrors.length > 0 || hashErrors.length > 0) {
        throw new Error(`RPC errors: ${JSON.stringify([...statsErrors, ...hashErrors])}`);
      }
      
      const blockHashes = hashResults.data.map(r => r.result);
      const blockStats = statsResults.data.map(r => r.result);
      
      // 5. Batch: getblockheader for header information
      const headerRequests = blockHashes.map((hash, index) => ({
        jsonrpc: '2.0',
        id: `header_${index + 1}`,
        method: 'getblockheader',
        params: [hash, true]
      }));
      
      const headerResults = await rpcClient.post('', headerRequests);
      const headerErrors = headerResults.data.filter(r => r.error);
      if (headerErrors.length > 0) {
        throw new Error(`Header RPC errors: ${JSON.stringify(headerErrors)}`);
      }
      
      const blockHeaders = headerResults.data.map(r => r.result);
      
      // 6. Batch: getblock with verbosity=1 to get coinbase txid
      const blockRequests = blockHashes.map((hash, index) => ({
        jsonrpc: '2.0',
        id: `block_${index + 1}`,
        method: 'getblock',
        params: [hash, 1] // verbosity=1: only tx hashes
      }));
      
      const blockResults = await rpcClient.post('', blockRequests);
      const blockErrors = blockResults.data.filter(r => r.error);
      if (blockErrors.length > 0) {
        throw new Error(`Block RPC errors: ${JSON.stringify(blockErrors)}`);
      }
      
      const coinbaseTxids = blockResults.data.map(r => r.result.tx[0]);
      
      // 7. Batch: getrawtransaction for coinbase (for pool extraction and reward)
      const coinbaseRequests = blockHashes.map((hash, index) => ({
        jsonrpc: '2.0',
        id: `coinbase_${index + 1}`,
        method: 'getrawtransaction',
        params: [coinbaseTxids[index], true, hash]
      }));
      
      const coinbaseResults = await rpcClient.post('', coinbaseRequests);
      const coinbaseErrors = coinbaseResults.data.filter(r => r.error);
      if (coinbaseErrors.length > 0) {
        throw new Error(`Coinbase RPC errors: ${JSON.stringify(coinbaseErrors)}`);
      }
      
      const coinbaseTxs = coinbaseResults.data.map(r => r.result);
      
      // 8. Format blocks
      const formattedBlocks = blockHeights.map((height, index) => {
        const stats = blockStats[index];
        const header = blockHeaders[index];
        const coinbase = coinbaseTxs[index];
        
        // Extract pool info from coinbase
        const poolInfo = this._extractPoolFromCoinbase(
          coinbase.vin[0].coinbase
        );
        
        return this._formatBlockForUI(stats, header, coinbase, height, poolInfo);
      });
      
      return formattedBlocks;
    } catch (error) {
      console.error('Error getting recent blocks from node:', error);
      throw error;
    }
  }

  // Format a block for UI (compatible with mempool.space format)
  _formatBlockForUI(stats, header, coinbase, height, poolInfo) {
    // Calculate total reward (subsidy + fees)
    const reward = (stats.subsidy + stats.totalfee) / 100000000; // Convert from satoshi to BTC
    
    // Extract coinbase address
    const coinbaseAddress = coinbase.vout && coinbase.vout.length > 0
      ? (coinbase.vout[0].scriptPubKey?.address || null)
      : null;
    
    // Convert bits from hex string to integer (if it's a string)
    const bits = typeof header.bits === 'string' 
      ? parseInt(header.bits, 16) 
      : header.bits;
    
    return {
      id: header.hash,
      height: height,
      version: header.version,
      timestamp: header.time,
      bits: bits,
      nonce: header.nonce,
      difficulty: header.difficulty,
      merkle_root: header.merkleroot,
      tx_count: stats.txs,
      size: stats.total_size,
      weight: stats.total_weight,
      previousblockhash: header.previousblockhash,
      mediantime: stats.mediantime,
      stale: false,
      extras: {
        reward: reward,
        coinbaseRaw: coinbase.hex,
        totalFees: stats.totalfee / 100000000, // BTC
        avgFee: stats.avgfee,
        avgFeeRate: stats.avgfeerate,
        avgTxSize: stats.avgtxsize,
        totalInputs: stats.ins,
        totalOutputs: stats.outs,
        totalOutputAmt: stats.total_out / 100000000, // BTC
        segwitTotalTxs: stats.swtxs,
        segwitTotalSize: stats.swtotal_size,
        segwitTotalWeight: stats.swtotal_weight,
        virtualSize: stats.total_weight / 4,
        coinbaseAddress: coinbaseAddress,
        pool: poolInfo
      }
    };
  }

  // Extract pool information from coinbase signature
  _extractPoolFromCoinbase(coinbaseHex) {
    try {
      const coinbaseBytes = Buffer.from(coinbaseHex, 'hex');
      const asciiText = coinbaseBytes.toString('ascii');
      
      // Common patterns for pool names
      const poolPatterns = [
        { pattern: /Foundry\s+USA\s+Pool/i, name: 'Foundry USA', slug: 'foundryusa', id: 111 },
        { pattern: /F2Pool/i, name: 'F2Pool', slug: 'f2pool', id: 36 },
        { pattern: /Antpool/i, name: 'Antpool', slug: 'antpool', id: 37 },
        { pattern: /Binance\s+Pool/i, name: 'Binance Pool', slug: 'binancepool', id: 38 },
        { pattern: /ViaBTC/i, name: 'ViaBTC', slug: 'viabtc', id: 39 },
        { pattern: /Slush\s+Pool/i, name: 'Slush Pool', slug: 'slushpool', id: 40 },
        { pattern: /BTC\.com/i, name: 'BTC.com', slug: 'btccom', id: 41 },
        { pattern: /Poolin/i, name: 'Poolin', slug: 'poolin', id: 42 },
        { pattern: /Luxor/i, name: 'Luxor', slug: 'luxor', id: 43 },
        { pattern: /Marathon/i, name: 'Marathon', slug: 'marathon', id: 44 },
        { pattern: /Core\s+Scientific/i, name: 'Core Scientific', slug: 'corescientific', id: 45 },
        { pattern: /Bitfury/i, name: 'Bitfury', slug: 'bitfury', id: 46 },
        { pattern: /Secpool/i, name: 'Secpool', slug: 'secpool', id: 47 },
        { pattern: /Mined\s+by\s+Secpool/i, name: 'Secpool', slug: 'secpool', id: 47 },
      ];
      
      // Search for specific patterns
      for (const pool of poolPatterns) {
        if (pool.pattern.test(asciiText)) {
          return {
            id: pool.id,
            name: pool.name,
            slug: pool.slug
          };
        }
      }
      
      // Search for generic patterns (slash format, "Pool", "Mined by", etc.)
      const poolMatch = asciiText.match(/([A-Za-z0-9\s#-]{4,30}(?:Pool|pool))/);
      if (poolMatch) {
        const poolName = poolMatch[1].trim();
        return {
          id: null,
          name: poolName,
          slug: poolName.toLowerCase().replace(/\s+/g, '')
        };
      }
      
      // Search for "Mined by" pattern
      const minedByMatch = asciiText.match(/Mined\s+by\s+([A-Za-z0-9\s-]{3,30})/i);
      if (minedByMatch) {
        const poolName = `Mined by ${minedByMatch[1].trim()}`;
        return {
          id: null,
          name: poolName,
          slug: poolName.toLowerCase().replace(/\s+/g, '')
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting pool from coinbase:', error);
      return null;
    }
  }

  // Get recent blocks from database
  async getRecentBlocksFromDB(count = 15) {
    try {
      const rows = await this.knex('recent_blocks')
        .select('block_data', 'error', 'updated_at')
        .orderBy('height', 'desc')
        .limit(count);

      if (rows.length === 0) {
        return [];
      }

      // Parse JSON and add error info if present
      const blocks = rows.map(row => {
        const block = JSON.parse(row.block_data);
        
        // Add error info if present
        if (row.error) {
          block.error = row.error;
          block.errorUpdatedAt = row.updated_at;
        }
        
        return block;
      });

      return blocks;
    } catch (error) {
      console.error('Error getting recent blocks from DB:', error);
      throw error;
    }
  }
}

module.exports = (knex, utils) => new NodeService(knex, utils);