const { createRpcClient, callRpcMethod } = require('./nodeStats');

module.exports = ({ define }) => {
  define(
    'online',
    async (payload, { knex, errors, utils }) => {
      try {
        // Fetch requested status and timestamp from the database
        const dbStatus = await knex('service_status')
          .select(
            'requested_status as requestedStatus',
            'requested_at as requestedAt'
          )
          .where({ service_name: 'node' })
          .first();

        if (!dbStatus) {
          throw new errors.NotFound('Node status not found in the database.');
        }

        const rpcClient = await createRpcClient(knex);

        // Check node status
        const online = await isNodeOnline(dbStatus, rpcClient);
        online.timestamp = new Date().toISOString();

        return { online };
      } catch (error) {
        console.error('Error checking node status:', error.message);
        throw new errors.InternalError('Failed to check node status.');
      }
    },
    (payload) => ({
      auth: payload.useAuth || true,
    })
  );
};

async function isNodeOnline(dbStatus, rpcClient) {
  try {
    // Define thresholds
    const pendingThresholdMs = 30000; // Pending timeout for "online" request
    const pendingStopTimeoutMs = 5000; // Pending timeout for "offline" request

    // Get current time and requested time
    const currentTime = Date.now();
    const requestedAtTime = new Date(dbStatus.requestedAt).getTime();

    if (dbStatus.requestedStatus === 'online') {
      try {
        // Call RPC method to check if the node responds
        await callRpcMethod(rpcClient, 'getblockchaininfo');
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
        await callRpcMethod(rpcClient, 'getblockchaininfo');
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
    return { status: 'error' }; // Handle unexpected errors
  }
};
