// tests/nodeStorage.test.js
// getStorage() is what the UI believes about the hardware, so the failure
// direction matters more than the happy path: a check that cannot run must not
// come back as "no drive", or a working node gets told to go buy an SSD.
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
const { spawn } = require('child_process');
const { installFakeSpawn } = require('./helpers/fakeSpawn');
const createNodeService = require('../src/services/node');

const spawnedChild = installFakeSpawn(spawn);

// The script emits one JSON line; feed it and let the promise settle.
const answer = (text, code = 0) => {
  const child = spawnedChild();
  if (text !== null) child.stdout.emit('data', Buffer.from(text));
  child.emit('close', code);
};

describe('NodeService.getStorage', () => {
  let svc;
  beforeEach(() => {
    svc = createNodeService({}, {});
  });

  it('reports what the script found', async () => {
    const p = svc.getStorage();
    answer('{"state":"no-drive","disk":"/dev/nvme0n1","size":null}\n');
    await expect(p).resolves.toMatchObject({ state: 'no-drive' });
  });

  it('runs the shared check, not a private copy of it', async () => {
    const p = svc.getStorage();
    answer('{"state":"ready"}');
    await p;
    const [cmd, args] = spawn.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toMatch(/backend\/lib\/node_storage\.sh$/);
    expect(args[1]).toBe('--json');
  });

  it('answers from cache within the window instead of spawning again', async () => {
    const p = svc.getStorage();
    answer('{"state":"ready","size":2000398934016}');
    await p;
    await expect(svc.getStorage()).resolves.toMatchObject({ state: 'ready' });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('says unknown — never no-drive — when the output is not JSON', async () => {
    const p = svc.getStorage();
    answer('bash: findmnt: command not found\n', 127);
    await expect(p).resolves.toEqual({ state: 'unknown' });
  });

  it('says unknown when the script cannot be run at all', async () => {
    const p = svc.getStorage();
    spawnedChild().emit('error', new Error('ENOENT'));
    await expect(p).resolves.toEqual({ state: 'unknown' });
  });

  it('says unknown on empty output', async () => {
    const p = svc.getStorage();
    answer(null, 0);
    await expect(p).resolves.toEqual({ state: 'unknown' });
  });

  // The disk this asks about is the one that hangs lsblk when it is failing, and
  // SIGKILL does not reap a process stuck in uninterruptible I/O. Waiting for a
  // close that never comes left the GraphQL request hanging and, with nothing
  // cached, every poll behind it spawned another shell that hung too.
  it('answers on the watchdog rather than waiting for a death that may not come', async () => {
    jest.useFakeTimers();
    try {
      const p = svc.getStorage();
      spawnedChild(); // spawned, never emits 'close'
      jest.advanceTimersByTime(10000);
      await expect(p).resolves.toEqual({ state: 'unknown' });
      expect(spawnedChild().kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });

  // 'ready' is the steady state and is held; anything else is what the user is
  // working on — a format finishing, a disk being seated — and holding it is how
  // a drive that came good keeps reading 'unformatted' long after it did.
  it('holds a ready answer but re-checks an unusable one', async () => {
    jest.useFakeTimers();
    try {
      const p = svc.getStorage();
      answer('{"state":"unformatted"}');
      await p;

      jest.advanceTimersByTime(3000);
      const q = svc.getStorage();
      answer('{"state":"ready"}');
      await expect(q).resolves.toMatchObject({ state: 'ready' });
      expect(spawn).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(3000);
      await expect(svc.getStorage()).resolves.toMatchObject({ state: 'ready' });
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // Everything else on this service is faked in development, and a laptop has no
  // NVMe: probing for real answers no-drive and takes the node, solo and format
  // screens off the build they are being developed on.
  it('answers without probing hardware in development', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let devSvc;
    try {
      jest.isolateModules(() => {
        devSvc = require('../src/services/node')({}, {});
      });
    } finally {
      process.env.NODE_ENV = orig;
    }

    await expect(devSvc.getStorage()).resolves.toMatchObject({ state: 'ready' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not cache across service instances', async () => {
    const p = svc.getStorage();
    answer('{"state":"ready"}');
    await p;

    const other = createNodeService({}, {});
    const q = other.getStorage();
    answer('{"state":"no-drive"}');
    await expect(q).resolves.toMatchObject({ state: 'no-drive' });
  });
});
