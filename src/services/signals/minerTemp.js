/**
 * Board temperature signals — the hottest and the mean board, read from the
 * miner stat files (same shape the scheduler already consumes).
 *
 * This is the temperature of the *miner*, not of the room: it is good for
 * thermal protection ("stop above X°C, resume below Y°C"), not for a room
 * thermostat. See docs-ai/MINER_SCHEDULING.md §4b.
 *
 * A miner that is off or unreadable reports as stale, never as 0 — a rule that
 * reads a stale signal does not match, so we never stop a miner because we
 * failed to read its temperature.
 */

const STALE = { value: null, stale: true };

module.exports = {
  namespace: 'miner',

  descriptors: [
    {
      id: 'miner.temperature',
      type: 'number',
      unit: '°C',
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    },
    {
      id: 'miner.temperatureAvg',
      type: 'number',
      unit: '°C',
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    },
  ],

  async read({ deps }) {
    let stats;
    try {
      ({ stats } = await deps.miner.getStats());
    } catch (e) {
      return { 'miner.temperature': STALE, 'miner.temperatureAvg': STALE };
    }

    const temps = (stats || [])
      .map((board) => board?.slots?.int_0?.temperature)
      .filter((t) => Number.isFinite(t) && t > 0);

    if (!temps.length) return { 'miner.temperature': STALE, 'miner.temperatureAvg': STALE };

    const mean = temps.reduce((a, b) => a + b, 0) / temps.length;

    return {
      'miner.temperature': { value: Math.max(...temps) },
      'miner.temperatureAvg': { value: Math.round(mean * 10) / 10 },
    };
  },
};
