/**
 * Apollo III tuning settings.
 *
 * The III tunes board voltage internally, so the legacy voltage/frequency pair
 * does not apply to it: custom mode is a single target hashrate (5-22 TH/s).
 * Fan control is one PID target temperature, with an optional fixed-PWM override
 * for people who want to force it.
 *
 * These are additive and nullable: null means "not set", which is what makes the
 * generator able to tell "leave the binary on its default" apart from a real
 * value. The legacy columns stay untouched — Apollo I/II keep using them.
 */
exports.up = function (knex) {
  return knex.schema.table('settings', (table) => {
    table.integer('miner_hashrate').nullable();
    table.integer('fan_temp').nullable();
    table.integer('fan_pwm').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table('settings', (table) => {
    table.dropColumn('miner_hashrate');
    table.dropColumn('fan_temp');
    table.dropColumn('fan_pwm');
  });
};
