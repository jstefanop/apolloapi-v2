const { apply } = require('../src/services/automation/apply');

const makeDeps = (minerMode = 'balanced') => ({
  miner: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
  },
  settings: {
    read: jest.fn().mockResolvedValue({ minerMode }),
    update: jest.fn().mockResolvedValue(undefined),
  },
});

describe('automation apply', () => {
  it('stops a running miner', async () => {
    const deps = makeDeps();
    await apply({ target: { type: 'off' }, changeType: 'stop', deps });

    expect(deps.miner.stop).toHaveBeenCalled();
    expect(deps.settings.update).not.toHaveBeenCalled();
  });

  it('writes the mode before starting, or the miner would come back on the old one', async () => {
    const deps = makeDeps('balanced');
    await apply({ target: { type: 'mode', mode: 'eco' }, changeType: 'start', deps });

    expect(deps.settings.update).toHaveBeenCalledWith({ minerMode: 'eco' });
    expect(deps.miner.start).toHaveBeenCalled();
    expect(deps.miner.restart).not.toHaveBeenCalled();

    // Order matters: settings first, then the miner picks them up on boot.
    const settingsOrder = deps.settings.update.mock.invocationCallOrder[0];
    const startOrder = deps.miner.start.mock.invocationCallOrder[0];
    expect(settingsOrder).toBeLessThan(startOrder);
  });

  it('restarts a running miner to change its mode — the configurator rebuilds its args', async () => {
    const deps = makeDeps('eco');
    await apply({ target: { type: 'mode', mode: 'turbo' }, changeType: 'mode', deps });

    expect(deps.settings.update).toHaveBeenCalledWith({ minerMode: 'turbo' });
    expect(deps.miner.restart).toHaveBeenCalled();
    expect(deps.miner.start).not.toHaveBeenCalled();
  });

  it('does not rewrite the settings when the mode is already right', async () => {
    const deps = makeDeps('eco');
    await apply({ target: { type: 'mode', mode: 'eco' }, changeType: 'start', deps });

    // The settings table is append-only and capped: a pointless write costs a row.
    expect(deps.settings.update).not.toHaveBeenCalled();
    expect(deps.miner.start).toHaveBeenCalled();
  });

  it('tells the miner the command comes from the automation, so it does not pause itself', async () => {
    const deps = makeDeps();

    await apply({ target: { type: 'off' }, changeType: 'stop', deps });
    expect(deps.miner.stop).toHaveBeenCalledWith({ source: 'automation' });

    await apply({ target: { type: 'mode', mode: 'eco' }, changeType: 'start', deps });
    expect(deps.miner.start).toHaveBeenCalledWith({ source: 'automation' });

    await apply({ target: { type: 'mode', mode: 'turbo' }, changeType: 'mode', deps });
    expect(deps.miner.restart).toHaveBeenCalledWith({ source: 'automation' });
  });

  it('does nothing without a change to make', async () => {
    const deps = makeDeps();
    await apply({ target: null, changeType: null, deps });

    expect(deps.miner.start).not.toHaveBeenCalled();
    expect(deps.miner.stop).not.toHaveBeenCalled();
    expect(deps.miner.restart).not.toHaveBeenCalled();
  });
});
