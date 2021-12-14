const { join } = require('path')
const { exec } = require('child_process')
const axios = require('axios')

module.exports = ({ define }) => {
  define('format', async (payload, { knex, errors, utils }) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'format_node_disk' : 'format_node_disk_fake'
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'backend', scriptName)
    const cmd = spawn('sudo',  ['bash', scriptPath])

    cmd.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    cmd.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
      reject(err);
    });

    cmd.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      resolve();
    });
  }, {
    auth: true
  })
}
