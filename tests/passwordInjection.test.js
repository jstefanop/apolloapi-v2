// A password containing a line break would add a second "user:password" line to
// chpasswd's stdin (e.g. "x\nroot:pwn" sets root's password). These tests pin
// that the service refuses such input before storing or applying anything, and
// that utils refuses it independently.
const bcrypt = require('bcryptjs');
const childProcess = require('child_process');
const { knex } = require('../src/db');
const AuthService = require('../src/services/auth');
const utils = require('../src/utils');
const { PASSWORD_CHARS_ERROR } = require('../src/passwordPolicy');

const FORBIDDEN = {
  'LF': 'x\nroot:pwn',
  'CR': 'x\rroot:pwn',
  'CRLF': 'x\r\nroot:pwn',
  'NUL': 'x\0root:pwn',
  'trailing LF': 'goodpassword\n',
};

const NORMAL = ["pass word", "it's \"quoted\"", 'co:lon:s:here', "newpass'; rm -rf / #"];

describe('password injection guard', () => {
  let origEnv;
  let changeSystemPassword;
  let svc;

  beforeEach(async () => {
    origEnv = process.env.NODE_ENV;
    changeSystemPassword = jest.fn().mockResolvedValue(undefined);
    svc = AuthService(knex, { auth: { changeSystemPassword } });
    await knex('setup').del();
  });
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  describe('service.setup', () => {
    it.each(Object.entries(FORBIDDEN))('rejects %s, stores nothing, never calls chpasswd', async (_n, pw) => {
      process.env.NODE_ENV = 'production';
      await expect(svc.setup({ password: pw })).rejects.toThrow(PASSWORD_CHARS_ERROR);
      expect(await knex('setup').select('*')).toHaveLength(0);
      expect(changeSystemPassword).not.toHaveBeenCalled();
    });

    it.each(NORMAL)('accepts %j', async (pw) => {
      process.env.NODE_ENV = 'production';
      await svc.setup({ password: pw });
      const [row] = await knex('setup').select('*');
      expect(await bcrypt.compare(pw, row.password)).toBe(true);
      expect(changeSystemPassword).toHaveBeenCalledWith(pw);
    });
  });

  describe('service.changePassword', () => {
    let oldHash;
    beforeEach(async () => {
      oldHash = await bcrypt.hash('oldpassword', 4);
      await knex('setup').insert({ password: oldHash });
    });

    it.each(Object.entries(FORBIDDEN))('rejects %s, keeps the old hash, never calls chpasswd', async (_n, pw) => {
      process.env.NODE_ENV = 'production';
      await expect(svc.changePassword({ password: pw })).rejects.toThrow(PASSWORD_CHARS_ERROR);
      const [row] = await knex('setup').select('*');
      expect(row.password).toBe(oldHash);
      expect(changeSystemPassword).not.toHaveBeenCalled();
    });

    it.each(NORMAL)('accepts %j', async (pw) => {
      process.env.NODE_ENV = 'production';
      await svc.changePassword({ password: pw });
      const [row] = await knex('setup').select('*');
      expect(await bcrypt.compare(pw, row.password)).toBe(true);
      expect(changeSystemPassword).toHaveBeenCalledWith(pw);
    });
  });

  describe('utils.auth.changeSystemPassword', () => {
    const mockChild = () => {
      const child = {
        stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn() },
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === 'close') cb(0); }),
      };
      childProcess.spawn.mockImplementation(() => child);
      return child;
    };

    it.each(Object.entries(FORBIDDEN))('refuses %s even in production: no spawn, no stdin write', async (_n, pw) => {
      process.env.NODE_ENV = 'production';
      const child = mockChild();
      childProcess.spawn.mockClear();
      await expect(utils.auth.changeSystemPassword(pw)).rejects.toThrow(PASSWORD_CHARS_ERROR);
      expect(childProcess.spawn).not.toHaveBeenCalled();
      expect(child.stdin.write).not.toHaveBeenCalled();
    });

    it('refuses outside production too (same contract everywhere)', async () => {
      process.env.NODE_ENV = 'test';
      await expect(utils.auth.changeSystemPassword('x\nroot:pwn')).rejects.toThrow(PASSWORD_CHARS_ERROR);
    });

    it.each(NORMAL)('writes %j as exactly one chpasswd line', async (pw) => {
      process.env.NODE_ENV = 'production';
      const child = mockChild();
      await utils.auth.changeSystemPassword(pw);
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      const written = child.stdin.write.mock.calls[0][0];
      expect(written).toBe(`futurebit:${pw}\n`);
      expect(written.split('\n')).toHaveLength(2); // one entry + the terminator
    });
  });
});
