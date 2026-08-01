// tests/mcuUpdate.test.js
// The update launcher runs inline for minutes and reports through its own
// progress marker (-10 on failure), so update() must NOT wait for its outcome —
// unlike the format launcher, which detaches at once. But a process that cannot
// even start has no marker to report through: that failure must reject, and with
// no 'error' listener it used to crash the whole API instead.
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
const { spawn } = require('child_process');
const { installFakeSpawn } = require('./helpers/fakeSpawn');
const createMcuService = require('../src/services/mcu');

const spawnedChild = installFakeSpawn(spawn);

describe('McuService.update launch semantics', () => {
  const svc = createMcuService({}, {});

  it('resolves once the process has spawned, without waiting for the outcome', async () => {
    const p = svc.update();
    spawnedChild().emit('spawn');
    // No 'close' was emitted: the script is still running when this resolves.
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects when the process cannot start at all', async () => {
    const p = svc.update();
    spawnedChild().emit('error', new Error('spawn sudo ENOENT'));
    await expect(p).rejects.toThrow(
      'Failed to update firmware: spawn sudo ENOENT'
    );
  });

  it('absorbs a late error after spawn instead of crashing', async () => {
    const p = svc.update();
    spawnedChild().emit('spawn');
    await p;
    // An 'error' with no listener would crash the process; the armed reject
    // listener must stay attached even after the promise has settled.
    expect(() => spawnedChild().emit('error', new Error('late'))).not.toThrow();
  });
});

describe('mcu mutations schema reachability', () => {
  // reboot/shutdown/update moved off the query path (Apollo re-executes queries
  // — see the node format tests); the query fields stay as deprecated aliases
  // wired to the SAME implementation.
  const typeDefs = require('../src/graphql/typeDefs/mcu');
  const resolvers = require('../src/graphql/resolvers/mcu');

  const fieldDef = (typeName, fieldName) => {
    for (const def of typeDefs.definitions) {
      if (
        (def.kind === 'ObjectTypeDefinition' ||
          def.kind === 'ObjectTypeExtension') &&
        def.name.value === typeName
      ) {
        for (const f of def.fields || []) {
          if (f.name.value === fieldName) return f;
        }
      }
    }
    return undefined;
  };

  it('declares reboot/shutdown/update on McuMutations, with deprecated aliases', () => {
    expect(typeof resolvers.Mutation.Mcu).toBe('function');
    for (const field of ['reboot', 'shutdown', 'update']) {
      expect(fieldDef('McuMutations', field)).toBeDefined();
      const alias = fieldDef('McuActions', field);
      expect(alias).toBeDefined();
      expect(alias.directives.map((d) => d.name.value)).toEqual(
        expect.arrayContaining(['auth', 'deprecated'])
      );
      expect(resolvers.McuActions[field]).toBe(resolvers.McuMutations[field]);
    }
  });
});
