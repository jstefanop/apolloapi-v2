const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newSecret = () => crypto.randomBytes(64).toString('hex');

// Creates .env on first start AND loads it into this process.
//
// Writing the file is not enough: node-config reads process.env once, the first
// time anything requires it, and requiring ./utils or ./db does exactly that. If
// that happens before .env exists, `server.secret` is frozen as undefined for the
// life of the process — the setup wizard then fails with «Configuration property
// "server.secret" is not defined» until the backend is restarted. So this has to
// run before anything that requires `config`.
function ensureEnvFile(envPath = path.join(__dirname, '..', '.env')) {
  const contents = [
    `DATABASE_URL=${path.join(__dirname, '..', 'futurebit.sqlite')}`,
    `APP_SECRET=${newSecret()}`,
    '',
  ].join('\n');

  // 'wx' so two processes starting together cannot both write it (the second
  // would replace the secret the first already loaded): whoever loses simply
  // reads the winner's file below.
  try {
    fs.writeFileSync(envPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  // Tightening the mode is a courtesy, not a precondition: a file somebody else
  // owns refuses it (EPERM), and that is no reason to refuse to boot.
  try {
    fs.chmodSync(envPath, 0o600);
  } catch (error) {
    console.warn(`Could not restrict permissions on ${envPath}: ${error.code || error.message}`);
  }

  require('dotenv').config({ path: envPath });

  // A file that exists but has no usable secret (empty, truncated, a bare
  // `APP_SECRET=`) would leave the app unable to sign or verify anything. Give it
  // one rather than leave it that way.
  if (!process.env.APP_SECRET) {
    const secret = newSecret();
    try {
      const current = fs.readFileSync(envPath, 'utf8');
      // An empty assignment is dropped, not left in front: dotenv keeps the first
      // value it sees for a key, so the new line would never win.
      const kept = current
        .split('\n')
        .filter((line) => !/^\s*(export\s+)?APP_SECRET\s*=\s*(['"]{2})?\s*$/.test(line))
        .join('\n');
      const separator = kept === '' || kept.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(envPath, `${kept}${separator}APP_SECRET=${secret}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      // Cannot persist it: run with it anyway. Sessions will not survive the next
      // restart, which is better than not being able to sign in at all.
      console.warn(`Could not write APP_SECRET to ${envPath}: ${error.code || error.message}`);
    }
    process.env.APP_SECRET = secret;
  }

  return envPath;
}

module.exports = { ensureEnvFile };
