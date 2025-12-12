exports.up = function(knex) {
  return knex('service_status').insert({
    service_name: 'solo',
    status: 'offline',
    requested_status: null,
    last_checked: knex.fn.now()
  });
};

exports.down = function(knex) {
  return knex('service_status').where({ service_name: 'solo' }).del();
};
