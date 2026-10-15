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
        select: () => ({ limit: async () => [{ id: 1, password: oldHash }] }),
        update: async () => {
          throw new Error(`update ${table} set password = ? - SQLITE_BUSY`);
        },
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
});
