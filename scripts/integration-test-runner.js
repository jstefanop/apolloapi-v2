#!/usr/bin/env node
/**
 * Integration tests run inside Docker with real system commands.
 * - chpasswd: actually changes futurebit's password and we verify via /etc/shadow
 * - nmcli: stub logs argv to /tmp/nmcli-args; we verify ssid/passphrase are separate args (no shell)
 */

const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'production';
process.env.NODE_CONFIG = process.env.NODE_CONFIG || JSON.stringify({ db: { url: ':memory:' } });

const failures = [];

function getFuturebitShadow() {
  const shadow = fs.readFileSync('/etc/shadow', 'utf8');
  const m = shadow.match(/^futurebit:([^:]*)/m);
  return m ? m[1] : null;
}

async function testChpasswd() {
  console.log('Integration test 1: changeSystemPassword (real chpasswd)');
  const hashBefore = getFuturebitShadow();
  if (!hashBefore) {
    failures.push('User futurebit not found in /etc/shadow');
    return;
  }

  const utils = require('../src/utils');
  const testPassword = "Int3gr@tion'; echo pwned #";
  await utils.auth.changeSystemPassword(testPassword);
  const hashAfter = getFuturebitShadow();
  if (hashAfter === hashBefore) {
    failures.push('chpasswd: password hash did not change (command may not have run)');
    return;
  }
  console.log('  OK: password updated via spawn + stdin (no shell)');
}

async function testNmcliArgv() {
  console.log('Integration test 2: WiFi connect argv (stub nmcli)');
  const { spawn } = require('child_process');
  const ssid = "Net'; echo pwned #";
  const passphrase = 'p@ss"; id';

  const args = ['nmcli', 'dev', 'wifi', 'connect', ssid, 'password', passphrase];
  const child = spawn('sudo', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve());
  });

  if (!fs.existsSync('/tmp/nmcli-args')) {
    failures.push('nmcli stub did not run (check PATH/sudo)');
    return;
  }
  const logged = fs.readFileSync('/tmp/nmcli-args', 'utf8').trim().split('\n');
  // Stub receives $@ (args only, no argv[0]); so we expect: dev, wifi, connect, ssid, password, passphrase
  const expected = ['dev', 'wifi', 'connect', ssid, 'password', passphrase];
  if (logged.length !== expected.length || expected.some((e, i) => logged[i] !== e)) {
    failures.push(`nmcli argv mismatch: got ${JSON.stringify(logged)}`);
    return;
  }
  console.log('  OK: ssid/passphrase passed as separate argv (no shell interpolation)');
}

async function main() {
  if (process.getuid && process.getuid() !== 0) {
    console.error('Run as root (e.g. in Docker) to read /etc/shadow');
    process.exit(1);
  }
  await testChpasswd();
  await testNmcliArgv();
  if (failures.length) {
    console.error('Failures:', failures);
    process.exit(1);
  }
  console.log('All integration tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
