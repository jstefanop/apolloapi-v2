const fs = require('fs');
const path = require('path');

let devSoloInterval = null;
const ckpoolDir = path.resolve(__dirname, '../backend/ckpool/logs');
let isRunning = false;

// Generate random pool statistics
const generatePoolStats = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    runtime: Math.floor(Math.random() * 10000),
    lastupdate: now,
    Users: Math.floor(Math.random() * 10) + 1,
    Workers: Math.floor(Math.random() * 20) + 1,
    Idle: Math.floor(Math.random() * 5),
    Disconnected: Math.floor(Math.random() * 3)
  };
};

// Generate random hashrate statistics
const generateHashrateStats = () => {
  return {
    hashrate1m: `${(Math.random() * 4 + 14).toFixed(2)}T`,
    hashrate5m: `${(Math.random() * 4 + 14).toFixed(2)}T`,
    hashrate15m: `${(Math.random() * 4 + 14).toFixed(2)}T`,
    hashrate1hr: `${(Math.random() * 4 + 14).toFixed(2)}T`,
    hashrate6hr: `${(Math.random() * 4 + 14).toFixed(2)}T`,
    hashrate1d: `${(Math.random() * 500 + 100).toFixed(0)}G`,
    hashrate7d: `${(Math.random() * 500 + 100).toFixed(0)}G`
  };
};

// Generate random share statistics
const generateShareStats = () => {
  return {
    diff: (Math.random() * 1000).toFixed(2),
    accepted: Math.floor(Math.random() * 10000000),
    rejected: Math.floor(Math.random() * 10000),
    bestshare: Math.floor(Math.random() * 10000000),
    SPS1m: (Math.random() * 1).toFixed(3),
    SPS5m: (Math.random() * 1).toFixed(3),
    SPS15m: (Math.random() * 1).toFixed(3),
    SPS1h: (Math.random() * 1).toFixed(3)
  };
};

// Generate random user data
const generateUserData = (wallet) => {
  const now = Math.floor(Date.now() / 1000);
  const hashrate1m = `${(Math.random() * 4 + 14).toFixed(2)}T`;
  const hashrate5m = `${(Math.random() * 4 + 14).toFixed(2)}T`;
  const hashrate1hr = `${(Math.random() * 4 + 14).toFixed(2)}T`;
  const hashrate1d = `${(Math.random() * 500 + 100).toFixed(0)}G`;
  const hashrate7d = `${(Math.random() * 500 + 100).toFixed(0)}G`;
  const bestshare = Math.random() * 10000000;
  const lastshare = now - (60 + Math.floor(Math.random() * 240));

  return {
    hashrate1m,
    hashrate5m,
    hashrate1hr,
    hashrate1d,
    hashrate7d,
    lastshare,
    workers: Math.floor(Math.random() * 5) + 1,
    shares: Math.floor(Math.random() * 10000000),
    bestshare,
    bestever: Math.floor(bestshare),
    authorised: now - Math.floor(Math.random() * 1000000),
    worker: [
      {
        workername: `${wallet}.worker1`,
        hashrate1m,
        hashrate5m,
        hashrate1hr,
        hashrate1d,
        hashrate7d,
        lastshare,
        shares: Math.floor(Math.random() * 10000000),
        bestshare,
        bestever: Math.floor(bestshare)
      },
      {
        workername: `${wallet}.worker2`,
        hashrate1m,
        hashrate5m,
        hashrate1hr,
        hashrate1d,
        hashrate7d,
        lastshare,
        shares: Math.floor(Math.random() * 10000000),
        bestshare,
        bestever: Math.floor(bestshare)
      }
    ]
  };
};

// Update CKPool log files
const updateCkpoolLogs = () => {
  try {
    // Create directories if they don't exist
    const poolDir = path.join(ckpoolDir, 'pool');
    const usersDir = path.join(ckpoolDir, 'users');
    
    if (!fs.existsSync(poolDir)) {
      fs.mkdirSync(poolDir, { recursive: true });
    }
    if (!fs.existsSync(usersDir)) {
      fs.mkdirSync(usersDir, { recursive: true });
    }

    // Update pool.status with all three sections
    const poolStatusPath = path.join(poolDir, 'pool.status');
    const poolStatus = [
      JSON.stringify(generatePoolStats()),
      JSON.stringify(generateHashrateStats()),
      JSON.stringify(generateShareStats())
    ].join('\n');
    fs.writeFileSync(poolStatusPath, poolStatus);

    // Update user files
    const wallets = [
      '3DFMUvm3gqyinhufyv7b5GAPN9rmH7bLZo',
      '17KRM3rGPxpKe21pNK562FwTfkyLtEipZm',
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    ];

    wallets.forEach(wallet => {
      const userFilePath = path.join(usersDir, wallet);
      fs.writeFileSync(userFilePath, JSON.stringify(generateUserData(wallet), null, 2));
    });

    console.log('Solo log files updated successfully');
  } catch (error) {
    console.error('Error updating Solo log files:', error);
  }
};

// Start the dev solo pool (ckpool)
const startDevSolo = async () => {
  if (!devSoloInterval) {
    console.log('Starting dev solo pool...');
    await delay(3000); // Simulate startup delay

    isRunning = true;
    devSoloInterval = setInterval(() => {
      try {
        updateCkpoolLogs();
        console.log('Dev solo pool stats updated');
      } catch (error) {
        console.error(`Error updating dev solo pool stats: ${error.message}`);
      }
    }, 10000); // Update every 10 seconds

    console.log('Dev solo pool started.');
  }
};

// Stop the dev solo pool (ckpool)
const stopDevSolo = async () => {
  if (devSoloInterval) {
    console.log('Stopping dev solo pool...');
    await delay(2000); // Simulate shutdown delay

    clearInterval(devSoloInterval);
    devSoloInterval = null;
    isRunning = false;

    console.log('Dev solo pool stopped.');
  }
};

// Restart the dev solo pool (ckpool)
const restartDevSolo = async () => {
  console.log('Restarting dev solo pool...');
  await stopDevSolo();
  await startDevSolo();
  console.log('Dev solo pool restarted.');
};

// Get the current status
const getStatus = () => {
  return isRunning ? 'active' : 'inactive';
};

// Helper function to introduce delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  startDevSolo,
  stopDevSolo,
  restartDevSolo,
  getStatus
};
