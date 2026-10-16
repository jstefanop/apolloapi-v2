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
      expect(temp.opts.mode).toBe(0o644); // the original's, not a default
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
