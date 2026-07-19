const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const config = require('config');

const isProduction = () => process.env.NODE_ENV === 'production';

module.exports.auth = {
  hashPassword(password) {
    return bcrypt.hash(password, 12);
  },

  comparePassword(password, hash) {
    if (!password || !hash) return false;
    return bcrypt.compare(password, hash);
  },

  async changeSystemPassword(password) {
    if (!isProduction()) {
      console.log("[DEV] Would change system password for user 'futurebit'");
      return;
    }

    await new Promise((resolve, reject) => {
      const child = spawn('sudo', ['chpasswd'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `chpasswd exited with code ${code}`));
        } else {
          resolve();
        }
      });
      child.stdin.write(`futurebit:${password}\n`);
      child.stdin.end();
    });
  },

  generateAccessToken() {
    return {
      accessToken: jwt.sign({}, config.get('server.secret'), {
        subject: 'apollouser',
        audience: 'auth',
      }),
    };
  },
};
