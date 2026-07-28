/**
 * Allow super_eco as a miner mode.
 *
 * miner_mode was declared with table.enum(), which on SQLite is a CHECK
 * constraint listing the values verbatim — so adding the mode to the GraphQL
 * enum is not enough, the write is rejected by the database itself. Super ECO is
 * the Apollo III low-power preset; the USB miners never see it, the generator
 * maps it down to eco for them.
 *
 * Done by rewriting the table DDL rather than with knex's .alter(): on SQLite
 * that ADDS a second CHECK and leaves the original in place, so the two are
 * ANDed together and the new value stays rejected — the migration reports
 * success while changing nothing. Rewriting the stored DDL keeps every other
 * column exactly as it was, which a hand-written CREATE TABLE would not.
 */
const MODES = ['super_eco', 'eco', 'balanced', 'turbo', 'custom'];

const checkClause = (modes) =>
  `CHECK (\`miner_mode\` in (${modes.map((m) => `'${m}'`).join(', ')}))`;

/**
 * Find a column's definition inside a CREATE TABLE statement. Commas and
 * parentheses appear inside CHECK clauses too, so the scan is depth-aware
 * instead of a plain split.
 */
function columnDefinitionRange(ddl, column) {
  const start = ddl.indexOf(`\`${column}\``);
  if (start === -1) throw new Error(`Column ${column} not found in settings DDL`);

  let depth = 0;
  for (let i = start; i < ddl.length; i++) {
    const char = ddl[i];
    if (char === '(') depth++;
    else if (char === ')') {
      // The closing paren of CREATE TABLE( … ) ends the last column too.
      if (depth === 0) return { start, end: i };
      depth--;
    } else if (char === ',' && depth === 0) {
      return { start, end: i };
    }
  }
  throw new Error(`Could not find the end of the ${column} definition`);
}

async function rewriteMinerModeCheck(knex, modes) {
  const [{ sql: ddl }] = await knex.raw(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'"
  );

  const { start, end } = columnDefinitionRange(ddl, 'miner_mode');
  const rebuilt =
    ddl.slice(0, start) +
    `\`miner_mode\` text NOT NULL ${checkClause(modes)}` +
    ddl.slice(end);

  // Same column order in both tables, so an unqualified INSERT … SELECT is exact.
  const columns = Object.keys(await knex('settings').columnInfo())
    .map((c) => `\`${c}\``)
    .join(', ');

  const createTemp = rebuilt.replace(
    /CREATE TABLE\s+["`']?settings["`']?/i,
    'CREATE TABLE `settings_migration_tmp`'
  );

  await knex.transaction(async (trx) => {
    await trx.raw('PRAGMA defer_foreign_keys = ON');
    await trx.raw(createTemp);
    await trx.raw(
      `INSERT INTO \`settings_migration_tmp\` (${columns}) SELECT ${columns} FROM \`settings\``
    );
    await trx.raw('DROP TABLE `settings`');
    await trx.raw('ALTER TABLE `settings_migration_tmp` RENAME TO `settings`');
  });
}

exports.up = function (knex) {
  return rewriteMinerModeCheck(knex, MODES);
};

exports.down = async function (knex) {
  // Rows on the mode being removed would violate the narrower constraint, so
  // fold them back to what the USB miners would have run anyway.
  await knex('settings').where({ miner_mode: 'super_eco' }).update({ miner_mode: 'eco' });
  return rewriteMinerModeCheck(
    knex,
    MODES.filter((m) => m !== 'super_eco')
  );
};
