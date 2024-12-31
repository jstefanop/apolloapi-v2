import { join } from 'path';
import { spawn } from 'child_process';

export default ({ define }) => {
  define('format', async (payload, { knex, errors, utils }) => {
    await formatDisk();
  }, {
    auth: true
  });
};

const formatDisk = () => {
  return new Promise((resolve, reject) => {
    const scriptName = (process.env.NODE_ENV === 'production') ? 'format_node_disk' : 'format_node_disk_fake';
    const scriptPath = join(__dirname, '..', '..', '..', '..', 'backend', scriptName);

    const cmd = (process.env.NODE_ENV === 'production') ? spawn('sudo', ['bash', scriptPath]) : spawn('bash', [scriptPath]);

    cmd.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    cmd.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
      reject(data);
    });

    cmd.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      resolve();
    });
  });
};
