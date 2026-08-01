// tests/nodeFormat.test.js
// Two things the format-hardening change introduced that the resolver-rename test
// does not cover: the detached-launcher error semantics of _formatDisk, and that
// format is actually reachable on Mutation.Node (it moved off Query.NodeActions).
jest.mock('child_process', () => ({ spawn: jest.fn(), exec: jest.fn() }));
const { spawn } = require('child_process');
const { installFakeSpawn } = require('./helpers/fakeSpawn');
const createNodeService = require('../src/services/node');

const spawnedChild = installFakeSpawn(spawn);

describe('NodeService._formatDisk error semantics', () => {
  const svc = createNodeService({}, {});

  it('resolves when the launcher exits 0', async () => {
    const p = svc._formatDisk();
    spawnedChild().emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on exit 0 even after stderr output (a warning is not a failure)', async () => {
    const p = svc._formatDisk();
    spawnedChild().stderr.emit('data', Buffer.from('warning: noisy but harmless'));
    spawnedChild().emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects with the stderr text on a non-zero exit', async () => {
    const p = svc._formatDisk();
    spawnedChild().stderr.emit('data', Buffer.from('screen: command not found'));
    spawnedChild().emit('close', 1);
    await expect(p).rejects.toThrow('screen: command not found');
  });

  it('rejects with a fallback message on a non-zero exit with no stderr', async () => {
    const p = svc._formatDisk();
    spawnedChild().emit('close', 3);
    await expect(p).rejects.toThrow('exited with code 3');
  });

  it('rejects on a spawn error', async () => {
    const p = svc._formatDisk();
    spawnedChild().emit('error', new Error('EACCES'));
    await expect(p).rejects.toThrow('EACCES');
  });

  it('format() wraps the launcher failure in a GraphQLError', async () => {
    const p = svc.format();
    spawnedChild().stderr.emit('data', Buffer.from('sudo: a password is required'));
    spawnedChild().emit('close', 1);
    await expect(p).rejects.toThrow(
      'Failed to format disk: sudo: a password is required'
    );
  });
});

