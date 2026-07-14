/**
 * Current miner state — running and active mode.
 *
 * These are not really "sources": they describe what the miner is doing right
 * now. They are exposed as signals so rules can reference them (e.g. "if
 * running and temperature > 80"), and the engine also uses them as its state.
 */

module.exports = {
  namespace: 'miner',

  descriptors: [
    { id: 'miner.running', type: 'boolean', ops: ['==', '!='], supportsHysteresis: false },
    { id: 'miner.mode', type: 'string', ops: ['==', '!=', 'in'], supportsHysteresis: false },
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
