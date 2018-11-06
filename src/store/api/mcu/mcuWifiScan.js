const { join } = require('path')
const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('wifiScan', async (payload, { knex, errors, utils }) => {
    const wifiScan = await getWifiScan()
    return { wifiScan }
  }, {
    auth: true
  })
}

function getWifiScan() {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'scripts', 'wifi_scan')
    exec(scriptPath, {}, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        try {
          const result = JSON.parse(stdout.toString())
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }
    })
  })
}