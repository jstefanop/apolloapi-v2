const fs = require('fs');
const os = require('os');
const path = require('path');
const Knex = require('knex');

const migration = require('../migrations/20260806000000_pool_profiles');

// The schema lives in two places here — migrations/ for devices, tests/setup.js
// for the suite — so the service tests can pass against a table the real
// migration never produces. This runs the migration itself.
describe('migration: pool_profiles', () => {
  let knex;

  beforeEach(async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-poolprof-')),
      'test.sqlite'
    );
    knex = Knex({
      client: 'sqlite3',
      connection: { filename: file },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('creates the table the service reads', async () => {
    await migration.up(knex);

    expect(await knex.schema.hasTable('pool_profiles')).toBe(true);
    for (const column of ['id', 'name', 'url', 'username', 'password', 'created_at']) {
      expect(await knex.schema.hasColumn('pool_profiles', column)).toBe(true);
    }
  });

  // Re-saving under a name is the only correction available with no manage
  // screen, and the service leans on this constraint to know a name is taken.
  it('refuses a second profile with the same name', async () => {
    await migration.up(knex);
    await knex('pool_profiles').insert({ name: 'Ocean', url: 'stratum+tcp://a:1' });

    await expect(
      knex('pool_profiles').insert({ name: 'Ocean', url: 'stratum+tcp://b:2' })
    ).rejects.toThrow(/unique/i);
  });

  it('does not require a worker or a password', async () => {
    await migration.up(knex);

    await expect(
      knex('pool_profiles').insert({ name: 'Bare', url: 'stratum+tcp://a:1' })
    ).resolves.toBeDefined();
  });

  it('rolls back cleanly', async () => {
    await migration.up(knex);
    await migration.down(knex);

    expect(await knex.schema.hasTable('pool_profiles')).toBe(false);
  });
});
