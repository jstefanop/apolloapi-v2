const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { knex } = require('../src/db');
const utils = require('../src/utils');

const API_CONF = 'api.conf';
const written = () => fs.promises.writeFile.mock.calls.map(([file, content, opts]) => ({ file: String(file), content, opts }));
const base = (f) => path.basename(f);

describe('conf files written by changeNodeRpcPassword', () => {
  beforeEach(async () => {
    for (const method of ['log', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
    await knex('settings').del();
    await knex('settings').insert({});
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.access.mockResolvedValue(undefined);
    fs.promises.writeFile.mockResolvedValue(undefined);
    fs.promises.rename.mockResolvedValue(undefined);
    fs.promises.unlink.mockResolvedValue(undefined);
    fs.promises.stat.mockResolvedValue({ mode: 0o100644, isFile: () => true });
    fs.promises.readFile.mockImplementation(async (file) =>
      base(file).startsWith(API_CONF) ? 'rpcpassword=old\n' : '{ "pass": "old" }'
    );
    childProcess.exec.mockImplementation((cmd, options, cb) => (typeof options === 'function' ? options : cb)(null, 'ok', ''));
  });

  describe('F1: only a missing file is "missing"', () => {
    it('does not recreate a conf it could not read', async () => {
      fs.promises.readFile.mockImplementation(async (file) => {
        if (base(file).startsWith(API_CONF)) throw Object.assign(new Error('I/O error'), { code: 'EIO' });
        return '{ "pass": "old" }';
      });

      await utils.auth.changeNodeRpcPassword({});

      // Nothing was written to, or beside, the unreadable file.
      expect(written().filter((w) => base(w.file).startsWith(API_CONF))).toEqual([]);
    });

    it('does not recreate a conf whose existence check failed for another reason', async () => {
      fs.promises.access.mockImplementation(async (file) => {
        if (base(file) === API_CONF) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      });
      await utils.auth.changeNodeRpcPassword({});
      expect(written().filter((w) => base(w.file).startsWith(API_CONF))).toEqual([]);
    });

    it('does create one that is not there (ENOENT), owner-only', async () => {
      fs.promises.access.mockImplementation(async (file) => {
        if (base(file) === API_CONF) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      });
      fs.promises.stat.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));

      await utils.auth.changeNodeRpcPassword({});

      const created = written().find((w) => base(w.file).startsWith(API_CONF));
      expect(created.content).toMatch(/^rpcpassword=\w+\n$/);
      expect(created.opts.mode).toBe(0o600);
    });
  });

  describe('F2: the file is replaced whole or not at all', () => {
    it('writes beside the file with its own mode, then renames over it', async () => {
      await utils.auth.changeNodeRpcPassword({});

      const temp = written().find((w) => base(w.file).startsWith(API_CONF));
      expect(temp.file).toMatch(/api\.conf\.\d+\.\d+\.tmp$/);
      expect(path.dirname(temp.file)).toBe(path.dirname(fs.promises.rename.mock.calls.find(([, to]) => base(to) === API_CONF)[1]));
      // Tightened on every write, not kept from a 0644 original.
      expect(temp.opts.mode).toBe(0o600);
      expect(temp.opts.flag).toBe('wx');
      expect(fs.promises.rename).toHaveBeenCalledWith(temp.file, expect.stringMatching(/api\.conf$/));
    });

    it('a write that fails midway leaves the original untouched and removes the temp file', async () => {
      fs.promises.writeFile.mockImplementation(async (file) => {
        if (base(file).startsWith(API_CONF)) throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
      });

      await utils.auth.changeNodeRpcPassword({});

      // Never written under its real name, never renamed into place.
      expect(written().filter((w) => base(w.file) === API_CONF)).toEqual([]);
      expect(fs.promises.rename.mock.calls.filter(([, to]) => base(to) === API_CONF)).toEqual([]);
      expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/api\.conf\..*\.tmp$/));
    });

    it('a rename that fails removes the temp file too', async () => {
      fs.promises.rename.mockImplementation(async (from, to) => {
        if (base(to) === API_CONF) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      });
      await utils.auth.changeNodeRpcPassword({});
      expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/api\.conf\..*\.tmp$/));
    });
  });
});

