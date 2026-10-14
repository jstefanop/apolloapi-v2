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

module.exports = { assertPasswordSafe, PASSWORD_CHARS_ERROR };
