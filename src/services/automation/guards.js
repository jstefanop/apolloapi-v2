/**
 * Hardware guard rails — also a pure function.
 *
 * The engine says what it wants; this says whether the miner can take it right
 * now. ASICs and power supplies dislike fast cycling, and changing mode means
 * restarting apollo-miner, which takes minutes to settle. Without these limits
 * a noisy signal would cycle the hardware all day.
 *
 * Every block is reported (not swallowed) so the UI can tell the user the
 * difference between "your rule is broken" and "your rule is being throttled to
 * protect the hardware".
 */

const MINUTE = 60 * 1000;

function minutesSince(date, now) {
  if (!date) return Infinity;
  return (now.getTime() - new Date(date).getTime()) / MINUTE;
}

/**
 * What kind of change does reaching `target` require, given the current state?
 * Returns null when the miner is already where we want it (a no-op, not a block).
 */
function changeTypeFor(target, state) {
  if (!target) return null;
  if (target.type === 'off') return state.running ? 'stop' : null;
  if (target.type === 'mode') {
    if (!state.running) return 'start';
    return state.mode === target.mode ? null : 'mode';
  }
  return null;
}

/**
 * canApply({ decision, state, config, now })
 *   -> { apply, changeType, blockedBy, message }
 *
 * state: { running, mode, lastChangeAt, lastStartAt, lastStopAt, cyclesLastHour }
 */
function canApply({ decision, state, config, now }) {
  const changeType = changeTypeFor(decision.target, state);

  if (!decision.target) {
    return { apply: false, changeType: null, blockedBy: null, message: `no target (${decision.reason})` };
  }

  if (!changeType) {
    return { apply: false, changeType: null, blockedBy: null, message: 'miner already in target state' };
  }

  // Safety rules bypass the guard rails: if the board is cooking, it stops. Now.
  if (decision.bypassGuards) {
    return { apply: true, changeType, blockedBy: null, message: 'safety rule bypasses guard rails' };
  }

  const sinceChange = minutesSince(state.lastChangeAt, now);
  if (sinceChange < config.minChangeMinutes) {
    return {
      apply: false,
      changeType,
      blockedBy: 'min_change',
      message: `last change ${Math.round(sinceChange)}m ago, minimum is ${config.minChangeMinutes}m`,
    };
  }

  if (changeType === 'stop') {
    const sinceStart = minutesSince(state.lastStartAt, now);
    if (sinceStart < config.minOnMinutes) {
      return {
        apply: false,
        changeType,
        blockedBy: 'min_on',
        message: `running for ${Math.round(sinceStart)}m, minimum on-time is ${config.minOnMinutes}m`,
      };
    }
  }

  if (changeType === 'start') {
    const sinceStop = minutesSince(state.lastStopAt, now);
    if (sinceStop < config.minOffMinutes) {
      return {
        apply: false,
        changeType,
        blockedBy: 'min_off',
        message: `stopped ${Math.round(sinceStop)}m ago, minimum off-time is ${config.minOffMinutes}m`,
      };
    }

    if (state.cyclesLastHour >= config.maxCyclesPerHour) {
      return {
        apply: false,
        changeType,
        blockedBy: 'max_cycles',
        message: `${state.cyclesLastHour} starts in the last hour, maximum is ${config.maxCyclesPerHour}`,
      };
    }
  }

  return { apply: true, changeType, blockedBy: null, message: null };
}

module.exports = { canApply, changeTypeFor, minutesSince };
