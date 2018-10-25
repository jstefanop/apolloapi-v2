const os = require('os')
const { freemem, totalmem } = require('os')
const { exec } = require('child_process')
const diskusage = require('diskusage')

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    const disk = await getDiskUsage()
    const stats = {
      freeMemoryBytes: freemem() + '',
      totalMemoryBytes: totalmem() + '',
      freeDiskBytes: disk.free + '',
      totalDiskBytes: disk.total + '',
      cpuUsagePercent: await getCpuUsage()
    }
    return { stats }
  })
}

function getCpuUsage () {
  return new Promise((resolve, reject) => {
    exec(`grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {print usage}'`, {}, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        const result = stdout.toString()
        resolve(parseFloat(result))
      }
    })
  })
}

function getDiskUsage () {
  return new Promise((resolve, reject) => {
    diskusage.check('/', (err, info) => {
      if (err) {
        reject(err)
      } else {
        resolve(info)
      }
    })
  })
}
