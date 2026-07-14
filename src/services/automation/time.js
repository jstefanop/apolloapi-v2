/**
 * Timestamps in and out of SQLite.
 *
 * The guard rails are arithmetic on time ("stopped 12 minutes ago"), so a
 * timestamp read back wrong is not a cosmetic bug: it silently disables the
 * protections. Two traps, both handled here:
 *
 *  - SQLite's CURRENT_TIMESTAMP (knex.fn.now()) returns 'YYYY-MM-DD HH:MM:SS'
 *    in UTC, with no timezone marker. `new Date()` on that string reads it as
 *    *local* time — two hours off in Rome, and the sign flips in winter.
 *  - The same column may come back as a number (a Date bound by knex), a string
 *    (CURRENT_TIMESTAMP or an ISO string we wrote), or NULL.
 *
 * We therefore write ISO-8601 UTC strings and read every shape defensively.
 */

const HAS_TIMEZONE = /[zZ]|[+-]\d{2}:?\d{2}$/;

function parseDbTime(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);

  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return new Date(Number(value));

    const normalized = HAS_TIMEZONE.test(value) ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function toDbTime(date) {
  if (!date) return null;
  const value = date instanceof Date ? date : new Date(date);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

module.exports = { parseDbTime, toDbTime };
