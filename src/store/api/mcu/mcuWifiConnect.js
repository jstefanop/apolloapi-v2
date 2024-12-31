import { exec } from 'child_process';

const wifiConnect = (ssid, passphrase, errors) => {
  return new Promise((resolve, reject) => {
    let command = `sudo nmcli dev wifi connect '${ssid}'`;
    if (passphrase) command += ` password '${passphrase}'`;
    if (process.env.NODE_ENV !== 'production') command = `sleep 2 && nmcli dev wifi connect ${ssid}`;

    exec(command, {}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        if (stdout.includes('Error')) {
          const errMsg = stdout.trim().replace(/^.+\(\d+\)\ /g, "").replace(/\.$/g, "");
          reject(new errors.ValidationError(errMsg));
        } else {
          resolve();
        }
      }
    });
  });
};

const getIpAddress = () => {
  return new Promise((resolve, reject) => {
    let command = "ip -4 addr list wlan0 | grep inet | cut -d' ' -f6 | cut -d/ -f1";
    if (process.env.NODE_ENV !== 'production') command = 'echo "127.0.0.1"';

    exec(command, {}, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        const address = stdout.trim();
        resolve(address);
      }
    });
  });
};

export default ({ define }) => {
  define('wifiConnect', async ({ ssid, passphrase }, { knex, errors, utils }) => {
    await wifiConnect(ssid, passphrase, errors);
    const address = await getIpAddress();
    return { address };
  }, {
    auth: true
  });
};
