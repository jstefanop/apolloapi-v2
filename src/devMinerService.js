const fs = require('fs');
const path = require('path');

let devMinerInterval = null;
const statsDir = path.resolve(__dirname, '../backend/apollo-miner/');
const ckpoolDir = path.resolve(__dirname, '../backend/ckpool/logs');
let statsFilePath = null;

// Helper function to delete files starting with "apollo-miner" in the directory
const clearApolloMinerFiles = async (directory) => {
  if (fs.existsSync(directory)) {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      if (file.startsWith('apollo-miner')) {
        fs.unlinkSync(path.join(directory, file));
        console.log(`Deleted file: ${file}`);
      }
    }
  }
};

// Generate random hashrate in TH/s
const generateRandomHashrate = () => {
  const value = (Math.random() * 4 + 14).toFixed(2); // Random between 14 and 18
  return `${value}T`;
};

// Generate random hashrate in GH/s
const generateRandomHashrateG = () => {
  const value = (Math.random() * 500 + 100).toFixed(0);
  return `${value}G`;
};

// Generate CKPool pool status data
const generatePoolStatus = () => {
  const now = Math.floor(Date.now() / 1000);
  return [
    JSON.stringify({
      runtime: Math.floor(Math.random() * 10000),
      lastupdate: now,
      Users: 1,
      Workers: 1,
      Idle: 0,
      Disconnected: 0
    }),
    JSON.stringify({
      hashrate1m: generateRandomHashrate(),
      hashrate5m: generateRandomHashrate(),
      hashrate15m: generateRandomHashrate(),
      hashrate1hr: generateRandomHashrate(),
      hashrate6hr: generateRandomHashrate(),
      hashrate1d: generateRandomHashrateG(),
      hashrate7d: generateRandomHashrateG()
    }),
    JSON.stringify({
      diff: 0.0,
      accepted: Math.floor(Math.random() * 10000000),
      rejected: Math.floor(Math.random() * 10000),
      bestshare: Math.floor(Math.random() * 10000000),
      SPS1m: (Math.random() * 1).toFixed(3),
      SPS5m: (Math.random() * 1).toFixed(3),
      SPS15m: (Math.random() * 1).toFixed(3),
      SPS1h: (Math.random() * 1).toFixed(3)
    })
  ].join('\n');
};

// Generate CKPool user data
const generateUserData = (wallet) => {
  const now = Math.floor(Date.now() / 1000);
  const hashrate1m = generateRandomHashrate();
  const hashrate5m = generateRandomHashrate();
  const hashrate1hr = generateRandomHashrate();
  const hashrate1d = generateRandomHashrateG();
  const hashrate7d = generateRandomHashrateG();
  const bestshare = Math.random() * 10000000;
  // Make lastshare between 1 and 5 minutes old
  const lastshare = now - (60 + Math.floor(Math.random() * 240)); // Random seconds between 60 (1 min) and 300 (5 min)

  return {
    hashrate1m,
    hashrate5m,
    hashrate1hr,
    hashrate1d,
    hashrate7d,
    lastshare,
    workers: 1,
    shares: Math.floor(Math.random() * 10000000),
    bestshare,
    bestever: Math.floor(bestshare),
    authorised: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 1000000),
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

    // Update pool.status
    const poolStatusPath = path.join(poolDir, 'pool.status');
    fs.writeFileSync(poolStatusPath, generatePoolStatus());

    // Update user file
    const wallet = '3DFMUvm3gqyinhufyv7b5GAPN9rmH7bLZo';
    const userFilePath = path.join(usersDir, wallet);
    fs.writeFileSync(userFilePath, JSON.stringify(generateUserData(wallet), null, 2));

    // Add another user
    const wallet2 = '17KRM3rGPxpKe21pNK562FwTfkyLtEipZm';
    const userFilePath2 = path.join(usersDir, wallet2);
    fs.writeFileSync(userFilePath2, JSON.stringify(generateUserData(wallet2), null, 2));

    console.log('CKPool log files updated successfully');
  } catch (error) {
    console.error('Error updating CKPool log files:', error);
  }
};

// Start the dev miner
const startDevMiner = async () => {
  if (!devMinerInterval) {
    console.log('Starting dev miner...');
    await delay(5_000); // Simulate startup delay

    // Clear existing apollo-miner files
    try {
      await clearApolloMinerFiles(statsDir);
    } catch (error) {
      console.error(`Error clearing apollo-miner files: ${error.message}`);
      return;
    }

    const statsFileName = `apollo-miner-v2.${Date.now()}`;
    statsFilePath = path.join(statsDir, statsFileName);

    if (!fs.existsSync(statsDir)) {
      try {
        fs.mkdirSync(statsDir, { recursive: true });
      } catch (error) {
        console.error(`Error creating directory ${statsDir}: ${error.message}`);
        return;
      }
    }

    devMinerInterval = setInterval(() => {
      try {
        const stats = generateDevStats();
        fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
        console.log(`Dev miner stats written to ${statsFilePath}`);
        
        // Update CKPool log files
        updateCkpoolLogs();
      } catch (error) {
        console.error(`Error writing dev miner stats: ${error.message}`);
      }
    }, 10_000);

    console.log('Dev miner started.');
  }
};

