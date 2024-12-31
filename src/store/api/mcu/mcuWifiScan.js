import { join } from 'path';
import { exec } from 'child_process';

export default ({ define }) => {
  define('wifiScan', async (payload, { knex, errors, utils }) => {
    const wifiScan = await getWifiScan();
    return { wifiScan };
  }, {
    auth: true
  });
};

const getWifiScan = () => {
  return new Promise((resolve, reject) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'wifi_scan' : 'wifi_scan_fake';
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