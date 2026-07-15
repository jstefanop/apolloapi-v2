const { knex } = require('../src/db');
const { toDbTime } = require('../src/services/automation/time');

// The native sqlite3 driver does not recognise a Date created inside Jest's VM
// realm (it stores it as "[object Object]"), so tests write timestamps the same
// way the service does: as explicit ISO-8601 UTC strings.
const dbTime = (date) => toDbTime(date);

// Fake miner/settings: the service must drive them, not know how they work.
const deps = {
  miner: {
    getStats: jest.fn().mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 65 } } }] }),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
  },
  settings: {
    read: jest.fn().mockResolvedValue({ minerMode: 'balanced' }),
    update: jest.fn().mockResolvedValue(undefined),
  },
};

const automation = require('../src/services/automation')(knex, deps);

const thermalProtection = {
  name: 'Thermal protection',
  is_safety: true,
  priority: 0,
  conditions: [{ signal: 'miner.temperature', op: '>', value: 80, hysteresis: 5 }],
  action: { type: 'off' },
};

beforeEach(async () => {
  await knex('automation_events').del();
  await knex('automation_rules').del();
  await knex('automation_config').where({ id: 1 }).update({
    enabled: false,
    dry_run: true,
    tariff: null,
    latitude: null,
    longitude: null,
    fallback_action: 'keep',
    override_until: null,
    override_reason: null,
    min_on_minutes: 30,
    min_off_minutes: 30,
    min_change_minutes: 15,
    max_cycles_per_hour: 2,
    default_hysteresis: 2,
  });

  deps.miner.getStats.mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 65 } } }] });
  deps.settings.read.mockResolvedValue({ minerMode: 'balanced' });
  deps.miner.start.mockResolvedValue(undefined);
  deps.miner.stop.mockResolvedValue(undefined);
  deps.miner.restart.mockResolvedValue(undefined);
  deps.settings.update.mockResolvedValue(undefined);
});

// Arrange an overheating miner that thermal protection wants to stop.
const overheating = async ({ dryRun }) => {
  await automation.updateConfig({ enabled: true, dryRun });
  await automation.createRule(thermalProtection);
  await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });
  deps.miner.getStats.mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 88 } } }] });
};

describe('automation service — config', () => {
  it('starts disabled: installing the update must not start moving miners', async () => {
    const config = await automation.getConfig();
    expect(config.enabled).toBe(false);
    expect(config.fallbackAction).toBe('keep');
  });

  it('round-trips the hand-entered tariff through the DB', async () => {
    const tariff = {
      currency: 'EUR',
      flatPrice: 0.25,
      periods: [{ days: [1, 2, 3, 4, 5], from: '23:00', to: '07:00', price: 0.12, band: 'night' }],
    };

    await automation.updateConfig({ tariff, enabled: true });
    const config = await automation.getConfig();

    expect(config.enabled).toBe(true);
    expect(config.tariff).toEqual(tariff);
  });

  it('sets and clears the manual override', async () => {
    const withOverride = await automation.setOverride({ minutes: 60, reason: 'manual' });
    expect(new Date(withOverride.overrideUntil).getTime()).toBeGreaterThan(Date.now());
    expect(withOverride.overrideReason).toBe('manual');

    const cleared = await automation.clearOverride();
    expect(cleared.overrideUntil).toBeNull();
  });
});

describe('automation service — rules', () => {
  it('creates, reads back and deletes a rule', async () => {
    const created = await automation.createRule(thermalProtection);

    expect(created.id).toBeDefined();
    expect(created.is_safety).toBe(true);
    expect(created.conditions).toEqual(thermalProtection.conditions);
    expect(created.action).toEqual({ type: 'off' });

    const rules = await automation.listRules();
    expect(rules).toHaveLength(1);

    await automation.deleteRule(created.id);
    expect(await automation.listRules()).toHaveLength(0);
  });

  it('orders rules by priority', async () => {
    await automation.createRule({ ...thermalProtection, name: 'late', priority: 200 });
    await automation.createRule({ ...thermalProtection, name: 'early', priority: 1 });

    const [first, second] = await automation.listRules();
    expect(first.name).toBe('early');
    expect(second.name).toBe('late');
  });

  it('updates a rule in place', async () => {
    const created = await automation.createRule(thermalProtection);
    const updated = await automation.updateRule(created.id, { enabled: false, priority: 5 });

    expect(updated.enabled).toBe(false);
    expect(updated.priority).toBe(5);
    expect(updated.name).toBe('Thermal protection'); // untouched
  });

  it('rejects a rule that names a signal we cannot read', async () => {
    await expect(
      automation.createRule({ ...thermalProtection, conditions: [{ signal: 'solar.surplus', op: '>', value: 800 }] })
    ).rejects.toThrow(/Unknown signal/);
  });

  it('rejects an operator the signal does not support', async () => {
    await expect(
      automation.createRule({
        ...thermalProtection,
        conditions: [{ signal: 'clock.weekday', op: '>', value: 3 }],
      })
    ).rejects.toThrow(/not valid/);
  });

  it('rejects an unknown miner mode', async () => {
    await expect(
      automation.createRule({ ...thermalProtection, action: { type: 'mode', mode: 'ludicrous' } })
    ).rejects.toThrow(/Unknown miner mode/);
  });

  it('rejects a rule with no conditions — it would match everything, forever', async () => {
    await expect(automation.createRule({ ...thermalProtection, conditions: [] })).rejects.toThrow(
      /at least one condition/
    );
  });
});

