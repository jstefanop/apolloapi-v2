/**
 * Sun signals — computed locally from latitude/longitude (suncalc), no network.
 *
 * Without coordinates there is nothing to compute, so every signal reports as
 * stale: rules that depend on them will not match instead of silently matching
 * on a wrong default.
 */
const SunCalc = require('suncalc');

const STALE = { value: null, stale: true };

// Minutes from `now` to the next occurrence of the given event, looking at
// tomorrow when today's has already passed (so the value is always positive
// and "30 minutes before sunset" fires once a day, not all night long).
function minutesToNext(now, latitude, longitude, key) {
  const today = SunCalc.getTimes(now, latitude, longitude)[key];
  const target =
    today && today > now
      ? today
      : SunCalc.getTimes(new Date(now.getTime() + 24 * 3600 * 1000), latitude, longitude)[key];

  if (!target || Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

module.exports = {
  namespace: 'sun',

  descriptors: [
    { id: 'sun.isDay', type: 'boolean', widget: 'boolean', ops: ['==', '!='], supportsHysteresis: false },
    { id: 'sun.minutesToSunset', type: 'number', widget: 'number', unit: 'min', ops: ['<', '<=', '>', '>='], supportsHysteresis: true },
    { id: 'sun.minutesToSunrise', type: 'number', widget: 'number', unit: 'min', ops: ['<', '<=', '>', '>='], supportsHysteresis: true },
  ],

  async read({ now, config }) {
    const { latitude, longitude } = config;
    if (latitude == null || longitude == null) {
      return {
        'sun.isDay': STALE,
        'sun.minutesToSunset': STALE,
        'sun.minutesToSunrise': STALE,
      };
    }

    const { sunrise, sunset } = SunCalc.getTimes(now, latitude, longitude);

    // Polar day/night: suncalc returns Invalid Date when the sun never rises or
    // never sets. isDay is still meaningful (altitude), the countdowns are not.
    const hasTimes =
      sunrise && sunset && !Number.isNaN(sunrise.getTime()) && !Number.isNaN(sunset.getTime());

    const isDay = hasTimes
      ? now >= sunrise && now <= sunset
      : SunCalc.getPosition(now, latitude, longitude).altitude > 0;

    return {
      'sun.isDay': { value: isDay },
      'sun.minutesToSunset': hasTimes
        ? { value: minutesToNext(now, latitude, longitude, 'sunset') }
        : STALE,
      'sun.minutesToSunrise': hasTimes
        ? { value: minutesToNext(now, latitude, longitude, 'sunrise') }
        : STALE,
    };
  },
};
