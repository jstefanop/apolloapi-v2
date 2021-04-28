const { join } = require('path')
const { exec } = require('child_process')

module.exports = ({ define }) => {
  define('update', async (payload, { knex, errors, utils }) => {
  	const updateScript = join(__dirname, '..', '..', '..', '..', 'backend', 'update')
    if (process.env.NODE_ENV === 'production') return exec(`bash ${updateScript}`)
    else console.log(updateScript)
    return;
  }, {
    auth: true
  })
}
