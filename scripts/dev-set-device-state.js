#!/usr/bin/env node
/* eslint-disable no-console */
//
// Dev helper to switch the UI between the 5 device states without real hardware.
// Writes the three orthogonal flags consumed by /api/config + DeviceConfigContext
// into apolloui-v2/.env.local (the file Next.js loads in dev).
//
// Usage:
//   node scripts/dev-set-device-state.js <state>
//
// Available states:
//   solo-node          — chassis solo-node, no miners (state #1)
//   solo-node+miner    — chassis solo-node + Apollo II USB units (state #2)
//   apollo-ii          — chassis apollo-ii + Apollo II USB units (state #3)
//   apollo-iii         — chassis apollo-iii, internal only (state #4)
//   apollo-iii+usb     — chassis apollo-iii + Apollo II USB units (state #5)
//
// Restart `yarn dev` in apolloui-v2 after switching so Next.js picks up the .env.

const fs = require('fs');
const path = require('path');

const STATES = {
  'solo-node': {
    NEXT_PUBLIC_CHASSIS: 'solo-node',
    NEXT_PUBLIC_INTERNAL_MINER: 'none',
    NEXT_PUBLIC_USB_MINERS: 'none',
    NEXT_PUBLIC_DEVICE_TYPE: 'solo-node',
  },
  'solo-node+miner': {
    NEXT_PUBLIC_CHASSIS: 'solo-node',
    NEXT_PUBLIC_INTERNAL_MINER: 'none',
    NEXT_PUBLIC_USB_MINERS: 'apollo-ii',
    NEXT_PUBLIC_DEVICE_TYPE: 'miner',
  },
  'apollo-ii': {
    NEXT_PUBLIC_CHASSIS: 'apollo-ii',
    NEXT_PUBLIC_INTERNAL_MINER: 'none',
    NEXT_PUBLIC_USB_MINERS: 'apollo-ii',
    NEXT_PUBLIC_DEVICE_TYPE: 'miner',
  },
  'apollo-iii': {
    NEXT_PUBLIC_CHASSIS: 'apollo-iii',
    NEXT_PUBLIC_INTERNAL_MINER: 'apollo-iii',
    NEXT_PUBLIC_USB_MINERS: 'none',
    NEXT_PUBLIC_DEVICE_TYPE: 'miner',
  },
  'apollo-iii+usb': {
    NEXT_PUBLIC_CHASSIS: 'apollo-iii',
    NEXT_PUBLIC_INTERNAL_MINER: 'apollo-iii',
    NEXT_PUBLIC_USB_MINERS: 'apollo-ii',
    NEXT_PUBLIC_DEVICE_TYPE: 'miner',
  },
};

const MANAGED_KEYS = [
  'NEXT_PUBLIC_CHASSIS',
  'NEXT_PUBLIC_INTERNAL_MINER',
  'NEXT_PUBLIC_USB_MINERS',
  'NEXT_PUBLIC_DEVICE_TYPE',
];

const ENV_PATH = path.resolve(
  __dirname,
  '..',
  'apolloui-v2',
  '.env.local'
);

const state = process.argv[2];

if (!state || !STATES[state]) {
  console.error('Usage: node scripts/dev-set-device-state.js <state>');
  console.error('Available states:');
  Object.keys(STATES).forEach((s) => console.error(`  - ${s}`));
  process.exit(1);
}

const target = STATES[state];
let existing = '';
try {
  existing = fs.readFileSync(ENV_PATH, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

// Drop any lines we own, keep everything else (NEXT_PUBLIC_GRAPHQL_HOST, etc.)
const filtered = existing
  .split('\n')
  .filter((line) => {
    const key = line.split('=')[0].trim();
    return !MANAGED_KEYS.includes(key);
  })
  .join('\n')
  .replace(/\n+$/, '');

const block = MANAGED_KEYS.map((k) => `${k}=${target[k]}`).join('\n');
const next = (filtered ? `${filtered}\n` : '') + block + '\n';

fs.writeFileSync(ENV_PATH, next);

console.log(`Wrote device state '${state}' to ${ENV_PATH}`);
console.log('Managed keys:');
MANAGED_KEYS.forEach((k) => console.log(`  ${k}=${target[k]}`));
console.log('\nRestart `yarn dev` in apolloui-v2 to pick up the new env.');
