const bcrypt = require('bcryptjs');
const { knex } = require('../src/db');
const AuthService = require('../src/services/auth');

// The system password (chpasswd) cannot be taken back: nothing knows the old
// plaintext to put it back. So it runs first, and a failure there must leave the
// login hash exactly as it was.

describe('password change order', () => {
  let oldHash;
  const origEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = 'production';
    await knex('setup').del();
    oldHash = await bcrypt.hash('oldpassword', 4);
    await knex('setup').insert({ password: oldHash });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  describe('changePassword', () => {
    it('chpasswd failing leaves the stored hash unchanged', async () => {
      const changeSystemPassword = jest.fn().mockRejectedValue(new Error('chpasswd exited 1'));
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      await expect(svc.changePassword({ password: 'newpassword1' })).rejects.toThrow('chpasswd exited 1');

      const [row] = await knex('setup').select('*');
      expect(row.password).toBe(oldHash);
    });

    it('success changes both, system first', async () => {
      const order = [];
      const changeSystemPassword = jest.fn(async () => {
        const [row] = await knex('setup').select('*');
        order.push(row.password === oldHash ? 'system-while-hash-old' : 'system-after-hash');
      });
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      await svc.changePassword({ password: 'newpassword1' });

      expect(order).toEqual(['system-while-hash-old']);
      expect(changeSystemPassword).toHaveBeenCalledWith('newpassword1');
      const [row] = await knex('setup').select('*');
      expect(await bcrypt.compare('newpassword1', row.password)).toBe(true);
    });

    it('a failed hash write after chpasswd succeeded is reported plainly, without the hash', async () => {
      const changeSystemPassword = jest.fn().mockResolvedValue(undefined);
      const failingKnex = (table) => ({
        select: () => ({ orderBy: () => ({ limit: async () => [{ id: 1, password: oldHash }] }) }),
        where: () => ({
          update: async () => {
            throw new Error(`update ${table} set password = ? - SQLITE_BUSY`);
          },
        }),
      });
      const svc = AuthService(failingKnex, { auth: { changeSystemPassword } });

      const error = await svc.changePassword({ password: 'newpassword1' }).catch((e) => e);

      expect(changeSystemPassword).toHaveBeenCalledTimes(1);
      expect(error.message).toMatch(/system password was changed/);
      expect(error.message).toMatch(/previous login password still works/);
      expect(error.message).not.toMatch(/SQLITE_BUSY/);
    });
  });

  describe('setup', () => {
    beforeEach(() => knex('setup').del());

    it('chpasswd failing leaves no setup row, so the wizard can be run again', async () => {
      const changeSystemPassword = jest.fn().mockRejectedValue(new Error('chpasswd exited 1'));
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      await expect(svc.setup({ password: 'newpassword1' })).rejects.toThrow('chpasswd exited 1');

      expect(await knex('setup').select('*')).toEqual([]);
    });

    it('success sets both', async () => {
      const changeSystemPassword = jest.fn().mockResolvedValue(undefined);
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      await svc.setup({ password: 'newpassword1' });

      expect(changeSystemPassword).toHaveBeenCalledWith('newpassword1');
      const [row] = await knex('setup').select('*');
      expect(await bcrypt.compare('newpassword1', row.password)).toBe(true);
    });
  });

  describe('two at once', () => {
    beforeEach(() => knex('setup').del());

    it('two concurrent setups: exactly one succeeds, and the system password is the login password', async () => {
      let systemPassword = null;
      const changeSystemPassword = jest.fn(async (pw) => {
        // Slow enough for the second request to arrive while the first is mid-way.
        await new Promise((r) => setTimeout(r, 30));
        systemPassword = pw;
      });
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      const results = await Promise.allSettled([
        svc.setup({ password: 'firstpassword' }),
        svc.setup({ password: 'secondpassword' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected.reason.message).toBe('Setup already done');

      const rows = await knex('setup').select('*');
      expect(rows).toHaveLength(1);
      expect(changeSystemPassword).toHaveBeenCalledTimes(1);
      expect(await bcrypt.compare(systemPassword, rows[0].password)).toBe(true);
    });

    it('a failed turn does not block the next one', async () => {
      const failing = AuthService(knex, {
        auth: { changeSystemPassword: jest.fn().mockRejectedValue(new Error('chpasswd exited 1')) },
      });
      await expect(failing.setup({ password: 'firstpassword' })).rejects.toThrow('chpasswd exited 1');
      const ok = AuthService(knex, { auth: { changeSystemPassword: jest.fn().mockResolvedValue() } });
      await expect(ok.setup({ password: 'secondpassword' })).resolves.not.toThrow();
    });
  });

  describe('minimum length', () => {
    it.each([
      ['setup', (svc) => svc.setup({ password: 'short7!' })],
      ['changePassword', (svc) => svc.changePassword({ password: 'short7!' })],
    ])('%s refuses a password under 8 characters, before storing or applying anything', async (_n, call) => {
      await knex('setup').del();
      await knex('setup').insert({ password: oldHash });
      const changeSystemPassword = jest.fn();
      const svc = AuthService(knex, { auth: { changeSystemPassword } });

      await expect(call(svc)).rejects.toThrow('Password must be at least 8 characters');

      expect(changeSystemPassword).not.toHaveBeenCalled();
      const [row] = await knex('setup').select('*');
      expect(row.password).toBe(oldHash);
    });

    it('accepts exactly 8', async () => {
      await knex('setup').del();
      await knex('setup').insert({ password: oldHash });
      const svc = AuthService(knex, { auth: { changeSystemPassword: jest.fn() } });
      await expect(svc.changePassword({ password: '12345678' })).resolves.not.toThrow();
    });
  });

  it('login reads the oldest setup row', async () => {
    await knex('setup').del();
    await knex('setup').insert({ password: await bcrypt.hash('firstone-pass', 4) });
    await knex('setup').insert({ password: await bcrypt.hash('stray-row-pass', 4) });
    const svc = AuthService(knex, {});
    await expect(svc.login({ password: 'firstone-pass' })).resolves.toHaveProperty('accessToken');
    await expect(svc.login({ password: 'stray-row-pass' })).rejects.toThrow('Invalid password');
  });
});
