// Validates that the Apollo III stat fixture covers every field the UI
// selector (apolloui-v2/src/redux/reselect/miner.js) consumes, after the
// same int_<key> renaming that src/services/miner.js applies to live files.
//
// TBD: John — replace the fixture with a real Apollo III stat sample when
// available (the schema is supposed to stay the same, this test will tell
// us if any required field is missing).

const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'apollo-miner-3.json');

// Mirrors the renaming performed in src/services/miner.js _getMinerStats.
const renameIntervals = (received) => {
  received.master.intervals = _.mapKeys(
    received.master.intervals,
    (value, name) => `int_${name}`
  );
  received.pool.intervals = _.mapKeys(
    received.pool.intervals,
    (value, name) => `int_${name}`
  );
  received.fans = _.mapKeys(
    received.fans,
    (value, name) => `int_${name}`
  );
  received.slots = _.mapKeys(
    received.slots,
    (value, name) => `int_${name}`
  );
  return received;
};

describe('Apollo III stat fixture', () => {
  let parsed;

  beforeAll(() => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
    parsed = renameIntervals(JSON.parse(raw));
  });

  it('contains the master intervals the UI reads', () => {
    expect(parsed.master.intervals.int_30.bySol).toBeDefined();
    expect(parsed.master.intervals.int_3600.bySol).toBeDefined();
    expect(parsed.master.intervals.int_3600.byPool).toBeDefined();
    expect(parsed.master.intervals.int_3600.chipSpeed).toBeDefined();
  });

  it('contains the master scalar fields (boardsI/W, wattPerGHs, upTime)', () => {
    expect(parsed.master.boardsI).toBeDefined();
    expect(parsed.master.boardsW).toBeDefined();
    expect(parsed.master.wattPerGHs).toBeDefined();
    expect(parsed.master.upTime).toBeDefined();
  });

  it('contains the pool cumulative shares at int_0', () => {
    const cum = parsed.pool.intervals.int_0;
    expect(cum.sharesSent).toBeDefined();
    expect(cum.sharesAccepted).toBeDefined();
    expect(cum.sharesRejected).toBeDefined();
  });

  it('contains pool host/port/userName/diff', () => {
    expect(parsed.pool.host).toBeDefined();
    expect(parsed.pool.port).toBeDefined();
    expect(parsed.pool.userName).toBeDefined();
    expect(parsed.pool.diff).toBeDefined();
  });

  it('contains 4 internal hashboards under slots (int_0..int_3)', () => {
    ['int_0', 'int_1', 'int_2', 'int_3'].forEach((slotKey) => {
      const slot = parsed.slots[slotKey];
      expect(slot).toBeDefined();
      expect(slot.temperature).toBeDefined();
      expect(slot.errorRate).toBeDefined();
      expect(slot.chips).toBeDefined();
    });
  });

  it('contains fan RPM array at int_0', () => {
    expect(Array.isArray(parsed.fans.int_0.rpm)).toBe(true);
    expect(parsed.fans.int_0.rpm.length).toBeGreaterThan(0);
  });

  it('contains top-level metadata (date, comport, statVersion)', () => {
    expect(parsed.date).toBeDefined();
    expect(parsed.comport).toBeDefined();
    expect(parsed.statVersion).toBeDefined();
  });

  it('has no slaves[] (Apollo III is internal-only)', () => {
    expect(parsed.slaves).toBeUndefined();
  });
});
