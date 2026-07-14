/**
 * Clock signals — time of day, weekday, date. Zero dependencies, never stale.
 *
 * All values are computed in the configured timezone (falling back to the
 * device timezone) so a rule written as "23:00 → 07:00" means what the user
 * sees on the wall, not UTC.
 */

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// ISO weekday (Mon = 1 … Sun = 7), local HH:mm and YYYY-MM-DD for a timezone.
function localParts(now, timeZone) {
  const opts = { timeZone, hour12: false };
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...opts,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  // 24:00 is a valid en-GB rendering of midnight — normalize it.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return {
    time: `${hour}:${get('minute')}`,
    weekday: WEEKDAYS[get('weekday')] || null,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

module.exports = {
  namespace: 'clock',

  descriptors: [
    {
      id: 'clock.time',
      type: 'time',
      ops: ['between', 'not_between', '<', '>'],
      supportsHysteresis: false,
    },
    {
      id: 'clock.weekday',
      type: 'number',
      ops: ['in', 'not_in', '==', '!='],
      supportsHysteresis: false,
    },
    {
      id: 'clock.date',
      type: 'string',
      ops: ['==', '!=', 'between'],
      supportsHysteresis: false,
    },
  ],

  async read({ now, config }) {
    // No explicit timezone means "follow the device": passing undefined lets Intl
    // use the system zone, so fixing it in Settings fixes the rules too.
    const { time, weekday, date } = localParts(now, config.timezone || undefined);
    return {
      'clock.time': { value: time },
      'clock.weekday': { value: weekday },
      'clock.date': { value: date },
    };
  },

  localParts,
};
