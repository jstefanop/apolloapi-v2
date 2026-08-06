const { spawn } = require('child_process');
const { fixtureFor } = require('./devFixtures');

// Every nmcli invocation goes through here, and it takes an argv ARRAY.
//
// The old disconnect was a shell string — `for i in $(nmcli -t c show|grep wlan);
// do nmcli c delete \`...\`; done` — which is the pattern this project banned
// elsewhere after the chpasswd and nmcli injections. An SSID is attacker-chosen
// text; it must never reach a shell. With argv there is nothing to quote and
// nothing to escape.
//
// Every call is also bounded: `nmcli dev wifi connect` waits on the supplicant
// and can sit there for minutes on a weak signal, and an unbounded child means a
// GraphQL request that never answers.

const DEFAULT_TIMEOUT_MS = 30000;

class NmcliError extends Error {
  constructor(message, { code, output, timedOut = false } = {}) {
    super(message);
    this.name = 'NmcliError';
    this.code = code;
    this.output = output;
    this.timedOut = timedOut;
  }
}

// Resolves with { stdout, code } on success; rejects with NmcliError otherwise.
// `sudo` only in production: in development nmcli is either absent or unprivileged
// and prompting for a password would hang the dev server.
const run = (args, { timeoutMs = DEFAULT_TIMEOUT_MS, sudo = null } = {}) =>
  new Promise((resolve, reject) => {
    const useSudo = sudo === null ? process.env.NODE_ENV === 'production' : sudo;
    const cmd = useSudo ? 'sudo' : 'nmcli';
    const argv = useSudo ? ['nmcli', ...args] : args;

    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let finished = false;

    // SIGTERM first; nmcli normally goes away. The kill timer below is the
    // backstop for a child wedged in the driver, which does happen on wifi.
    const timer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    }, timeoutMs);

    const settle = (fn) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('error', (err) =>
      settle(() => {
        // No nmcli on the machine: outside production that is a development
        // laptop, and the wifi pages are worth being able to open there.
        const fixture = err.code === 'ENOENT' ? fixtureFor(args) : null;
        if (fixture !== null) {
          resolve({ stdout: fixture, code: 0 });
          return;
        }
        reject(new NmcliError(err.message, { output: err.message }));
      })
    );

    child.on('close', (code, signal) => {
      const output = `${stdout}${stderr}`.trim();
      settle(() => {
        // A child we killed reports a signal, not an exit code — reporting that
        // as a plain failure would hide the fact that it never finished.
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(
            new NmcliError(`nmcli timed out after ${timeoutMs}ms`, {
              code,
              output,
              timedOut: true,
            })
          );
          return;
        }
        if (code !== 0) {
          reject(
            new NmcliError(output || `nmcli exited with code ${code}`, { code, output })
          );
          return;
        }
        resolve({ stdout, code });
      });
    });
  });

module.exports = { run, NmcliError, DEFAULT_TIMEOUT_MS };
