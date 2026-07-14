const { decide } = require('../src/services/automation/engine');
const signals = require('../src/services/signals');

const descriptors = signals.descriptorsById();

const baseConfig = {
  enabled: true,
  fallbackAction: 'keep',
  defaultHysteresis: 2,
};

const baseState = {
  running: true,
  mode: 'balanced',
  activeRuleId: null,
  overrideUntil: null,
};

// Signals as the registry produces them: { value, stale }
const sig = (values) =>
  Object.fromEntries(
    Object.entries(values).map(([id, value]) => [
      id,
      value === null ? { value: null, stale: true } : { value, stale: false },
    ])
  );

const rule = (overrides) => ({
  id: 1,
  name: 'rule',
  enabled: true,
  priority: 100,
  is_safety: false,
  match: 'all',
  conditions: [],
  action: { type: 'off' },
  ...overrides,
});

const run = (opts) =>
  decide({
    now: new Date('2026-07-14T12:00:00Z'),
    config: baseConfig,
    state: baseState,
    descriptors,
    ...opts,
  });

describe('automation engine — decide()', () => {
  it('matches a simple time-window rule', () => {
    const result = run({
      signals: sig({ 'clock.time': '23:30' }),
      rules: [
        rule({
          conditions: [{ signal: 'clock.time', op: 'between', values: ['23:00', '07:00'] }],
          action: { type: 'mode', mode: 'turbo' },
        }),
      ],
    });

    expect(result.target).toEqual({ type: 'mode', mode: 'turbo' });
    expect(result.reason).toBe('rule');
  });

  it('handles time windows that wrap past midnight', () => {
    const conditions = [{ signal: 'clock.time', op: 'between', values: ['23:00', '07:00'] }];
    const rules = [rule({ conditions, action: { type: 'mode', mode: 'turbo' } })];

    expect(run({ signals: sig({ 'clock.time': '02:00' }), rules }).target).toEqual({
      type: 'mode',
      mode: 'turbo',
    });
    expect(run({ signals: sig({ 'clock.time': '12:00' }), rules }).target).toBeNull();
  });

  it('lets the lowest priority number win', () => {
    const result = run({
      signals: sig({ 'miner.temperature': 60 }),
      rules: [
        rule({
          id: 2,
          priority: 200,
          conditions: [{ signal: 'miner.temperature', op: '<', value: 70 }],
          action: { type: 'mode', mode: 'eco' },
        }),
        rule({
          id: 1,
          priority: 10,
          conditions: [{ signal: 'miner.temperature', op: '<', value: 70 }],
          action: { type: 'mode', mode: 'turbo' },
        }),
      ],
    });

    expect(result.ruleId).toBe(1);
    expect(result.target).toEqual({ type: 'mode', mode: 'turbo' });
  });

  it('does not match a rule whose signal is stale — it fails safe', () => {
    const result = run({
      // The miner is off, so there is no board temperature to read.
      signals: sig({ 'miner.temperature': null }),
      rules: [
        rule({
          conditions: [{ signal: 'miner.temperature', op: '>', value: 80 }],
          action: { type: 'off' },
        }),
      ],
    });

    expect(result.target).toBeNull();
    expect(result.reason).toBe('fallback');
    expect(result.evaluated[0]).toMatchObject({ matched: false, unevaluable: true, why: 'stale_signal' });
  });

  it('requires every condition with match: all', () => {
    const conditions = [
      { signal: 'clock.time', op: 'between', values: ['09:00', '18:00'] },
      { signal: 'sun.isDay', op: '==', value: 'true' },
    ];

    expect(
      run({ signals: sig({ 'clock.time': '10:00', 'sun.isDay': true }), rules: [rule({ conditions })] }).target
    ).toEqual({ type: 'off' });

    expect(
      run({ signals: sig({ 'clock.time': '10:00', 'sun.isDay': false }), rules: [rule({ conditions })] }).target
    ).toBeNull();
  });

  it('accepts a single condition with match: any, even if another is stale', () => {
    const result = run({
      signals: sig({ 'energy.price': null, 'clock.time': '03:00' }),
      rules: [
        rule({
          match: 'any',
          conditions: [
            { signal: 'energy.price', op: '<', value: 0.1 },
            { signal: 'clock.time', op: 'between', values: ['23:00', '07:00'] },
          ],
          action: { type: 'mode', mode: 'turbo' },
        }),
      ],
    });

    expect(result.target).toEqual({ type: 'mode', mode: 'turbo' });
  });

  describe('hysteresis', () => {
    // "Stop above 80°C, resume below 75°C" — the threshold is sticky while the
    // rule that set it is the one in charge.
    const safetyRule = rule({
      id: 7,
      is_safety: true,
      conditions: [{ signal: 'miner.temperature', op: '>', value: 80, hysteresis: 5 }],
      action: { type: 'off' },
    });

    it('trips at the threshold', () => {
      const result = run({ signals: sig({ 'miner.temperature': 81 }), rules: [safetyRule] });
      expect(result.target).toEqual({ type: 'off' });
    });

    it('keeps holding between Y and X while it is the active rule', () => {
      const result = run({
        signals: sig({ 'miner.temperature': 77 }), // below 80, still above 75
        state: { ...baseState, running: false, activeRuleId: 7 },
        rules: [safetyRule],
      });
      expect(result.target).toEqual({ type: 'off' });
    });

    it('releases below the lower bound', () => {
      const result = run({
        signals: sig({ 'miner.temperature': 74 }),
        state: { ...baseState, running: false, activeRuleId: 7 },
        rules: [safetyRule],
      });
      expect(result.target).toBeNull();
      expect(result.reason).toBe('fallback');
    });

    it('does not stick for a rule that is not the active one', () => {
      const result = run({
        signals: sig({ 'miner.temperature': 77 }),
        state: { ...baseState, activeRuleId: 999 },
        rules: [safetyRule],
      });
      expect(result.target).toBeNull();
    });
  });

  describe('override', () => {
    const overridden = {
      ...baseState,
      overrideUntil: new Date('2026-07-14T13:00:00Z'), // one hour ahead of `now`
    };

    it('pauses normal rules', () => {
      const result = run({
        state: overridden,
        signals: sig({ 'clock.time': '12:00' }),
        rules: [
          rule({
            conditions: [{ signal: 'clock.time', op: 'between', values: ['00:00', '23:59'] }],
            action: { type: 'mode', mode: 'turbo' },
          }),
        ],
      });

      expect(result.target).toBeNull();
      expect(result.reason).toBe('override');
    });

    it('never pauses a safety rule', () => {
      const result = run({
        state: overridden,
        signals: sig({ 'miner.temperature': 95 }),
        rules: [
          rule({
            id: 7,
            is_safety: true,
            conditions: [{ signal: 'miner.temperature', op: '>', value: 80 }],
            action: { type: 'off' },
          }),
        ],
      });

      expect(result.target).toEqual({ type: 'off' });
      expect(result.reason).toBe('safety');
      expect(result.bypassGuards).toBe(true);
    });

    it('expires', () => {
      const result = run({
        state: { ...baseState, overrideUntil: new Date('2026-07-14T11:00:00Z') }, // in the past
        signals: sig({ 'clock.time': '12:00' }),
        rules: [
          rule({
            conditions: [{ signal: 'clock.time', op: 'between', values: ['00:00', '23:59'] }],
            action: { type: 'mode', mode: 'eco' },
          }),
        ],
      });

      expect(result.target).toEqual({ type: 'mode', mode: 'eco' });
    });
  });

  describe('fallback', () => {
    it('keeps the miner alone by default', () => {
      const result = run({ signals: sig({ 'clock.time': '12:00' }), rules: [] });
      expect(result.target).toBeNull();
      expect(result.reason).toBe('fallback');
    });

    it('can be told to stop the miner when nothing matches', () => {
      const result = run({
        config: { ...baseConfig, fallbackAction: 'off' },
        signals: sig({ 'clock.time': '12:00' }),
        rules: [],
      });
      expect(result.target).toEqual({ type: 'off' });
    });

    it('can be told to run at a given mode', () => {
      const result = run({
        config: { ...baseConfig, fallbackAction: 'on:eco' },
        signals: sig({ 'clock.time': '12:00' }),
        rules: [],
      });
      expect(result.target).toEqual({ type: 'mode', mode: 'eco' });
    });
  });

  it('ignores disabled rules', () => {
    const result = run({
      signals: sig({ 'clock.time': '12:00' }),
      rules: [
        rule({
          enabled: false,
          conditions: [{ signal: 'clock.time', op: 'between', values: ['00:00', '23:59'] }],
          action: { type: 'off' },
        }),
      ],
    });

    expect(result.target).toBeNull();
    expect(result.evaluated).toHaveLength(0);
  });

  it('matches weekdays with in / not_in', () => {
    const rules = [
      rule({
        conditions: [{ signal: 'clock.weekday', op: 'in', values: ['6', '7'] }],
        action: { type: 'mode', mode: 'turbo' },
      }),
    ];

    expect(run({ signals: sig({ 'clock.weekday': 6 }), rules }).target).toEqual({
      type: 'mode',
      mode: 'turbo',
    });
    expect(run({ signals: sig({ 'clock.weekday': 2 }), rules }).target).toBeNull();
  });
});
