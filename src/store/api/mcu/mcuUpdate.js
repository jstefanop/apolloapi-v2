const { join } = require('path')
const { spawn } = require('child_process')

module.exports = ({ define }) => {
  define('update', async (payload, { knex, errors, utils }) => {
  	let scriptName = 'update';
  	if (process.env.NODE_ENV === 'development') scriptName = 'update.fake';
  	const updateScript = join(__dirname, '..', '..', '..', '..', 'backend', scriptName)
    const cmd = spawn('sudo',  ['bash', updateScript])

	  cmd.stdout.on('data', (data) => {
		  console.log(`stdout: ${data}`);
		});

		cmd.stderr.on('data', (data) => {
		  console.error(`stderr: ${data}`);
		});

		cmd.on('close', (code) => {
		  console.log(`child process exited with code ${code}`);
		  return;
		});
  }, {
    auth: true
  })
}
