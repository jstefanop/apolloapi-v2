const { canApply, changeTypeFor } = require('../src/services/automation/guards');

const now = new Date('2026-07-14T12:00:00Z');
const minutesAgo = (m) => new Date(now.getTime() - m * 60 * 1000);

const config = {
  minOnMinutes: 30,
  minOffMinutes: 30,
  minChangeMinutes: 15,
  maxCyclesPerHour: 2,
};

const state = {
  running: true,
  mode: 'balanced',
  lastChangeAt: minutesAgo(120),
  lastStartAt: minutesAgo(120),
  lastStopAt: minutesAgo(300),
  cyclesLastHour: 0,
};

const decision = (target, extra = {}) => ({ target, reason: 'rule', bypassGuards: false, ...extra });

describe('automation guard rails', () => {
  describe('changeTypeFor', () => {
    it('is a no-op when the miner already sits at the target', () => {
      expect(changeTypeFor({ type: 'mode', mode: 'balanced' }, state)).toBeNull();
      expect(changeTypeFor({ type: 'off' }, { ...state, running: false })).toBeNull();
    });

    it('classifies the change', () => {
      expect(changeTypeFor({ type: 'off' }, state)).toBe('stop');
      expect(changeTypeFor({ type: 'mode', mode: 'eco' }, state)).toBe('mode');
      expect(changeTypeFor({ type: 'mode', mode: 'eco' }, { ...state, running: false })).toBe('start');
    });
  });

  it('applies a legitimate change', () => {
    const result = canApply({ decision: decision({ type: 'off' }), state, config, now });
    expect(result).toMatchObject({ apply: true, changeType: 'stop', blockedBy: null });
  });

  it('does nothing when there is no target', () => {
    const result = canApply({ decision: decision(null, { reason: 'override' }), state, config, now });
    expect(result.apply).toBe(false);
    expect(result.blockedBy).toBeNull(); // not blocked — simply nothing to do
  });

  it('does nothing when the miner is already in the target state', () => {
    const result = canApply({
      decision: decision({ type: 'mode', mode: 'balanced' }),
      state,
      config,
      now,
    });
    expect(result).toMatchObject({ apply: false, changeType: null, blockedBy: null });
  });

  it('blocks a change that comes too soon after the previous one', () => {
    const result = canApply({
      decision: decision({ type: 'off' }),
      state: { ...state, lastChangeAt: minutesAgo(5) },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: false, blockedBy: 'min_change' });
  });

  it('blocks a stop before the minimum on-time', () => {
    const result = canApply({
      decision: decision({ type: 'off' }),
      state: { ...state, lastChangeAt: minutesAgo(20), lastStartAt: minutesAgo(20) },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: false, blockedBy: 'min_on' });
  });

  it('blocks a start before the minimum off-time', () => {
    const result = canApply({
      decision: decision({ type: 'mode', mode: 'eco' }),
      state: { ...state, running: false, lastChangeAt: minutesAgo(20), lastStopAt: minutesAgo(20) },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: false, blockedBy: 'min_off' });
  });

  it('blocks a start once the hourly cycle budget is spent', () => {
    const result = canApply({
      decision: decision({ type: 'mode', mode: 'eco' }),
      state: {
        ...state,
        running: false,
        lastChangeAt: minutesAgo(60),
        lastStopAt: minutesAgo(60),
        cyclesLastHour: 2,
      },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: false, blockedBy: 'max_cycles' });
  });

  it('lets a safety rule through every guard rail — a cooking board stops now', () => {
    const result = canApply({
      decision: decision({ type: 'off' }, { reason: 'safety', bypassGuards: true }),
      state: { ...state, lastChangeAt: minutesAgo(1), lastStartAt: minutesAgo(1) },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: true, changeType: 'stop' });
  });

  it('does not resurrect a miner that is already off, even for a safety rule', () => {
    const result = canApply({
      decision: decision({ type: 'off' }, { reason: 'safety', bypassGuards: true }),
      state: { ...state, running: false },
      config,
      now,
    });
    expect(result.apply).toBe(false);
  });

  it('treats a never-touched miner as eligible (no last-change timestamp)', () => {
    const result = canApply({
      decision: decision({ type: 'mode', mode: 'eco' }),
      state: {
        running: false,
        mode: 'balanced',
        lastChangeAt: null,
        lastStartAt: null,
        lastStopAt: null,
        cyclesLastHour: 0,
      },
      config,
      now,
    });
    expect(result).toMatchObject({ apply: true, changeType: 'start' });
  });
});
