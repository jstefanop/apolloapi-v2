const { join } = require('path')
const { exec } = require('child_process')
const axios = require('axios')

module.exports = ({ define }) => {
  define('format', async (payload, { knex, errors, utils }) => {
    await formatDisk();
  }, {
    auth: true
  })
}

function formatDisk () {
  return new Promise((resolve, reject) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'format_node_disk' : 'format_node_disk_fake'
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'backend', scriptName)
    exec(scriptPath, {}, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        try {
          resolve();
        } catch (err) {
          reject(err)
        }
      }
    })
  })
}
