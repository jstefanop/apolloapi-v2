const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { defaultDatabaseUrl } = require('./paths');

function ensureEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    const contents = [
      `DATABASE_URL=${defaultDatabaseUrl()}`,
      `APP_SECRET=${crypto.randomBytes(64).toString('hex')}`,
      '',
    ].join('\n');

    fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
  }

  fs.chmodSync(envPath, 0o600);
  require('dotenv').config({ path: envPath });
  return envPath;
}

module.exports = { ensureEnvFile };
