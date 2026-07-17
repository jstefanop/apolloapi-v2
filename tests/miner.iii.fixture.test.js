// Exercises the REAL Apollo III stat-file parser in src/services/miner.js against
// the fixture: the sanitizing regexes, JSON.parse, the int_<key> renaming and the
// moment date handling all run here (previously this file re-implemented the
// rename and asserted on its own copy, testing no production code).
//
// TBD: John — replace the fixture with a real Apollo III stat sample when
// available (the schema is meant to stay the same; this test flags a missing
// field if it does not).
const path = require('path');
const { knex } = require('../src/db');

// tests/setup.js globally mocks `fs`, so fs.promises.readFile returns canned
// content for any apollo-miner path — it never reads a real file. Feed the parser
// the actual fixture bytes (read with the real fs) so it runs on the true sample.
const fs = require('fs'); // the mocked module
const miner = require('../src/services/miner')(knex, {});
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'apollo-miner-3.json');

describe('Apollo III stat fixture — real parser', () => {
  let parsed;

  beforeAll(async () => {
    const bytes = jest.requireActual('fs').readFileSync(FIXTURE_PATH);
    fs.promises.readFile.mockResolvedValueOnce(bytes); // real fixture → real parser
    parsed = await miner._parseStatFileEntry(FIXTURE_PATH, { version: 'v3', id: '3' });
  });

  it('parses cleanly and tags the source (uuid/version/date)', () => {
    expect(parsed).not.toBeNull();
    expect(parsed.uuid).toBe('3');
    expect(parsed.version).toBe('v3');
    expect(typeof parsed.date).toBe('string'); // moment-formatted
  });

  it('renames master/pool interval keys to int_<n> (the UI selector shape)', () => {
    expect(parsed.master.intervals.int_30.bySol).toBeDefined();
    expect(parsed.master.intervals.int_3600.bySol).toBeDefined();
    expect(parsed.master.intervals.int_3600.byPool).toBeDefined();
    expect(parsed.master.intervals.int_3600.chipSpeed).toBeDefined();
    expect(parsed.pool.intervals.int_0.sharesSent).toBeDefined();
    expect(parsed.pool.intervals.int_0.sharesAccepted).toBeDefined();
  });

  it('exposes the master scalars and pool identity the UI reads', () => {
    expect(parsed.master.boardsI).toBeDefined();
    expect(parsed.master.boardsW).toBeDefined();
    expect(parsed.master.wattPerGHs).toBeDefined();
    expect(parsed.master.upTime).toBeDefined();
    expect(parsed.pool.host).toBeDefined();
    expect(parsed.pool.port).toBeDefined();
    expect(parsed.pool.userName).toBeDefined();
    expect(parsed.pool.diff).toBeDefined();
  });

  it('has 4 internal hashboards under slots (int_0..int_3) with fan RPM', () => {
    ['int_0', 'int_1', 'int_2', 'int_3'].forEach((slotKey) => {
      const slot = parsed.slots[slotKey];
      expect(slot).toBeDefined();
      expect(slot.temperature).toBeDefined();
      expect(slot.errorRate).toBeDefined();
      expect(slot.chips).toBeDefined();
    });
    expect(Array.isArray(parsed.fans.int_0.rpm)).toBe(true);
    expect(parsed.fans.int_0.rpm.length).toBeGreaterThan(0);
  });

  it('carries top-level metadata and no slaves[] (Apollo III is internal-only)', () => {
    expect(parsed.comport).toBeDefined();
    expect(parsed.statVersion).toBeDefined();
    expect(parsed.slaves).toBeUndefined();
  });
});