describe('chpasswd', () => {
  let origEnv;
  beforeEach(() => {
    origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    // sqlite's own scheduling must keep running while the timeout is simulated.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    jest.useRealTimers();
  });

  const fakeChild = () => {
    const handlers = {};
    const stdinHandlers = {};
    const child = {
      stdin: { write: jest.fn(), end: jest.fn(), on: jest.fn((e, cb) => (stdinHandlers[e] = cb)) },
      stderr: { on: jest.fn() },
      on: jest.fn((e, cb) => (handlers[e] = cb)),
      kill: jest.fn(),
    };
    return { child, handlers, stdinHandlers };
  };

  it('F4: a chpasswd that never exits is killed and reported, not waited on for ever', async () => {
    const { child } = fakeChild();
    childProcess.spawn.mockReturnValue(child);

    const pending = utils.auth.changeSystemPassword('longenough1');
    const outcome = pending.catch((e) => e);
    await jest.advanceTimersByTimeAsync(30000);

    const error = await outcome;
    expect(error.message).toMatch(/did not finish within 30s/);
    expect(error.message).toMatch(/may or may not have changed/);
    // sudo forwards SIGTERM to chpasswd; SIGKILL only if that is not enough.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    await jest.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not time out a chpasswd that finishes', async () => {
    const { child, handlers } = fakeChild();
    childProcess.spawn.mockReturnValue(child);

    const pending = utils.auth.changeSystemPassword('longenough1');
    await jest.advanceTimersByTimeAsync(10);
    handlers.close(0);
    await expect(pending).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(60000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('F5: a broken pipe on its stdin rejects instead of crashing the process', async () => {
    const { child, stdinHandlers } = fakeChild();
    childProcess.spawn.mockReturnValue(child);

    const pending = utils.auth.changeSystemPassword('longenough1');
    const outcome = pending.catch((e) => e);
    await jest.advanceTimersByTimeAsync(10);
    expect(stdinHandlers.error).toBeInstanceOf(Function);
    stdinHandlers.error(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));

    expect((await outcome).message).toMatch(/EPIPE/);
  });

  it('F5: the sudo tee fallback handles a broken pipe too', async () => {
    const { child, stdinHandlers } = fakeChild();
    childProcess.spawn.mockReturnValue(child);
    for (const method of ['log', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
    await knex('settings').del();
    await knex('settings').insert({});
    // Directory not writable by us: every fs write is refused, so tee is the way.
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.access.mockResolvedValue(undefined);
    fs.promises.readFile.mockResolvedValue('rpcpassword=old\n');
    fs.promises.stat.mockResolvedValue({ mode: 0o100644 });
    fs.promises.writeFile.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    fs.promises.unlink.mockResolvedValue(undefined);

    // The database underneath needs real timers.
    jest.useRealTimers();
    const running = utils.auth.changeNodeRpcPassword({});
    for (let i = 0; i < 100 && !childProcess.spawn.mock.calls.length; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(childProcess.spawn).toHaveBeenCalledWith('sudo', ['tee', expect.stringMatching(/api\.conf$/)], expect.anything());
    expect(stdinHandlers.error).toBeInstanceOf(Function);
    // It must not throw out of the stream as an unhandled 'error' event.
    stdinHandlers.error(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await running; // the failure is logged by changeNodeRpcPassword, not thrown
  });
});

describe('F1/F2/F4 of the security review (round 4)', () => {
  const settings = { nodeRpcPassword: 'pw123456', nodeEnableSoloMining: false };

  beforeEach(async () => {
    for (const method of ['log', 'info', 'warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {});
    await knex('settings').del();
    await knex('settings').insert({ node_rpc_password: null });
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.access.mockResolvedValue(undefined);
    fs.promises.writeFile.mockResolvedValue(undefined);
    fs.promises.rename.mockResolvedValue(undefined);
    fs.promises.unlink.mockResolvedValue(undefined);
    fs.promises.readdir.mockResolvedValue([]);
    fs.promises.stat.mockResolvedValue({ mode: 0o100644 });
    fs.promises.readFile.mockImplementation(async (file) =>
      base(file).startsWith(API_CONF) ? 'rpcpassword=old\n' : '{ "btcd": [{ "pass": "old" }] }'
    );
  });

  it('manageCkpoolConf replaces the file atomically and owner-only', async () => {
    await utils.auth.manageCkpoolConf(settings);
    const temp = written().find((w) => /ckpool\.conf\.\d+\.\d+\.tmp$/.test(w.file));
    expect(temp.content).toContain('"pass": "pw123456"');
    expect(temp.opts).toMatchObject({ mode: 0o600, flag: 'wx' });
    expect(written().filter((w) => base(w.file) === 'ckpool.conf')).toEqual([]);
    expect(fs.promises.rename).toHaveBeenCalledWith(temp.file, expect.stringMatching(/ckpool\.conf$/));
  });

  it('manageBitcoinConf leaves an api.conf it cannot read alone', async () => {
    fs.promises.readFile.mockImplementation(async (file) => {
      if (base(file) === API_CONF) throw Object.assign(new Error('I/O error'), { code: 'EIO' });
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    });
    fs.promises.access.mockImplementation(async (file) => {
      if (base(file) !== API_CONF) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    });
    await utils.auth.manageBitcoinConf(settings);
    expect(written().filter((w) => base(w.file).startsWith(API_CONF))).toEqual([]);
  });

  it('api.conf is written owner-only even when it was world-readable before', async () => {
    await utils.auth.manageBitcoinConf(settings);
    const temp = written().find((w) => /api\.conf\.\d+\.\d+\.tmp$/.test(w.file));
    expect(temp.opts.mode).toBe(0o600);
  });

  it('user.conf, which holds no credentials, keeps the mode it has', async () => {
    fs.promises.stat.mockResolvedValue({ mode: 0o100664 });
    await utils.auth.manageBitcoinConf({ ...settings, nodeUserConf: 'dbcache=300' });
    const temp = written().find((w) => /user\.conf\.\d+\.\d+\.tmp$/.test(w.file));
    expect(temp.opts.mode).toBe(0o664);
  });

  it('removes a temp file a crashed write left behind, but not one of this process', async () => {
    const mine = `api.conf.${process.pid}.1.tmp`;
    fs.promises.readdir.mockResolvedValue(['api.conf.99999.123.tmp', mine, 'api.conf', 'other.tmp']);
    await utils.auth.changeNodeRpcPassword({});
    const removed = fs.promises.unlink.mock.calls.map(([f]) => base(f));
    expect(removed).toContain('api.conf.99999.123.tmp');
    expect(removed).not.toContain(mine);
    expect(removed).not.toContain('other.tmp');
    expect(removed).not.toContain('api.conf');
  });

  it('F4: the conf files are written before the database, and a failure leaves the database alone', async () => {
    // Success: both are updated.
    await utils.auth.changeNodeRpcPassword({});
    expect((await knex('settings').first()).node_rpc_password).toBeTruthy();
    expect(fs.promises.rename).toHaveBeenCalled();

    // A file refuses: nothing may reach the database, so it still holds the
    // password the files still hold.
    await knex('settings').update({ node_rpc_password: null });
    fs.promises.writeFile.mockRejectedValue(Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    await utils.auth.changeNodeRpcPassword({});
    expect((await knex('settings').first()).node_rpc_password).toBeNull();
  });
});
