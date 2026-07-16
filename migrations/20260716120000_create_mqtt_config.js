/**
 * System-level MQTT config.
 *
 * The MQTT link belongs to the whole device, not just the automation: the broker
 * connection and the published telemetry (Home Assistant discovery) matter to a
 * solo-node too, where the automation page is hidden. So the broker + output +
 * input mappings move out of automation_config into their own single row here.
 *
 *   broker  : host/port/username/password/tls (+ enabled)
 *   output  : { enabled, control, exports:{ miner, node, solo, mcu } } (JSON)
 *   inputs  : [{ name, topic, jsonPath, unit }] (JSON) — topics mapped to signals
 *
 * The data migration moves whatever automation_config.mqtt already held.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('mqtt_config', (table) => {
    table.integer('id').primary();
    table.boolean('enabled').defaultTo(false); // broker connection enabled
    table.string('host');
    table.integer('port').defaultTo(1883);
    table.string('username');
    table.string('password');
    table.boolean('tls').defaultTo(false);
    table.text('output'); // JSON
    table.text('inputs'); // JSON
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Seed the single row, carrying over any existing automation MQTT config.
  let mqtt = null;
  try {
    const row = await knex('automation_config').where({ id: 1 }).first();
    if (row && row.mqtt) mqtt = typeof row.mqtt === 'string' ? JSON.parse(row.mqtt) : row.mqtt;
  } catch (e) {
    /* automation_config or its mqtt column may not exist — seed empty */
  }

  await knex('mqtt_config').insert({
    id: 1,
    enabled: mqtt ? !!mqtt.enabled : false,
    host: mqtt ? mqtt.host || null : null,
    port: mqtt ? mqtt.port || 1883 : 1883,
    username: mqtt ? mqtt.username || null : null,
    password: mqtt ? mqtt.password || null : null,
    tls: mqtt ? !!mqtt.tls : false,
    output: mqtt && mqtt.output ? JSON.stringify(mqtt.output) : null,
    inputs: mqtt && mqtt.inputs ? JSON.stringify(mqtt.inputs) : null,
  });

  // Leave automation_config.mqtt in place (now unused) to avoid a destructive
  // column drop; the code stops reading it.
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('mqtt_config');
};
