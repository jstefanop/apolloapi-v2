// Validates that the Apollo III stat fixture covers every field the UI
// selector (apolloui-v2/src/redux/reselect/miner.js) consumes, after the
// same int_<key> renaming that src/services/miner.js applies to live files.
//
// The fixture is a real sample, captured from an Apollo III on 2026-07-28
// (statVersion 1.3, miner 3.0.1). Only the pool host and worker name are
// replaced; everything else is the hardware's own telemetry. Swapping the
// invented fixture for this one immediately contradicted three of the
// assumptions encoded here: the III reports one slot rather than four, has no
// comport, and does carry an empty slaves[].

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

  // One slot, not four: the Apollo III presents its 21 chips as a single board.
  // The invented fixture assumed four hashboards, which is what an Apollo II with
  // several USB units looks like.
  it('contains a single internal hashboard under slots (int_0)', () => {
    expect(Object.keys(parsed.slots)).toEqual(['int_0']);
    const slot = parsed.slots.int_0;
    expect(slot.temperature).toBeDefined();
    expect(slot.errorRate).toBeDefined();
    expect(slot.chips).toBeDefined();
  });

  it('contains fan RPM array at int_0', () => {
    expect(Array.isArray(parsed.fans.int_0.rpm)).toBe(true);
    expect(parsed.fans.int_0.rpm.length).toBeGreaterThan(0);
  });

  it('contains top-level metadata (date, statVersion)', () => {
    expect(parsed.date).toBeDefined();
    expect(parsed.statVersion).toBeDefined();
    // No comport: that identifies the serial device a USB board is attached to,
    // and the Apollo III has none.
    expect(parsed.comport).toBeUndefined();
  });

  it('reports an empty slaves[] rather than omitting it', () => {
    // It is present and empty, not absent — the UI must not treat the key's
    // existence as evidence of chained units.
    expect(parsed.slaves).toEqual([]);
  });

  // New in statVersion 1.3 and not consumed yet: per-chip temperature spread
  // across the board, which is richer than the single figure in the slot.
  it('exposes the top-level temperature summary', () => {
    expect(parsed.temperature).toMatchObject({
      count: expect.any(Number),
      min: expect.any(Number),
      avr: expect.any(Number),
      max: expect.any(Number),
    });
  });
});
