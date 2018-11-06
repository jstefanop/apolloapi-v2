const { join } = require('path')
const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getOsStats()
    stats.timestamp = new Date().toISOString()
    return { stats }
  }, {
    auth: true
  })
}

function getOsStats () {
  return new Promise((resolve, reject) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'os_stats' : 'os_stats_fake'
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'scripts', scriptName)
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
