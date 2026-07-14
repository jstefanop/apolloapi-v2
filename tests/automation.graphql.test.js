const { knex } = require('../src/db');
const { graphql } = require('graphql');
const schema = require('../src/graphql/schema');
const resolver = require('../src/graphql/resolvers/automation');
const subscriptions = require('../src/graphql/resolvers/subscriptions');
const { serializeState } = require('../src/graphql/serialize/automation');

const automation = require('../src/services/automation')(knex, {
  miner: {
    getStats: jest.fn().mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 70 } } }] }),
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
  },
  settings: {
    read: jest.fn().mockResolvedValue({ minerMode: 'balanced' }),
    update: jest.fn(),
  },
});

const context = { services: { automation } };
const actions = resolver.AutomationActions;

beforeEach(async () => {
  await knex('automation_events').del();
  await knex('automation_rules').del();
  await knex('automation_config').where({ id: 1 }).update({
    enabled: false,
    dry_run: true,
    tariff: null,
    override_until: null,
    override_reason: null,
  });
});

describe('automation schema', () => {
  it('builds — the types compose with the rest of the schema', () => {
    expect(schema.getType('AutomationActions')).toBeDefined();
    expect(schema.getType('AutomationConfig')).toBeDefined();
    expect(schema.getQueryType().getFields().Automation).toBeDefined();
    expect(schema.getSubscriptionType().getFields().automation).toBeDefined();
  });

  it('puts every action behind @auth — none of this is public', async () => {
    const fields = schema.getType('AutomationActions').getFields();

    const unprotected = Object.values(fields).filter(
      (field) => !field.astNode.directives.some((d) => d.name.value === 'auth')
    );

    expect(unprotected).toEqual([]);
  });

  it('rejects an unauthenticated query at the directive, not at the resolver', async () => {
    const result = await graphql({
      schema,
      source: '{ Automation { config { result { enabled } } } }',
      contextValue: { services: { automation } }, // no user
    });

    expect(result.errors?.[0].message).toMatch(/auth/i);
  });
});

describe('automation resolvers', () => {
  it('round-trips a rule: GraphQL input → DB → GraphQL output', async () => {
    const input = {
      name: 'Thermal protection',
      isSafety: true,
      priority: 0,
      match: 'all',
      // Condition values travel as strings; the engine casts them by signal type.
      conditions: [{ signal: 'miner.temperature', op: '>', value: '80', hysteresis: 5 }],
      action: { type: 'mode', mode: 'eco' },
    };

    const created = await actions.createRule({}, { input }, context);

    expect(created.error).toBeNull();
    expect(created.result).toMatchObject({
      name: 'Thermal protection',
      isSafety: true, // camelCase out, is_safety in the DB
      match: 'all',
      action: { type: 'mode', mode: 'eco' },
    });
    expect(created.result.conditions[0]).toMatchObject({
      signal: 'miner.temperature',
      op: '>',
      value: '80',
      hysteresis: 5,
    });

    const listed = await actions.rules({}, {}, context);
    expect(listed.result).toHaveLength(1);
    expect(listed.result[0].isSafety).toBe(true);
  });

  it('returns a validation failure as an error field, not a thrown exception', async () => {
    const input = {
      name: 'Bad rule',
      conditions: [{ signal: 'solar.surplus', op: '>', value: '800' }],
      action: { type: 'off' },
    };

    const result = await actions.createRule({}, { input }, context);

    expect(result.result).toBeNull();
    expect(result.error.message).toMatch(/Unknown signal/);
  });

  it('describes the signals so the UI does not have to hardcode them', async () => {
    const { result } = await actions.signals({}, {}, context);

    const temperature = result.find((d) => d.id === 'miner.temperature');
    expect(temperature).toMatchObject({ type: 'number', unit: '°C', supportsHysteresis: true });
    expect(temperature.ops).toContain('>');
  });

  it('previews the current decision without acting on it', async () => {
    await actions.updateConfig({}, { input: { enabled: true } }, context);
    await actions.createRule(
      {},
      {
        input: {
          name: 'Always off',
          conditions: [{ signal: 'clock.time', op: 'between', values: ['00:00', '23:59'] }],
          action: { type: 'off' },
        },
      },
      context
    );
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    const { result } = await actions.state({}, {}, context);

    expect(result.enabled).toBe(true);
    expect(result.decision).toMatchObject({ target: 'off', ruleName: 'Always off', reason: 'rule' });
    expect(result.miner.running).toBe(true);

    // A preview must leave no trace in the log.
    const { result: events } = await actions.events({}, {}, context);
    expect(events).toHaveLength(0);
  });

  it('serializes stale signals as null, and says they are stale', async () => {
    await actions.updateConfig({}, { input: { enabled: true } }, context);

    const { result } = await actions.state({}, {}, context);
    const sunrise = result.signals.find((s) => s.id === 'sun.minutesToSunrise');

    // No coordinates configured.
    expect(sunrise).toMatchObject({ value: null, stale: true });
  });

  it('round-trips the tariff through the config', async () => {
    const tariff = {
      currency: 'EUR',
      flatPrice: 0.25,
      periods: [{ days: [1, 2, 3, 4, 5], from: '23:00', to: '07:00', price: 0.12, band: 'night' }],
    };

    const { result } = await actions.updateConfig({}, { input: { tariff } }, context);

    expect(result.tariff).toEqual(tariff);
  });

  it('sets and clears the override, and reports it as an ISO string', async () => {
    const set = await actions.setOverride({}, { input: { minutes: 30 } }, context);
    expect(typeof set.result.overrideUntil).toBe('string');
    expect(new Date(set.result.overrideUntil).getTime()).toBeGreaterThan(Date.now());

    const cleared = await actions.clearOverride({}, {}, context);
    expect(cleared.result.overrideUntil).toBeNull();
  });

  it('deletes a rule, and says so when it is not there', async () => {
    const created = await actions.createRule(
      {},
      {
        input: {
          name: 'Doomed',
          conditions: [{ signal: 'clock.weekday', op: 'in', values: ['6', '7'] }],
          action: { type: 'off' },
        },
      },
      context
    );

    expect((await actions.deleteRule({}, { id: created.result.id }, context)).error).toBeNull();
    expect((await actions.deleteRule({}, { id: 9999 }, context)).error.message).toMatch(/not found/);
  });
});

describe('automation subscription', () => {
  it('pushes the same shape the state query returns', () => {
    const evaluated = {
      enabled: true,
      dryRun: true,
      decision: {
        target: { type: 'off' },
        ruleId: 3,
        ruleName: 'Thermal protection',
        reason: 'safety',
      },
      guard: { apply: true, changeType: 'stop', blockedBy: null, message: 'would stop' },
      state: { running: true, mode: 'eco', lastChangeAt: null, cyclesLastHour: 0, overrideUntil: null },
      signals: { 'miner.temperature': { value: 88, stale: false } },
    };

    const pushed = subscriptions.Subscription.automation.resolve({
      automation: { result: evaluated, error: null },
    });

    expect(pushed.result).toEqual(serializeState(evaluated));
    expect(pushed.result.decision.target).toBe('off');
    expect(pushed.result.signals).toContainEqual({
      id: 'miner.temperature',
      value: '88',
      stale: false,
      error: null,
    });
  });

  it('forwards an error from a failed tick', () => {
    const pushed = subscriptions.Subscription.automation.resolve({
      automation: { result: null, error: { message: 'tick failed' } },
    });

    expect(pushed.result).toBeNull();
    expect(pushed.error.message).toBe('tick failed');
  });
});
