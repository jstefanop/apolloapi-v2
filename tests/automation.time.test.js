const { parseDbTime, toDbTime } = require('../src/services/automation/time');

describe('automation timestamps', () => {
  it("reads SQLite's CURRENT_TIMESTAMP as UTC, not as local time", () => {
    // knex.fn.now() stores 'YYYY-MM-DD HH:MM:SS' in UTC, with no marker.
    // `new Date()` on that string would read it in the device's timezone —
    // hours of drift, which quietly breaks every guard rail.
    const parsed = parseDbTime('2026-07-14 12:00:00');
    expect(parsed.toISOString()).toBe('2026-07-14T12:00:00.000Z');
  });

  it('reads a Date bound by knex (stored as epoch milliseconds)', () => {
    const now = Date.now();
    expect(parseDbTime(now).getTime()).toBe(now);
    expect(parseDbTime(String(now)).getTime()).toBe(now);
  });

  it('reads back what it writes', () => {
    const date = new Date('2026-07-14T12:34:56.000Z');
    expect(parseDbTime(toDbTime(date)).getTime()).toBe(date.getTime());
  });

  it('returns null for missing or unparseable values instead of an Invalid Date', () => {
    // An Invalid Date would poison the arithmetic silently (NaN comparisons are
    // always false → every guard rail would pass).
    expect(parseDbTime(null)).toBeNull();
    expect(parseDbTime(undefined)).toBeNull();
    expect(parseDbTime('not a date')).toBeNull();
    expect(parseDbTime('[object Object]')).toBeNull();
    expect(toDbTime(null)).toBeNull();
  });
});
