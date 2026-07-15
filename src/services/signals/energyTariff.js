/**
 * Energy price signals, derived from the tariff the user typed in by hand.
 *
 * There is no free worldwide electricity-price API, so manual entry is the
 * baseline that works everywhere with no key and no network. Spot-price
 * providers (ENTSO-E & co.) are phase 2 and will plug in as extra providers.
 *
 * Tariff shape (JSON in automation_config.tariff):
 *   {
 *     currency: 'EUR',
 *     flatPrice: 0.25,
 *     periods: [
 *       { days: [1,2,3,4,5], from: '23:00', to: '07:00', price: 0.12, band: 'night' }
 *     ]
 *   }
 * The first matching period wins; with no match the flat price applies.
 */

const { localParts } = require('./clock');

const STALE = { value: null, stale: true };

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// Windows may wrap past midnight (23:00 → 07:00), in which case the two halves
// live on different weekdays: a Friday-night window is still "Friday" at 01:00
// on Saturday. We match the day on the *start* of the window.
function matchesPeriod(period, nowMinutes, weekday) {
  const from = toMinutes(period.from);
  const to = toMinutes(period.to);
  const wraps = from > to;

  const inWindow = wraps ? nowMinutes >= from || nowMinutes < to : nowMinutes >= from && nowMinutes < to;
  if (!inWindow) return false;

  if (!period.days || !period.days.length) return true;

  // After midnight inside a wrapping window we are still in the previous day's period.
  const effectiveDay = wraps && nowMinutes < to ? ((weekday + 5) % 7) + 1 : weekday;
  return period.days.includes(effectiveDay);
}

module.exports = {
  namespace: 'energy',

  descriptors: [
    {
      id: 'energy.price',
      type: 'number',
      widget: 'number',
      unit: 'currency/kWh',
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    },
    {
      id: 'energy.band',
      type: 'string',
      // The options are the user's own tariff band names, not a fixed list, so
      // the UI sources them from the tariff rather than from a static `options`.
      widget: 'band',
      ops: ['==', '!=', 'in', 'not_in'],
      supportsHysteresis: false,
    },
  ],

  async read({ now, config }) {
    let tariff = config.tariff;
    if (typeof tariff === 'string') {
      try {
        tariff = JSON.parse(tariff);
      } catch (e) {
        tariff = null;
      }
    }

    if (!tariff || (tariff.flatPrice == null && !tariff.periods?.length)) {
      return { 'energy.price': STALE, 'energy.band': STALE };
    }

    const { time, weekday } = localParts(now, config.timezone || undefined);
    const nowMinutes = toMinutes(time);

    const period = (tariff.periods || []).find((p) => matchesPeriod(p, nowMinutes, weekday));

    const price = period ? period.price : tariff.flatPrice;
    if (price == null) return { 'energy.price': STALE, 'energy.band': STALE };

    return {
      'energy.price': { value: price },
      'energy.band': { value: period?.band || 'flat' },
    };
  },

  matchesPeriod,
};
