/**
 * MQTT / Home Assistant input for the automation.
 *
 * One JSON blob on the single automation_config row holding the broker
 * connection and the user's input mappings:
 *   {
 *     enabled, host, port, username, password, tls,
 *     inputs: [{ name, topic, jsonPath, unit }]
 *   }
 * Each input becomes an `input.<name>` number signal the rules can react to
 * (e.g. the solar surplus published by the SUN2000→MQTT bridge).
 */
exports.up = function (knex) {
  return knex.schema.alterTable('automation_config', (table) => {
    table.text('mqtt').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('automation_config', (table) => {
    table.dropColumn('mqtt');
  });
};
