const fs = require('fs').promises;
const path = require('path');

module.exports = ({ define }) => {
  define(
    'online',
    async (payload, { knex, errors, utils }) => {
      try {
        const initialUserStatus = {
          requestedStatus: null,
          requestedAt: null,
        };

        // Fetch requested status and timestamp from the database
        let dbStatus = await knex('service_status')
          .select(
            'requested_status as requestedStatus',
            'requested_at as requestedAt'
          )
          .where({ service_name: 'miner' })
          .first();

        if (!dbStatus) {
          dbStatus = initialUserStatus;
        }

        // Check miner status based on file updates and database status
        const online = await isMinerOnline(dbStatus);
        online.timestamp = new Date().toISOString();

        return { online };
      } catch (error) {
        console.error('Error checking miner status:', error.message);
        throw new errors.InternalError('Failed to check miner status.');
      }
    },
    (payload) => ({
      auth: payload.useAuth || true,
    })
  );
};

async function isMinerOnline(dbStatus) {
  try {
    const statsDir = path.resolve(
      __dirname,
      '../../../../backend/apollo-miner/'
    );
    const statsFilePattern = /^apollo-miner.*$/; // Regex to match stats file names

    // Define thresholds
    const recentThresholdMs = 15000; // File considered recent if updated within 15 seconds
    const pendingThresholdMs = 30000; // Pending timeout for "online" request
    const pendingStopTimeoutMs = 5000; // Pending timeout for "offline" request

    // Get current time and requested time
    const currentTime = Date.now();
    const requestedAtTime = dbStatus.requestedAt
      ? new Date(dbStatus.requestedAt).getTime()
      : 0; // Default to 0 if requestedAt is null

    // List all files in the stats directory
    const files = await fs.readdir(statsDir);
    const statsFiles = files.filter((file) => statsFilePattern.test(file));

    if (statsFiles.length === 0) {
      return { status: 'offline' }; // No files found
    }

    // Find the most recently modified file
    let latestFile = null;
    let latestMtime = 0;

    for (const file of statsFiles) {
      const filePath = path.join(statsDir, file);
      const stats = await fs.stat(filePath);

      if (stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
        latestFile = filePath;
      }
    }

    if (!latestFile) {
      return { status: 'offline' }; // No valid file found
    }

    // Check if the file was updated recently
    const timeSinceLastUpdate = currentTime - latestMtime;

    if (dbStatus.requestedStatus === 'online') {
      if (timeSinceLastUpdate <= recentThresholdMs) {
        return { status: 'online' };
      } else if (currentTime - requestedAtTime <= pendingThresholdMs) {
        return { status: 'pending' }; // Waiting for the service to come online
      } else {
        return { status: 'offline' }; // Timeout reached, mark as offline
      }
    }

    if (dbStatus.requestedStatus === 'offline') {
      if (timeSinceLastUpdate > recentThresholdMs) {
        return { status: 'offline' }; // File is no longer updating, service is offline
      } else if (currentTime - requestedAtTime <= pendingStopTimeoutMs) {
        return { status: 'pending' }; // Waiting for the service to stop
      } else {
        return { status: 'offline' }; // Timeout for stopping, mark as offline
      }
    }

    return { status: 'error' }; // Catch-all fallback for unexpected cases
  } catch (error) {
    console.error('Error checking miner status:', error.message);
    return { status: 'error' }; // Handle unexpected errors
  }
}
