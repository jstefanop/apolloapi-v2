// The device password is also the system password of the `futurebit` user, and
// it reaches `chpasswd` as a line on stdin ("user:password\n"). chpasswd is
// line-oriented, so a line break inside the password starts a NEW entry:
// "x\nroot:pwn" would set root's password. NUL ends the C string early.
// These characters are therefore refused outright, before anything is stored,
// so the app password and the system password cannot diverge.
//
// A colon is fine: chpasswd splits each line on the FIRST colon only, so the
// user name is cut at the first one and the rest (colons included) is the
// password. Spaces and quotes are literal too — there is no shell.
const FORBIDDEN = /[\n\r\0]/;

const PASSWORD_CHARS_ERROR = 'Password must not contain line breaks or null characters';

// Throws on anything chpasswd would not take as one literal password.
function assertPasswordSafe(password) {
  if (typeof password !== 'string' || FORBIDDEN.test(password)) {
    throw new Error(PASSWORD_CHARS_ERROR);
  }
}

// The same floor as the setup wizard and the change-password form. Enforced here
// as well because those are only the UI: the GraphQL API is open to any client
// holding a token, and the password it sets is also the device's system password.
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_LENGTH_ERROR = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

// What the auth service checks before storing anything: usable by chpasswd, and
// long enough.
function assertPasswordAcceptable(password) {
  assertPasswordSafe(password);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(PASSWORD_LENGTH_ERROR);
  }
}

module.exports = {
  assertPasswordSafe,
  assertPasswordAcceptable,
  PASSWORD_CHARS_ERROR,
  PASSWORD_LENGTH_ERROR,
  MIN_PASSWORD_LENGTH,
};
