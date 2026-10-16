// Asking for a service transition (start / stop / restart) without announcing one
// that never began.
//
// The request is written to service_status BEFORE the command runs, on purpose:
// the service monitor must find `pending` + the requested state when the unit
// changes, or it reads the change as a crash or a manual action and acts on it.
// But it is only PUBLISHED once the command was accepted. Published first, the
// "pending" reached every open browser ahead of a failure, which then announced
// "Starting miner" over a restart that systemctl had refused.
//
// On a refusal the row goes back to what it was, but only if it is still the
// request this call wrote (same requested_at): by then the monitor may have
// moved it on, and putting an old value over a newer one would be the bug again.

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

module.exports = { begin, revert };
