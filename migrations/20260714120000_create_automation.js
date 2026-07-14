/**
 * Miner scheduling & automation — phase 1.
 *
 * Rules are structured (conditions + action), so they cannot live in `settings`,
 * which is an append-only snapshot table capped at 100 rows.
 */
exports.up = async function (knex) {
  // Single-row table (id = 1) holding the global automation configuration.
  await knex.schema.createTable('automation_config', (table) => {
    table.increments('id').primary();
    table.boolean('enabled').defaultTo(false);

    // Observation mode: evaluate and log every decision, but never touch the
    // miner. Lets a user (or us) watch the engine reason for a few days before
    // handing it the controls. On by default — the automation earns trust first.
    table.boolean('dry_run').defaultTo(true);

    // Needed by the sun signals. NULL means the sun.* signals report as stale.
    table.float('latitude').nullable();
    table.float('longitude').nullable();
    table.string('timezone').nullable();

    // What to do when no rule matches: 'keep' (leave the miner alone), 'off',
    // or 'on:<mode>' (e.g. 'on:eco').
    table.string('fallback_action').defaultTo('keep');

    // Manually entered energy cost — the worldwide baseline, no API involved.
    // JSON: { currency, flatPrice, periods: [{ days:[1-7], from:'23:00', to:'07:00', price, band }] }
    table.text('tariff').nullable();

    // Hardware guard rails. ASICs and PSUs dislike fast cycling, and a mode
    // change means restarting apollo-miner (minutes to stabilize).
    table.integer('min_on_minutes').defaultTo(30);
    table.integer('min_off_minutes').defaultTo(30);
    table.integer('min_change_minutes').defaultTo(15);
    table.integer('max_cycles_per_hour').defaultTo(2);
    table.float('default_hysteresis').defaultTo(2);

    // A manual start/stop pauses the automation until this timestamp, rather than
    // fighting the user: a miner that undoes your click 30 seconds later is the
    // fastest way to make someone disable the feature for good.
    table.integer('override_minutes').defaultTo(60);
    table.timestamp('override_until').nullable();
    table.string('override_reason').nullable();

    table.timestamps(true, true);
  });

  await knex('automation_config').insert({ id: 1 });

  await knex.schema.createTable('automation_rules', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.boolean('enabled').defaultTo(true);
    table.integer('priority').defaultTo(100); // lower runs first

    // Safety rules (over-temperature) are evaluated even while the automation is
    // overridden, and they bypass the guard rails.
    table.boolean('is_safety').defaultTo(false);

    table.string('match').defaultTo('all'); // 'all' | 'any' — no nesting in phase 1
    table.text('conditions').notNullable(); // JSON: [{ signal, op, value, values, hysteresis }]
    table.text('action').notNullable(); // JSON: { type:'off' } | { type:'mode', mode }

    table.timestamps(true, true);

    table.index('priority', 'idx_automation_rules_priority');
  });

  // Ring buffer (capped in the service). Feeds the guard rails (last change,
  // cycles per hour), the UI history, and on-device debugging.
  await knex.schema.createTable('automation_events', (table) => {
    table.increments('id').primary();
    table.integer('rule_id').nullable(); // null for fallback / override / no-match
    table.string('rule_name').nullable();
    table.string('decision').notNullable(); // 'off' | 'mode:eco' | 'none'
    table.string('change_type').nullable(); // 'start' | 'stop' | 'mode' | null
    table.boolean('applied').defaultTo(false);
    table.boolean('dry_run').defaultTo(false);
    table.string('blocked_by').nullable(); // 'override' | 'min_on' | 'min_off' | 'min_change' | 'max_cycles'
    table.text('signals').nullable(); // JSON snapshot: why this decision was taken
    table.text('message').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('created_at', 'idx_automation_events_created_at');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('automation_events');
  await knex.schema.dropTableIfExists('automation_rules');
  await knex.schema.dropTableIfExists('automation_config');
};
