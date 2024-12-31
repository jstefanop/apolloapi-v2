import { exec } from 'child_process';

export default ({ define }) => {
  define('wifiDisconnect', async (payload, { knex, errors, utils }) => {
    await wifiDisconnect(errors);
    return;
  }, {
    auth: true
  });
};

const wifiDisconnect = (ssid, passphrase, errors) => {
  return new Promise((resolve, reject) => {
    let command = 'for i in $(nmcli -t c show|grep wlan); do nmcli c delete `echo $i|cut -d":" -f2`; done';
    if (process.env.NODE_ENV !== 'production') command = 'sleep 2 && echo true';

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
