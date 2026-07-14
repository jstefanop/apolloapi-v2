/**
 * Turning a decision into miner commands.
 *
 * This is the only place in the automation that has side effects, and it reuses
 * the same services the UI drives — there is no second, private way to move the
 * miner.
 *
 *   target        current state          action
 *   ------------  --------------------   ----------------------------------------
 *   off           running                miner.stop()
 *   mode:X        stopped                settings.update({minerMode:X}) + miner.start()
 *   mode:X        running, mode != X     settings.update({minerMode:X}) + miner.restart()
 *   mode:X        running, mode == X     nothing
 *
 * Changing mode means restarting apollo-miner: the configurator regenerates its
 * CLI arguments, exactly as the settings page does today. It costs minutes of
 * downtime, which is why min_change_minutes exists in the guard rails.
 */

// Miner commands carry their origin: a *user* start/stop pauses the automation
// (see miner.js), so commands coming from here must say so, or the engine would
// suspend itself the first time it acted.
const SOURCE = { source: 'automation' };

/**
 * apply({ target, changeType, deps }) -> { changeType, mode }
 *
 * Throws on failure; the caller records the failure in the event log.
 */
async function apply({ target, changeType, deps }) {
  if (!target || !changeType) return { changeType: null };

  if (changeType === 'stop') {
    await deps.miner.stop(SOURCE);
    return { changeType };
  }

  // 'start' and 'mode' both need the settings to reflect the requested preset
  // before the miner (re)starts, otherwise it would come back on the old one.
  const settings = await deps.settings.read();

  if (settings?.minerMode !== target.mode) {
    // Only the mode moves. `custom` keeps whatever voltage/frequency the user
    // already saved: a rule picks a preset, it does not invent tuning values.
    await deps.settings.update({ minerMode: target.mode });
  }

  if (changeType === 'start') {
    await deps.miner.start(SOURCE);
  } else {
    await deps.miner.restart(SOURCE);
  }

  return { changeType, mode: target.mode };
}

module.exports = { apply, SOURCE };
