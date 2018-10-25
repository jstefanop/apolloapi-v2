const { join } = require('path')
const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const stats = await getOsStats()
    return { stats }
  })
}

function getOsStats () {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'scripts', 'os_stats')
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
