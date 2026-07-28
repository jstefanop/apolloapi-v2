const fs = require('fs');
const os = require('os');
const path = require('path');
const Knex = require('knex');

const migration = require('../migrations/20260728120000_add_super_eco_miner_mode');

// This migration rewrites a CHECK constraint, which SQLite cannot alter in place:
// it reads the stored DDL, replaces one column definition and rebuilds the table.
// Nothing else exercises it — the test schema is hand-built rather than migrated —
// and a failure is invisible in production, because runMigrations() swallows it and
// the API boots normally. The only symptom would be that Super ECO can never be
// selected, on every device, forever.
describe('migration: super_eco in the miner_mode constraint', () => {
  let knex;
  let file;

  beforeEach(async () => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-mig-')), 'test.sqlite');
    knex = Knex({ client: 'sqlite3', connection: { filename: file }, useNullAsDefault: true });

    // The table as the initial migration leaves it: table.enum() without super_eco.
    await knex.schema.createTable('settings', (table) => {
      table.increments('id');
      table.enu('miner_mode', ['eco', 'balanced', 'turbo', 'custom']).notNullable();
      table.integer('voltage').notNullable().defaultTo(30);
      table.integer('frequency').notNullable().defaultTo(25);
      table.string('btcsig').notNullable().defaultTo('mined by Solo Apollo');
      table.integer('miner_hashrate').nullable();
      table.timestamps(true, true);
    });

    await knex('settings').insert([
      { miner_mode: 'eco', voltage: 30, frequency: 25 },
      { miner_mode: 'turbo', voltage: 40, frequency: 30, miner_hashrate: 18 },
    ]);
  });

  afterEach(async () => {
    await knex.destroy();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  const insertMode = (mode) =>
    knex('settings').insert({ miner_mode: mode, voltage: 30, frequency: 25 });

  it('rejects super_eco before it runs, which is the bug being fixed', async () => {
    await expect(insertMode('super_eco')).rejects.toThrow(/CHECK constraint/);
  });

  it('accepts super_eco afterwards', async () => {
    await migration.up(knex);
    await expect(insertMode('super_eco')).resolves.toBeDefined();
  });

  it('still rejects a mode that is not in the list', async () => {
    await migration.up(knex);
    // knex's own .alter() left the original CHECK in place alongside the new one,
    // so proving the constraint is still enforced matters as much as proving the
    // new value is allowed.
    await expect(insertMode('nonsense')).rejects.toThrow(/CHECK constraint/);
  });

  it('leaves exactly one constraint behind, not two ANDed together', async () => {
    await migration.up(knex);
    const [{ sql }] = await knex.raw(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'"
    );
    const checks = sql.match(/miner_mode` in ?\([^)]*\)/g) || [];
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain('super_eco');
  });

  it('carries every row across the table rebuild', async () => {
    const before = await knex('settings').select('*').orderBy('id');
    await migration.up(knex);
    const after = await knex('settings').select('*').orderBy('id');
    expect(after).toEqual(before);
  });

  it('folds super_eco rows back to eco when rolled back', async () => {
    await migration.up(knex);
    await insertMode('super_eco');
    await migration.down(knex);

    const modes = (await knex('settings').select('miner_mode')).map((r) => r.miner_mode);
    expect(modes).not.toContain('super_eco');
    await expect(insertMode('super_eco')).rejects.toThrow(/CHECK constraint/);
  });
});