describe('automation service — evaluate (dry run)', () => {
  it('does not decide or log while disabled, but still reads the signals', async () => {
    await automation.createRule(thermalProtection);
    const result = await automation.evaluate();

    expect(result.enabled).toBe(false);
    expect(result.skipped).toBe('disabled');
    expect(await automation.listEvents()).toHaveLength(0);

    // Signals are still read so the "current conditions" panel works when off.
    expect(result.signals).toBeTruthy();
    expect(result.signals['clock.time']).toBeDefined();
    // …and they serialize for the UI even with the automation disabled.
    const { serializeState } = require('../src/graphql/serialize/automation');
    const out = serializeState(result);
    expect(out.enabled).toBe(false);
    expect(out.decision).toBeNull();
    expect(out.signals.length).toBeGreaterThan(0);
  });

  it('decides to stop an overheating miner, and says so without touching it', async () => {
    await overheating({ dryRun: true });

    const { decision, guard, applied, dryRun } = await automation.evaluate();

    expect(decision.target).toEqual({ type: 'off' });
    expect(decision.reason).toBe('safety');
    expect(guard).toMatchObject({ apply: true, changeType: 'stop' });

    // Dry-run is the default: the engine watches, it does not act.
    expect(applied).toBe(false);
    expect(dryRun).toBe(true);
    expect(deps.miner.stop).not.toHaveBeenCalled();

    const [event] = await automation.listEvents();
    expect(event).toMatchObject({ decision: 'off', changeType: 'stop', applied: false, dryRun: true });
    expect(event.signals['miner.temperature']).toBe(88);
  });

  it('actually stops the miner once dry-run is switched off', async () => {
    await overheating({ dryRun: false });

    const { applied } = await automation.evaluate();

    expect(applied).toBe(true);
    expect(deps.miner.stop).toHaveBeenCalledWith({ source: 'automation' });

    const [event] = await automation.listEvents();
    expect(event).toMatchObject({ applied: true, dryRun: false, changeType: 'stop' });
    expect(event.message).toMatch(/stop applied/);
  });

  it('returns the recorded event so the tick can push it to the UI live', async () => {
    await overheating({ dryRun: false });

    const { loggedEvent } = await automation.evaluate();
    expect(loggedEvent).toMatchObject({ decision: 'off', changeType: 'stop', applied: true });
    expect(loggedEvent.id).toBeDefined();
    expect(loggedEvent.createdAt).toBeTruthy();
  });

  it('returns no event on a quiet tick, so there is nothing to push', async () => {
    await automation.updateConfig({ enabled: true, dryRun: true }); // cool miner, no rules → fallback none
    await automation.evaluate(); // logs the first 'none'

    const { loggedEvent } = await automation.evaluate(); // unchanged → nothing recorded
    expect(loggedEvent).toBeFalsy();
  });

  it('re-reads the miner status after applying, so the push reflects the action', async () => {
    // The apply just started the miner; service_status is now online. The state
    // read before the apply said offline — the re-read corrects it.
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });
    const state = { running: false, mode: 'x' };
    const sig = { 'miner.running': { value: false, stale: false }, 'miner.mode': { value: 'x', stale: false } };

    await automation._refreshMinerStatus(state, sig);

    expect(state.running).toBe(true);
    expect(sig['miner.running'].value).toBe(true);
    expect(sig['miner.mode'].value).toBe('balanced'); // from settings.read()
  });

  it('records a failed command instead of pretending it worked', async () => {
    await overheating({ dryRun: false });
    deps.miner.stop.mockRejectedValue(new Error('systemd: unit not found'));

    const { applied, failure } = await automation.evaluate();

    expect(applied).toBe(false);
    expect(failure).toMatch(/unit not found/);

    const [event] = await automation.listEvents();
    expect(event.applied).toBe(false);
    expect(event.message).toMatch(/failed to stop/);
  });

  it('never touches the miner while blocked by a guard rail', async () => {
    await automation.updateConfig({ enabled: true, dryRun: false, fallbackAction: 'off' });
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({ status: 'online', requested_at: dbTime(new Date()) }); // started a moment ago

    const { applied, guard } = await automation.evaluate();

    expect(guard.blockedBy).toBe('min_change');
    expect(applied).toBe(false);
    expect(deps.miner.stop).not.toHaveBeenCalled();
  });

  it('previews a decision without acting or logging — for the UI "what would you do now?"', async () => {
    await overheating({ dryRun: false });

    const result = await automation.evaluate({ preview: true });

    expect(result.preview).toBe(true);
    expect(result.decision.target).toEqual({ type: 'off' });
    expect(deps.miner.stop).not.toHaveBeenCalled();
    expect(await automation.listEvents()).toHaveLength(0);
  });

  it('writes the decision to the journal, with the numbers behind it', async () => {
    // The dry-run phase is only useful if you can *read* what the engine thought,
    // and on a device that means `journalctl -u apollo-api | grep '[automation]'`.
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await overheating({ dryRun: true });
    await automation.evaluate();

    const line = spy.mock.calls.map(([m]) => m).find((m) => String(m).startsWith('[automation]'));

    expect(line).toContain('dry-run');
    expect(line).toContain('Thermal protection');
    expect(line).toContain('off');
    expect(line).toContain('miner.temperature=88'); // the evidence, not just the verdict

    spy.mockRestore();
  });

  it('leaves a cool miner alone', async () => {
    await automation.updateConfig({ enabled: true });
    await automation.createRule(thermalProtection);
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    const { decision, guard } = await automation.evaluate();

    expect(decision.target).toBeNull();
    expect(decision.reason).toBe('fallback');
    expect(guard.apply).toBe(false);
  });

  it('does not fill the log with "nothing to do" — only changes of mind get written', async () => {
    await automation.updateConfig({ enabled: true });
    await automation.createRule(thermalProtection);

    await automation.evaluate();
    await automation.evaluate();
    await automation.evaluate();

    expect(await automation.listEvents()).toHaveLength(1);
  });

  it('logs a standing dry-run decision once, not every minute', async () => {
    // The regression behind 480 identical rows overnight: in dry-run the miner
    // never reaches its target, so the guard says "would apply" on every tick.
    await automation.updateConfig({ enabled: true, dryRun: true });
    await automation.createRule({
      name: 'Night eco',
      priority: 100,
      conditions: [{ signal: 'clock.time', op: 'between', values: ['00:00', '23:59'] }],
      action: { type: 'mode', mode: 'eco' },
    });
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    for (let i = 0; i < 5; i++) await automation.evaluate();

    const events = await automation.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ decision: 'mode:eco', applied: false });
  });

  it('logs again when a standing decision finally changes', async () => {
    await automation.updateConfig({ enabled: true, dryRun: true, fallbackAction: 'off' });
    const rule = await automation.createRule(thermalProtection);
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'online' });

    // Hot: decision is "off" (safety). Several ticks, one row.
    deps.miner.getStats.mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 88 } } }] });
    await automation.evaluate();
    await automation.evaluate();
    expect(await automation.listEvents()).toHaveLength(1);

    // Cools down: safety releases, fallback stops it — a real change, a new row.
    await automation.updateRule(rule.id, { enabled: false });
    const { decision } = await automation.evaluate();
    expect(decision.reason).toBe('fallback');
    expect(await automation.listEvents()).toHaveLength(2);
  });

  it('records why a change was throttled, so a blocked rule does not look broken', async () => {
    await automation.updateConfig({ enabled: true, fallbackAction: 'off' });
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({ status: 'online', requested_at: dbTime(new Date()) }); // started a moment ago

    const { guard } = await automation.evaluate();

    expect(guard).toMatchObject({ apply: false, blockedBy: 'min_change', changeType: 'stop' });

    const [event] = await automation.listEvents();
    expect(event.blockedBy).toBe('min_change');
    expect(event.message).toMatch(/minimum is 15m/);
  });

  it('holds the miner off between Y and X once thermal protection has tripped', async () => {
    await automation.updateConfig({ enabled: true });
    const rule = await automation.createRule(thermalProtection);

    // The protection already fired: the miner is off and that rule is the one in charge.
    await knex('service_status').where({ service_name: 'miner' }).update({ status: 'offline' });
    await knex('automation_events').insert({
      rule_id: rule.id,
      rule_name: rule.name,
      decision: 'off',
      change_type: 'stop',
      applied: true,
    });

    // 77°C: below the 80 trip point, still above the 75 release point.
    deps.miner.getStats.mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 77 } } }] });
    const holding = await automation.evaluate();
    expect(holding.decision.target).toEqual({ type: 'off' });

    // 72°C: cooled past the release point — the rule lets go.
    deps.miner.getStats.mockResolvedValue({ stats: [{ slots: { int_0: { temperature: 72 } } }] });
    const released = await automation.evaluate();
    expect(released.decision.target).toBeNull();
  });

  it('keeps the event log bounded', async () => {
    const rows = Array.from({ length: 520 }, (_, i) => ({
      decision: `mode:eco`,
      applied: false,
      message: `filler ${i}`,
    }));
    await knex.batchInsert('automation_events', rows, 100);

    await automation.updateConfig({ enabled: true, fallbackAction: 'off' });
    await knex('service_status')
      .where({ service_name: 'miner' })
      .update({ status: 'online', requested_at: dbTime(new Date(Date.now() - 3 * 3600 * 1000)) });

    await automation.evaluate();

    const { count } = await knex('automation_events').count('* as count').first();
    expect(count).toBeLessThanOrEqual(500);
  });
});
