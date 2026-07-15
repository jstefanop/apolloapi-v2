/**
 * Current miner state — running and active mode.
 *
 * These are not really "sources": they describe what the miner is doing right
 * now. They are exposed as signals so rules can reference them (e.g. "if
 * running and temperature > 80"), and the engine also uses them as its state.
 */

const { MINER_MODES } = require('../../constants/minerModes');

module.exports = {
  namespace: 'miner',

  descriptors: [
    { id: 'miner.running', type: 'boolean', widget: 'boolean', ops: ['==', '!='], supportsHysteresis: false },
    {
      id: 'miner.mode',
      type: 'string',
      widget: 'enum',
      // The single source of truth for the mode list — the UI reads it from here.
      options: MINER_MODES,
      ops: ['==', '!='],
      supportsHysteresis: false,
    },
  ],

  async read({ knex, deps }) {
    const [status, settings] = await Promise.all([
      knex('service_status').select('status').where({ service_name: 'miner' }).first(),
      deps.settings.read(),
    ]);

    return {
      'miner.running': { value: status?.status === 'online' },
      'miner.mode': { value: settings?.minerMode ?? null, stale: !settings },
    };
  },
};
