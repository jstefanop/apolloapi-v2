const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('wifiConnect', async ({ssid, passphrase}, { knex, errors, utils }) => {
    await wifiConnect(ssid, passphrase, errors)
    const address = await getIpAddress()
    return { address }
  }), {
    auth: true
  }
}

function wifiConnect(ssid, passphrase, errors) {
  return new Promise((resolve, reject) => {
    if (passphrase) {
      command = 'sudo nmcli dev wifi connect ' + ssid + ' password '  + passphrase
    }
    else {
      command = 'sudo nmcli dev wifi connect ' + ssid
    }

    exec(command, {}, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        if (stdout.includes('Error')) {
          errMsg = stdout.trim().replace(/^.+\(\d+\)\ /g, "").replace(/\.$/g, "")
          reject(new errors.ValidationError(errMsg))
        }
        else {
          resolve()
        }
      }
    })
  })
}

function getIpAddress() {
  return new Promise((resolve, reject) => {
    command = "ip -4 addr list wlan0 | grep inet | cut -d' ' -f6 | cut -d/ -f1"
    exec(command, {}, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        address = stdout.trim()
        resolve(address)
      }
    })
  })
}