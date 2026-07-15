/**
 * Single source of truth for the miner power modes.
 *
 * Every consumer reads from here — the automation rule validation, the
 * `miner.mode` signal descriptor, and (through that descriptor) the UI. Do not
 * re-list these anywhere else.
 *
 * Apollo III adds a mode the other devices do not have. When the device wiring
 * lands, make this device-aware in this one place (e.g. read the chassis/miner
 * env) and every consumer follows automatically.
 */
const MINER_MODES = ['eco', 'balanced', 'turbo', 'custom'];

module.exports = { MINER_MODES };
