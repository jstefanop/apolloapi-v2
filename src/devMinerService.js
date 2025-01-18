const fs = require('fs');
const path = require('path');

let devMinerInterval = null;
const statsDir = path.resolve(__dirname, '../backend/apollo-miner/');
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

// Start the dev miner
const startDevMiner = async () => {
  if (!devMinerInterval) {
    console.log('Starting dev miner...');
    await delay(5_000); // Simulate startup delay

    // Clear existing apollo-miner files
    await clearApolloMinerFiles(statsDir);

    const statsFileName = `apollo-miner-v2.${Date.now()}`;
    statsFilePath = path.join(statsDir, statsFileName);

    if (!fs.existsSync(statsDir)) {
      fs.mkdirSync(statsDir, { recursive: true });
    }

    devMinerInterval = setInterval(() => {
      const stats = generateDevStats();
      fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
      console.log(`Dev miner stats written to ${statsFilePath}`);
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
