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
      widget: 'number',
      unit: '°C',
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    },
    {
      id: 'miner.temperatureAvg',
      type: 'number',
      widget: 'number',
      unit: '°C',
      ops: ['<', '<=', '>', '>='],
      supportsHysteresis: true,
    },
  ],

  async read({ knex, deps }) {
    // A reading is "pending" (show a spinner, not "no data") when the miner is
    // running or starting but its stats have not arrived yet; when it is off there
    // is genuinely no board temperature, so leave it a plain stale.
    let pending = false;
    try {
      const row = await knex('service_status').select('status').where({ service_name: 'miner' }).first();
      pending = row?.status === 'online' || row?.status === 'pending';
    } catch (e) {
      /* leave pending false */
    }
    const stale = pending ? { value: null, stale: true, pending: true } : STALE;

    let stats;
    try {
      ({ stats } = await deps.miner.getStats());
    } catch (e) {
      return { 'miner.temperature': stale, 'miner.temperatureAvg': stale };
    }

    // The stat file reports temperature as a string ("62.43"), so coerce before
    // checking — Number.isFinite('62.43') is false, which used to drop every
    // reading and leave the signal stale even with the miner running.
    const temps = (stats || [])
      .map((board) => Number(board?.slots?.int_0?.temperature))
      .filter((t) => Number.isFinite(t) && t > 0);

    if (!temps.length) return { 'miner.temperature': stale, 'miner.temperatureAvg': stale };

    const mean = temps.reduce((a, b) => a + b, 0) / temps.length;

    return {
      'miner.temperature': { value: Math.max(...temps) },
      'miner.temperatureAvg': { value: Math.round(mean * 10) / 10 },
    };
  },
};
