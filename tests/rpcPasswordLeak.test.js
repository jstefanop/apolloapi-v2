const fs = require('fs');
const childProcess = require('child_process');
const { knex } = require('../src/db');
const utils = require('../src/utils');

// The node RPC password used to be interpolated into `sed -i 's/…/…/'`: the
// command was logged (journal) and sits in argv (visible in `ps`). It is now
// written with fs, and no log line may carry it.
describe('changeNodeRpcPassword', () => {
  let logged;

  beforeEach(async () => {
    logged = [];
    for (const method of ['log', 'info', 'warn', 'error']) {
      jest.spyOn(console, method).mockImplementation((...args) => logged.push(args.join(' ')));
    }
    await knex('settings').del();
    await knex('settings').insert({});
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.access.mockResolvedValue(undefined);
    fs.promises.writeFile.mockResolvedValue(undefined);
    fs.promises.rename.mockResolvedValue(undefined);
    fs.promises.unlink.mockResolvedValue(undefined);
    fs.promises.stat.mockResolvedValue({ mode: 0o100644 });
    fs.promises.readFile.mockImplementation(async (file) =>
      String(file).endsWith('api.conf')
        ? 'rpcuser=futurebit\nrpcpassword=oldsecret\n'
        : '{\n  "btcd": [{\n    "pass": "oldsecret",\n    "notify": true\n  }]\n}'
    );
    childProcess.exec.mockImplementation((cmd, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      cb(null, 'ok', '');
    });
  });

  const run = async () => {
    await utils.auth.changeNodeRpcPassword({});
    const [row] = await knex('settings').select('node_rpc_password').orderBy('id', 'desc').limit(1);
    return row.node_rpc_password;
  };

  it('writes the new password into both conf files through fs', async () => {
    const password = await run();
    expect(password).toBeTruthy();

    // Written beside the file and renamed over it: key by the file it ends up as.
    const writes = Object.fromEntries(
      fs.promises.writeFile.mock.calls.map(([file, content]) => [
        require('path').basename(file).replace(/\.\d+\.\d+\.tmp$/, ''),
        content,
      ])
    );
    expect(writes['api.conf']).toBe(`rpcuser=futurebit\nrpcpassword=${password}\n`);
    expect(writes['ckpool.conf']).toContain(`"pass": "${password}",`);
    expect(writes['ckpool.conf']).not.toContain('oldsecret');
  });

  it('never puts the password in a command line or a log line', async () => {
    const password = await run();

    const commands = childProcess.exec.mock.calls.map(([cmd]) => cmd);
    expect(commands.filter((c) => c.includes(password))).toEqual([]);
    expect(childProcess.spawn.mock.calls.filter(([, args]) => (args || []).join(' ').includes(password))).toEqual([]);
    expect(logged.filter((line) => line.includes(password))).toEqual([]);
    expect(logged.length).toBeGreaterThan(0); // the check is looking at something
  });

  it('execWithSudo-style failures do not echo the command either', async () => {
    childProcess.exec.mockImplementation((cmd, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      cb(new Error(`Command failed: ${cmd}`), '', '');
    });
    const password = await run();
    expect(logged.filter((line) => line.includes(password))).toEqual([]);
  });
});
