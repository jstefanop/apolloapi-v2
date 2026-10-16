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

  const loaded = require('dotenv').config({ path: envPath });
  if (loaded.error) {
    // An unreadable file (root-owned 0600, say) must stop the boot. Carrying on
    // would mint a different in-memory secret on every start: every session
    // invalidated by each restart, with nothing in the log to say why.
    throw new Error(
      `Cannot read ${envPath} (${loaded.error.code || loaded.error.message}): ` +
        'it must be readable by the user running the API. Fix its owner or mode and start again.'
    );
  }

  // A file that exists but has no usable secret (empty, truncated, a bare
  // `APP_SECRET=`) would leave the app unable to sign or verify anything. Give it
  // one rather than leave it that way.
  if (!process.env.APP_SECRET) {
    const secret = newSecret();
    try {
      const current = fs.readFileSync(envPath, 'utf8');
      // An empty assignment is dropped rather than left behind: dotenv takes the
      // LAST assignment of a key, so a new line after it would win anyway, but an
      // empty one in the file is a trap for whoever reads it (or edits it) next.
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