describe('format() service-status bookkeeping', () => {
  // The worker stops the node with a raw systemctl; format() must record the
  // stop as REQUESTED (like stop() does) or the monitor treats it as manual —
  // and auto-restarts a 'failed' stop over the disk being wiped.
  const { pushServicesStatus } = require('../src/app/scheduler');

  const makeKnex = () => {
    const update = jest.fn().mockResolvedValue(1);
    const where = jest.fn(() => ({ update }));
    const knex = jest.fn(() => ({ where }));
    return { knex, where, update };
  };

  it('records node requested offline once the launcher confirms the start', async () => {
    const { knex, where, update } = makeKnex();
    const svc = createNodeService(knex, {});
    const p = svc.format();
    spawnedChild().emit('close', 0);
    await p;
    expect(knex).toHaveBeenCalledWith('service_status');
    expect(where).toHaveBeenCalledWith({ service_name: 'node' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', requested_status: 'offline' })
    );
    expect(pushServicesStatus).toHaveBeenCalled();
  });

  it('leaves the bookkeeping alone when the launch is refused', async () => {
    // A refusal means another format owns the current state — recording offline
    // here would stamp OUR request over THAT run's (or over no run at all).
    const { knex } = makeKnex();
    const svc = createNodeService(knex, {});
    const p = svc.format();
    spawnedChild().stderr.emit(
      'data',
      Buffer.from('format_node_disk: a format is already running; not starting another')
    );
    spawnedChild().emit('close', 1);
    await expect(p).rejects.toThrow('already running');
    expect(knex).not.toHaveBeenCalled();
  });

  it('still resolves when the bookkeeping write fails — the format is already running', async () => {
    const update = jest.fn().mockRejectedValue(new Error('db locked'));
    const knex = jest.fn(() => ({ where: () => ({ update }) }));
    const svc = createNodeService(knex, {});
    const p = svc.format();
    spawnedChild().emit('close', 0);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('format schema reachability', () => {
  // Assert the type layer and the resolver layer agree, without building the whole
  // executable schema (that pulls in the full app graph and fights the test setup).
  const typeDefs = require('../src/graphql/typeDefs/node');
  const resolvers = require('../src/graphql/resolvers/node');

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

  const fieldsOf = (typeName) => {
    const names = new Set();
    for (const def of typeDefs.definitions) {
      if (
        (def.kind === 'ObjectTypeDefinition' ||
          def.kind === 'ObjectTypeExtension') &&
        def.name.value === typeName
      ) {
        for (const f of def.fields || []) names.add(f.name.value);
      }
    }
    return names;
  };

  it('declares format on NodeMutations, with a deprecated query alias', () => {
    expect(fieldsOf('NodeMutations').has('format')).toBe(true);
    expect(fieldsOf('Mutation').has('Node')).toBe(true);
    // The alias keeps pre-mutation UI bundles working across an update; it must
    // stay explicitly deprecated so it does not outlive that purpose unnoticed.
    const alias = fieldDef('NodeActions', 'format');
    expect(alias).toBeDefined();
    expect(alias.directives.map((d) => d.name.value)).toEqual(
      expect.arrayContaining(['auth', 'deprecated'])
    );
    // formatProgress is a read and stays a query.
    expect(fieldsOf('NodeActions').has('formatProgress')).toBe(true);
  });

  it('wires format under NodeMutations with the alias present on NodeActions', () => {
    expect(typeof resolvers.Mutation.Node).toBe('function');
    expect(typeof resolvers.NodeMutations.format).toBe('function');
    // The alias is a thin single-shot guard delegating to the same
    // implementation (behaviour pinned by the latch tests below).
    expect(typeof resolvers.NodeActions.format).toBe('function');
  });

  it('declares start/stop on NodeMutations, with deprecated query aliases', () => {
    for (const field of ['start', 'stop']) {
      expect(fieldsOf('NodeMutations').has(field)).toBe(true);
      const alias = fieldDef('NodeActions', field);
      expect(alias).toBeDefined();
      expect(alias.directives.map((d) => d.name.value)).toEqual(
        expect.arrayContaining(['auth', 'deprecated'])
      );
      // Identity: the alias IS the mutation implementation — no drift, and no
      // latch (start/stop are recoverable, unlike the wipe).
      expect(resolvers.NodeActions[field]).toBe(resolvers.NodeMutations[field]);
    }
  });
});

describe('deprecated query alias single-shot latch', () => {
  // Apollo re-executes queries — the original double-wipe. The alias serves a
  // stale bundle ONCE per API process; a re-execution landing after the format
  // finished (worker lock released) is refused instead of wiping again. Fresh
  // module registry per test: the latch is process-wide state.
  const freshResolvers = () => {
    let r;
    jest.isolateModules(() => {
      r = require('../src/graphql/resolvers/node');
    });
    return r;
  };

  it('lets a stale bundle format once, then refuses re-executions', async () => {
    const r = freshResolvers();
    const format = jest.fn().mockResolvedValue(undefined);
    const ctx = { services: { node: { format } } };

    const first = await r.NodeActions.format(null, {}, ctx);
    expect(first.error).toBeNull();

    const second = await r.NodeActions.format(null, {}, ctx);
    expect(second.error.message).toMatch(/outdated page/i);
    expect(format).toHaveBeenCalledTimes(1); // the wipe ran once
  });

  it('does not spend the latch on a refused launch', async () => {
    const r = freshResolvers();
    const format = jest
      .fn()
      .mockRejectedValueOnce(new Error('a format is already running'))
      .mockResolvedValueOnce(undefined);
    const ctx = { services: { node: { format } } };

    const refused = await r.NodeActions.format(null, {}, ctx);
    expect(refused.error.message).toMatch(/already running/);

    const retry = await r.NodeActions.format(null, {}, ctx);
    expect(retry.error).toBeNull(); // a real retry still works
  });

  it('leaves the mutation path unlimited', async () => {
    const r = freshResolvers();
    const format = jest.fn().mockResolvedValue(undefined);
    const ctx = { services: { node: { format } } };

    await r.NodeActions.format(null, {}, ctx); // alias spent
    const viaMutation = await r.NodeMutations.format(null, {}, ctx);
    expect(viaMutation.error).toBeNull();
    expect(format).toHaveBeenCalledTimes(2);
  });
});

describe('format @auth enforcement (executable schema)', () => {
  // The AST walk above checks declarations; only executing the real schema
  // proves @auth actually guards the disk wipe on BOTH paths.
  const { graphql } = require('graphql');
  const schema = require('../src/graphql/schema');

  const MUTATION = 'mutation { Node { format { error { message } } } }';
  const LEGACY_QUERY = 'query { Node { format { error { message } } } }';

  it.each([
    ['mutation', MUTATION],
    ['legacy query alias', LEGACY_QUERY],
  ])('rejects an unauthenticated %s', async (_, source) => {
    const format = jest.fn();
    const res = await graphql({
      schema,
      source,
      contextValue: { isAuthenticated: false, services: { node: { format } } },
    });
    expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(format).not.toHaveBeenCalled();
  });

  it.each([
    ['mutation', MUTATION],
    ['legacy query alias', LEGACY_QUERY],
  ])('runs the format service for an authenticated %s', async (_, source) => {
    const format = jest.fn().mockResolvedValue(undefined);
    const res = await graphql({
      schema,
      source,
      contextValue: { isAuthenticated: true, services: { node: { format } } },
    });
    expect(res.errors).toBeUndefined();
    expect(format).toHaveBeenCalledTimes(1);
    expect(res.data.Node.format.error).toBeNull();
  });
});
