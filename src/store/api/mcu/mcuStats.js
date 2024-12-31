import { join } from 'path';
import { exec } from 'child_process';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getOsStats();
    stats.timestamp = new Date().toISOString();
    return { stats };
  }, {
    auth: true
  });
};

const getOsStats = () => {
  return new Promise((resolve, reject) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'os_stats' : 'os_stats_fake';
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'backend', scriptName);
    exec(scriptPath, {}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        try {
          const result = JSON.parse(stdout.toString());
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }
    });
  });
};