// Stop the dev miner
const stopDevMiner = async () => {
  if (devMinerInterval) {
    console.log('Stopping dev miner...');
    await delay(5_000); // Simulate shutdown delay

    clearInterval(devMinerInterval);
    devMinerInterval = null;

    if (statsFilePath && fs.existsSync(statsFilePath)) {
      try {
        fs.unlinkSync(statsFilePath);
        console.log(`Dev miner stats file ${statsFilePath} deleted.`);
      } catch (error) {
        console.error('Error deleting Dev miner stats file:', error);
      }
    }

    statsFilePath = null;
    console.log('Dev miner stopped.');
  }
};

// Restart the dev miner
const restartDevMiner = async () => {
  console.log('Restarting dev miner...');
  await stopDevMiner();
  await startDevMiner();
  console.log('Dev miner restarted.');
};

// Generate dev stats
const generateDevStats = () => {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  return {
    date: localDate,
    statVersion: '1.2',
    versions: {
      miner: '2.0.2',
      minerDate: '2025-03-06',
      minerDebug: '0',
      mspVer: '0xd167',
    },
    comport: '/dev/ttyS1',
    powermode: 'balanced',
    master: {
      upTime: Math.floor(Math.random() * 1_000_000),
      diff: 5002,
      boards: 1,
      errorSpi: 0,
      osc: 0,
      hwAddr: '00:00:00:00:00:00',
      boardsI: '36.8',
      boardsW: '258.0',
      wattPerGHs: '0.035',
      intervals: {
        30: generateIntervalStats(30),
        300: generateIntervalStats(300),
        900: generateIntervalStats(900),
        3600: generateIntervalStats(3600),
        0: generateIntervalStats(351349),
      },
    },
    pool: {
      host: 'stratum.braiins.com',
      port: '3333',
      userName: 'michelem09.worker1',
      diff: 5002,
      intervals: {
        30: generatePoolStats(30),
        300: generatePoolStats(300),
        900: generatePoolStats(900),
        3600: generatePoolStats(3600),
        0: generatePoolStats(351349),
      },
    },
    fans: {
      0: {
        rpm: [4352],
      },
    },
    temperature: {
      count: 2,
      min: 0,
      avr: 36,
      max: 72,
    },
    slots: {
      0: {
        revision: 21,
        spiNum: 1,
        spiLen: 4,
        pwrNum: 2,
        pwrLen: 2,
        btcNum: 11,
        specVoltage: 12,
        chips: 44,
        pwrOn: 1,
        pwrOnTarget: 1,
        revAdc: 3879,
        temperature: (Math.random() * 70 + 30).toFixed(2),
        currents: [
          Math.floor(Math.random() * 20000 + 18000),
          Math.floor(Math.random() * 20000 + 18000),
        ],
        solutions: '0',
        errors: '0',
        ghs: '0.0',
        errorRate: '0.0',
        chipRestarts: '0',
        wattPerGHs: '0.000000',
      },
    },
    slaves: [
      {
        id: 0,
        uid: '47003B001351323532343337',
        ver: '0x13160100',
        rx: Math.floor(Math.random() * 1_000_000),
        err: 0,
        time: Math.floor(Math.random() * 1_000_000),
        ping: 603,
      },
    ],
    slavePingMin: 603,
    slavePingMax: 603,
    slavePingAvg: 603,
  };
};

const generateIntervalStats = (interval) => {
  return {
    name: `${interval} sec`,
    interval,
    bySol: (Math.random() * 10_000).toFixed(1),
    byDiff: (Math.random() * 10_000).toFixed(1),
    byPool: (Math.random() * 10_000).toFixed(1),
    byJobs: (Math.random() * 10_000).toFixed(1),
    solutions: Math.floor(Math.random() * 1_000_000).toString(),
    errors: Math.floor(Math.random() * 1_000).toString(),
    errorRate: (Math.random() * 2).toFixed(1),
    chipSpeed: (Math.random() * 200).toFixed(2),
    chipRestarts: '0',
  };
};

const generatePoolStats = (interval) => {
  return {
    name: `${interval} sec`,
    interval,
    jobs: Math.floor(Math.random() * 100),
    cleanFlags: 0,
    sharesSent: Math.floor(Math.random() * 100),
    sharesAccepted: Math.floor(Math.random() * 100),
    sharesRejected: Math.floor(Math.random() * 10),
    solutionsAccepted: Math.floor(Math.random() * 1_000_000).toString(),
    minRespTime: (Math.random() * 500).toFixed(0),
    avgRespTime: (Math.random() * 500).toFixed(0),
    maxRespTime: (Math.random() * 500).toFixed(0),
  };
};

// Helper function to introduce delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  startDevMiner,
  stopDevMiner,
  restartDevMiner,
};
