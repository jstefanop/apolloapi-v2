/**
 * Weather signals from Open-Meteo — free, no API key, global.
 *
 * The headline Phase-2 scenario: PV owners run the miner when it is actually
 * sunny (low cloud cover / high solar radiation), and everyone can gate on the
 * outdoor temperature. Uses the same lat/long the user set in Settings, so no
 * new config; without coordinates the signals are stale, like the sun signals.
 *
 * Lazily cached: a read triggers a background refresh when the cache is old and
 * returns the last value meanwhile — the network call never blocks the tick.
 */
const axios = require('axios');

const STALE = { value: null, stale: true };
const TTL_MS = 10 * 60 * 1000; // weather moves slowly; ~144 calls/day per device
const TIMEOUT_MS = 8000;

let cache = { at: 0, key: null, data: null };
let inflight = false;

async function refresh(latitude, longitude) {
  if (inflight) return;
  inflight = true;
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude}&longitude=${longitude}` +
      '&current=temperature_2m,cloud_cover,shortwave_radiation';
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS });
    const c = data && data.current;
    if (c) {
      cache = {
        at: Date.now(),
        key: `${latitude},${longitude}`,
        data: {
          temperature: c.temperature_2m,
          cloudCover: c.cloud_cover,
          solarRadiation: c.shortwave_radiation,
        },
      };
    }
  } catch (e) {
    // Leave the previous value in place; the signals go stale only if there was
    // never one (see read()).
  } finally {
    inflight = false;
  }
}

function staleAll() {
  return {
    'weather.temperature': STALE,
    'weather.cloudCover': STALE,
    'weather.solarRadiation': STALE,
  };
}

module.exports = {
  namespace: 'weather',

  descriptors: [
    // °C so the UI shows/accepts it in the user's temperature unit, like the
    // board temperature.
    { id: 'weather.temperature', type: 'number', widget: 'number', unit: '°C', ops: ['<', '<=', '>', '>='], supportsHysteresis: true },
    { id: 'weather.cloudCover', type: 'number', widget: 'number', unit: '%', ops: ['<', '<=', '>', '>='], supportsHysteresis: true },
    { id: 'weather.solarRadiation', type: 'number', widget: 'number', unit: 'W/m²', ops: ['<', '<=', '>', '>='], supportsHysteresis: true },
  ],

  async read({ config }) {
    const { latitude, longitude } = config;
    if (latitude == null || longitude == null) return staleAll();

    const key = `${latitude},${longitude}`;
    // Refresh in the background when the cache is old or the location changed.
    if (cache.key !== key || Date.now() - cache.at > TTL_MS) {
      refresh(latitude, longitude);
    }

    if (!cache.data || cache.key !== key) return staleAll();

    return {
      'weather.temperature': { value: cache.data.temperature },
      'weather.cloudCover': { value: cache.data.cloudCover },
      'weather.solarRadiation': { value: cache.data.solarRadiation },
    };
  },

  // Exposed for tests.
  _refresh: refresh,
  _reset: () => {
    cache = { at: 0, key: null, data: null };
    inflight = false;
  },
};
