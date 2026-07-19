// T1 GraphQL-integration harness.
// Mounts the REAL Apollo schema + REAL services (against the in-memory DB from
// tests/setup.js) and executes operations end-to-end. Tests mock only the
// system boundary (service command execution and filesystem writes).
// So we exercise: resolver → service → config/DB writes → serviceMonitor state,
// without a device.
const { graphql } = require('graphql');
const schema = require('../../src/graphql/schema');
const services = require('../../src/services');
const { knex } = require('../../src/db');

const authedContext = () => ({ knex, services, isAuthenticated: true, user: { sub: 'apollouser' } });
const anonContext = () => ({ knex, services, isAuthenticated: false, user: null });

// Run a GraphQL operation. `auth` defaults to true (authenticated context).
async function run(source, { variables = {}, auth = true } = {}) {
  return graphql({
    schema,
    source,
    variableValues: variables,
    contextValue: auth ? authedContext() : anonContext(),
  });
}

module.exports = { run, schema, services, knex };
