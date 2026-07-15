const { knex } = require('../src/db');
const childProcess = require('child_process');
const scheduler = require('../src/app/scheduler'); // mocked in tests/setup.js
const services = require('../src/services');

const { miner, automation } = services;

// The whole point of this file: who paused the automation, and why.
//
// A user pressing Stop must pause it (otherwise the miner undoes their click a
// minute later). The automation issuing the very same command must NOT pause it,
// or it would suspend itself the first time it ever acted — a bug that would look
// like "the automation works once, then dies".

beforeEach(async () => {
  // jest.config sets resetMocks, which wipes the implementations declared in
  // tests/setup.js before every test. These tests drive the real miner service,
  // which shells out to systemctl, so exec has to answer.
  childProcess.exec.mockImplementation((cmd, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (done) done(null, '', '');
  });

  await knex('automation_events').del();
  await knex('automation_config').where({ id: 1 }).update({
    enabled: true,
    dry_run: true,
    override_until: null,
    override_reason: null,
    override_minutes: 60,
  });
  await knex('service_status')
    .where({ service_name: 'miner' })
    .update({ status: 'offline', requested_status: null, requested_at: null });
});

describe('manual actions vs the automation', () => {
  it('pauses the automation when the user starts the miner', async () => {
    await miner.start();

    const config = await automation.getConfig();
    expect(config.overrideReason).toBe('manual');
    expect(config.overrideUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('pauses the automation when the user stops the miner', async () => {
    await miner.stop();
    expect((await automation.getConfig()).overrideReason).toBe('manual');
  });

  it('honours the configured pause window', async () => {
    await automation.updateConfig({ overrideMinutes: 15 });
    await miner.start();

    const { overrideUntil } = await automation.getConfig();
    const minutes = (overrideUntil.getTime() - Date.now()) / 60000;

    expect(minutes).toBeGreaterThan(13);
    expect(minutes).toBeLessThan(16);
  });

  it('does NOT pause the automation when the command comes from the automation itself', async () => {
    await miner.start({ source: 'automation' });
    await miner.stop({ source: 'automation' });
    await miner.restart({ source: 'automation' });

    expect((await automation.getConfig()).overrideUntil).toBeNull();
  });

  it('does not pause anything when the automation is disabled', async () => {
    await automation.updateConfig({ enabled: false });
    await miner.start();

    expect((await automation.getConfig()).overrideUntil).toBeNull();
  });

  it('re-evaluates on a user stop so the automation page updates now, not at the next tick', async () => {
    scheduler.evaluateAutomation.mockClear();
    await miner.stop({ source: 'user' });
    expect(scheduler.evaluateAutomation).toHaveBeenCalled();

    // The automation's own commands must not trigger it (would recurse).
    scheduler.evaluateAutomation.mockClear();
    await miner.stop({ source: 'automation' });
    expect(scheduler.evaluateAutomation).not.toHaveBeenCalled();
  });
});
