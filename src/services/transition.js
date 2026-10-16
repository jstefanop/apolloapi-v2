// Asking for a service transition (start / stop / restart) without announcing one
// that never began, and without two requests undoing each other.
//
// The request is written to service_status BEFORE the command runs, on purpose:
// the service monitor must find `pending` + the requested state when the unit
// changes, or it reads the change as a crash or a manual action and acts on it.
// But it is only PUBLISHED once the command was accepted. Published first, the
// "pending" reached every open browser ahead of a failure, which then announced
// "Starting miner" over a restart that systemctl had refused.
//
// On a refusal the row goes back to what it was. Two requests for the same
// service therefore take turns (a chain per service): with both in flight, each
// would remember the other's pending request as "what it was", and the second
// refusal would put back a request that had itself been refused — which the
// monitor then obeys.
//
// The command must only be one that returns once systemd has ACCEPTED the job
// (`systemctl ... --no-block`), so that failing means "refused" and nothing
// else; whether the job then succeeds is the monitor's to decide.

const { GraphQLError } = require('graphql');

const chains = new Map();

const begin = async (knex, serviceName, requestedStatus) => {
  const previous = await knex('service_status')
    .where({ service_name: serviceName })
    .first();
  const requestedAt = Date.now();
  await knex('service_status')
    .where({ service_name: serviceName })
    .update({
      status: 'pending',
      requested_status: requestedStatus,
      requested_at: requestedAt,
    });
  return { serviceName, requestedAt, previous };
};

// Only if the row is still the request this call wrote (same requested_at): by
// then the monitor may have moved it on, and an old value over a newer one would
// be the bug again.
const revert = async (knex, ticket) => {
  const { serviceName, requestedAt, previous } = ticket;
  if (!previous) return;
  await knex('service_status')
    .where({ service_name: serviceName, status: 'pending', requested_at: requestedAt })
    .update({
      status: previous.status,
      requested_status: previous.requested_status,
      requested_at: previous.requested_at,
    });
};

// systemctl or the bus can stall. A request that never answers must not hold a
// service's queue for ever: after this long it counts as refused, with the state
// uncertain (the row goes back to what it was, and the monitor settles what is
// really running).
const COMMAND_TIMEOUT_MS = 60000;

const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer within ${ms / 1000}s; its state is uncertain`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const execute = async (knex, serviceName, requestedStatus, command, notify, timeoutMs) => {
  const ticket = await begin(knex, serviceName, requestedStatus);
  try {
    // The command is told which request it belongs to, for whatever it does
    // afterwards (see solo.js): `requestedAt` is how a later write recognises that
    // a newer request has taken the row over.
    const result = await withTimeout(
      Promise.resolve().then(() => command({ requestedAt: ticket.requestedAt })),
      timeoutMs,
      `${serviceName} ${requestedStatus} command`
    );
    // Accepted: now it is a transition worth announcing.
    notify?.();
    return result;
  } catch (error) {
    try {
      await revert(knex, ticket);
    } catch (revertError) {
      console.error('Failed to restore the service status:', revertError.message);
    }
    notify?.();
    throw error;
  }
};

/**
 * Ask for `requestedStatus` on `serviceName` by running `command`.
 * Resolves with the command's result once it was accepted; rejects with its
 * error after putting the request back. One at a time per service.
 */
const run = (knex, serviceName, requestedStatus, command, { notify, timeoutMs = COMMAND_TIMEOUT_MS } = {}) => {
  const previous = chains.get(serviceName) || Promise.resolve();
  const job = previous.then(() => execute(knex, serviceName, requestedStatus, command, notify, timeoutMs));
  chains.set(
    serviceName,
    job.catch(() => {})
  );
  return job;
};

// What the caller sees when the command was refused. The raw error holds the
// command line and sudo's own words ("Command failed: sudo systemctl ... a
// terminal is required"): useful in the log, noise on a screen. The client picks
// its localised text from the code, service and action.
const LABELS = { miner: 'miner', node: 'Bitcoin node', solo: 'solo pool' };

const refused = (service, action, error) => {
  console.error(`${service} ${action} refused: ${error.message}`);
  return new GraphQLError(`Could not ${action} the ${LABELS[service] || service}`, {
    extensions: { code: 'SERVICE_COMMAND_FAILED', service, action },
  });
};

module.exports = { run, refused };
