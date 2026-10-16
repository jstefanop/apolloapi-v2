// A transition that systemd refused must never reach the UI as "pending": the
// browser announces "Starting miner" from that push, and the HTTP error that
// contradicts it arrives later (or not before the toast). So the request is
// written first (the service monitor needs it), published only once the command
// was accepted, and put back if it was refused.

const { knex } = require('../src/db');

const scheduler = () => require('../src/app/scheduler');
const row = (name) => knex('service_status').where({ service_name: name }).first();

const SERVICES = [
  ['miner', () => require('../src/services/miner')(knex)],
  ['node', () => require('../src/services/node')(knex)],
  ['solo', () => require('../src/services/solo')(knex)],
];

// The push reads the row asynchronously: wait for it rather than guess.
const settle = async (published, atLeast) => {
  for (let i = 0; i < 50 && published.length < atLeast; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
};

const BEFORE = { status: 'online', requested_status: 'online', requested_at: 1111 };

describe.each(SERVICES)('%s transitions', (name, make) => {
  let svc;
  let published;

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    if (!(await row(name))) {
      await knex('service_status').insert({ service_name: name, status: 'offline', last_checked: new Date() });
    }
    await knex('service_status').where({ service_name: name }).update(BEFORE);

    // What every browser would have been told, at the moment of each push.
    published = [];
    scheduler().pushServicesStatus.mockImplementation(async () => {
      const r = await row(name);
      published.push({ status: r.status, requested_status: r.requested_status });
    });
    svc = make();
  });

  describe.each(['start', 'stop', 'restart'].filter((a) => !(name === 'node' && a === 'restart')))('%s()', (action) => {
    it('refused by systemd: the row is put back and "pending" is never published', async () => {
      jest.spyOn(svc, '_execCommand').mockRejectedValue(new Error('systemctl exited 1'));

      await expect(svc[action]()).rejects.toThrow(/Could not/);
      await settle(published, 1);

      const after = await row(name);
      expect(after.status).toBe(BEFORE.status);
      expect(after.requested_status).toBe(BEFORE.requested_status);
      expect(Number(after.requested_at)).toBe(BEFORE.requested_at);
      // What was published is the restored state, and nothing was pending.
      expect(published.length).toBeGreaterThan(0);
      expect(published.filter((p) => p.status === 'pending')).toEqual([]);
    });

    it('accepted: pending is written and published after the command, not before', async () => {
      let pendingBeforeCommand;
      jest.spyOn(svc, '_execCommand').mockImplementation(async () => {
        pendingBeforeCommand = (await row(name)).status === 'pending'; // the monitor needs it
        expect(published).toEqual([]); // ...but nobody has been told yet
        return { stdout: 'active', stderr: '' };
      });
      if (name === 'solo') {
        jest.spyOn(svc, '_waitForActive').mockResolvedValue(true);
        jest.spyOn(svc, '_waitForInactive').mockResolvedValue(true);
      }

      await svc[action]();
      await settle(published, 1);

      expect(pendingBeforeCommand).toBe(true);
      expect(published.length).toBeGreaterThan(0);
      expect(published[0].status).toBe('pending');
    });
  });

  it('does not put an old value over a newer request', async () => {
    jest.spyOn(svc, '_execCommand').mockImplementation(async () => {
      // Somebody (the monitor, another request) moved the row on meanwhile.
      await knex('service_status')
        .where({ service_name: name })
        .update({ status: 'offline', requested_status: 'offline', requested_at: 9999 });
      throw new Error('boom');
    });

    await expect(svc.start()).rejects.toThrow();

    const after = await row(name);
    expect(after.requested_status).toBe('offline');
    expect(Number(after.requested_at)).toBe(9999);
  });
});
