const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Creates .env on first start AND loads it into this process.
//
// Writing the file is not enough: node-config reads process.env once, the first
// time anything requires it, and requiring ./utils or ./db does exactly that. If
// that happens before .env exists, `server.secret` is frozen as undefined for the
// life of the process — the setup wizard then fails with «Configuration property
// "server.secret" is not defined» until the backend is restarted. So this has to
// run before anything that requires `config`.
function ensureEnvFile(envPath = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(envPath)) {
    const contents = [
      `DATABASE_URL=${path.join(__dirname, '..', 'futurebit.sqlite')}`,
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
