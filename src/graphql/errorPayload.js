// The `error` of a mutation/query payload, from a thrown error.
//
// A refused service command (see services/transition.js) carries which service
// and which action in its GraphQL extensions. The resolvers catch it and answer
// with a payload, so those extensions would be lost on the way: carry them in
// the fields the `Error` type already has — `type` is the code, `path` is
// "service.action" — so the UI can word the failure in the user's language.
// Anything else stays a bare message, as before.
const errorPayload = (error) => {
  const ext = error?.extensions;
  if (ext?.code === 'SERVICE_COMMAND_FAILED' && ext.service && ext.action) {
    return { message: error.message, type: ext.code, path: `${ext.service}.${ext.action}` };
  }
  return { message: error.message };
};

module.exports = { errorPayload };
