#!/usr/bin/env node
/* eslint-disable no-console */
//
// Smoke-tests the /api/config handler for the 5 device states without
// spinning up Next.js. Verifies the mode/deviceType/isHybrid derivation
// matches what DeviceConfigContext expects on the UI side.

const path = require('path');

const STATES = {
  'solo-node': {
    CHASSIS: 'solo-node',
    INTERNAL_MINER: 'none',
    USB_MINERS: 'none',
    DEVICE_TYPE: 'solo-node',
  },
  'solo-node+miner': {
    CHASSIS: 'solo-node',
    INTERNAL_MINER: 'none',
    USB_MINERS: 'apollo-ii',
    DEVICE_TYPE: 'miner',
  },
  'apollo-ii': {
    CHASSIS: 'apollo-ii',
    INTERNAL_MINER: 'none',
    USB_MINERS: 'apollo-ii',
    DEVICE_TYPE: 'miner',
  },
  'apollo-iii': {
    CHASSIS: 'apollo-iii',
    INTERNAL_MINER: 'apollo-iii',
    USB_MINERS: 'none',
    DEVICE_TYPE: 'miner',
  },
  'apollo-iii+usb': {
    CHASSIS: 'apollo-iii',
    INTERNAL_MINER: 'apollo-iii',
    USB_MINERS: 'apollo-i,apollo-ii',
    DEVICE_TYPE: 'miner',
  },
};

const EXPECTED = {
  'solo-node': { mode: 'solo-node', deviceType: 'solo-node', isHybrid: false },
  'solo-node+miner': { mode: 'solo-node+miner', deviceType: 'miner', isHybrid: false },
  'apollo-ii': { mode: 'apollo-ii', deviceType: 'miner', isHybrid: false },
  'apollo-iii': { mode: 'apollo-iii', deviceType: 'miner', isHybrid: false },
  'apollo-iii+usb': { mode: 'apollo-iii+usb', deviceType: 'miner', isHybrid: true },
};

// /api/config is an ES module — pull the same logic via a tiny re-implementation
// that mirrors what apolloui-v2/src/pages/api/config.js does. Keep it in sync.
const parseUsbMiners = (raw) => {
  if (!raw || raw === 'none') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};
const deriveMode = (chassis, hasInternalMiner, hasUsbMiners) => {
  if (chassis === 'apollo-iii') return hasUsbMiners ? 'apollo-iii+usb' : 'apollo-iii';
  if (chassis === 'apollo-ii') return 'apollo-ii';
  return hasUsbMiners ? 'solo-node+miner' : 'solo-node';
};
const computeConfig = (env) => {
  const chassis = env.CHASSIS || 'solo-node';
  const internalMiner = env.INTERNAL_MINER || 'none';
  const usbMiners = parseUsbMiners(env.USB_MINERS);
  const hasInternalMiner = internalMiner !== 'none';
  const hasUsbMiners = usbMiners.length > 0;
  const mode = deriveMode(chassis, hasInternalMiner, hasUsbMiners);
  const deviceType =
    env.DEVICE_TYPE || (mode === 'solo-node' ? 'solo-node' : 'miner');
  return {
    deviceType,
    chassis,
    internalMiner,
    usbMiners,
    hasInternalMiner,
    hasUsbMiners,
    mode,
    isHybrid: hasInternalMiner && hasUsbMiners,
  };
};

let failures = 0;

console.log('Device-state matrix:\n');
console.log(
  'state'.padEnd(20),
  'chassis'.padEnd(12),
  'internal'.padEnd(12),
  'usb'.padEnd(18),
  'mode'.padEnd(18),
  'deviceType'.padEnd(12),
  'isHybrid'
);
console.log('-'.repeat(110));

for (const [name, env] of Object.entries(STATES)) {
  const cfg = computeConfig(env);
  const exp = EXPECTED[name];
  const ok =
    cfg.mode === exp.mode &&
    cfg.deviceType === exp.deviceType &&
    cfg.isHybrid === exp.isHybrid;
  if (!ok) failures += 1;
  console.log(
    name.padEnd(20),
    cfg.chassis.padEnd(12),
    cfg.internalMiner.padEnd(12),
    (cfg.usbMiners.join(',') || 'none').padEnd(18),
    cfg.mode.padEnd(18),
    cfg.deviceType.padEnd(12),
    cfg.isHybrid,
    ok ? '' : '  ← MISMATCH'
  );
}

console.log('');
if (failures) {
  console.error(`${failures} state(s) failed expectations.`);
  process.exit(1);
}
console.log('All 5 device states derive the expected config.');
