import { exec } from 'child_process';

export default ({ define }) => {
  define('online', async (payload, { knex, errors, utils }) => {
    const online = await isMinerOnline();
    online.timestamp = new Date().toISOString();
    return { online };
  }, {
    auth: true
  });
};

const isMinerOnline = () => {
  return new Promise((resolve, reject) => {
    exec('systemctl is-active apollo-miner >/dev/null 2>&1 && echo true || echo false', {}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        const current = stdout.toString().replace(/(\r\n|\n|\r)/gm, '');
        const status = (current === 'true');
        resolve({ status });
      }
    });
  });
};
