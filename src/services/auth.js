const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { GraphQLError } = require('graphql');
const { assertPasswordAcceptable } = require('../passwordPolicy');

// setup and changePassword both end in a system password change and a stored
// hash, and neither is atomic. Run concurrently they interleave (two setups would
// each pass the "already done" check, and the system password could end up
// belonging to one while the login hash belongs to the other), so they take turns.
// In-process is enough: there is one API process per device.
let turn = Promise.resolve();
const inTurn = (fn) => {
  const run = turn.then(fn, fn);
  turn = run.catch(() => {});
  return run;
};

// Helper function to check if we're in production environment
const isProduction = () => process.env.NODE_ENV === 'production';

class AuthService {
  constructor(knex, utils) {
    this.knex = knex;
    this.utils = utils;
  }

  // Login method
  async login({ password }) {
    // Retrieve the setup record
    const [setup] = await this.knex('setup').select('*').orderBy('id').limit(1);

    if (!setup) {
      throw new GraphQLError('Setup not finished', {
        extensions: { code: 'UNAUTHENTICATED' }
      });
    }

    // Compare the password
    const isPasswordValid = await bcrypt.compare(password, setup.password);

    if (!isPasswordValid) {
      throw new GraphQLError('Invalid password', {
        extensions: { code: 'UNAUTHENTICATED' }
      });
    }

    // Generate JWT token
    const accessToken = jwt.sign({}, config.get('server.secret'), {
      subject: 'apollouser',
      audience: 'auth'
    });

    return { accessToken };
  }

  // Check setup status
  async status() {
    const [setup] = await this.knex('setup').select('*').limit(1);
    const status = setup ? 'done' : 'pending';
    return { status };
  }

  // Change password
  changePassword({ password }) {
    return inTurn(() => this._changePassword({ password }));
  }

  async _changePassword({ password }) {
    // Before anything is stored: the app and system passwords must not diverge,
    // and the password must be one the wizard would have accepted.
    assertPasswordAcceptable(password);

    // Check if setup exists
    const [setup] = await this.knex('setup').select('*').orderBy('id').limit(1);

    if (!setup) {
      throw new Error('Setup not finished');
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // The system password first (only in production; uses stdin-based chpasswd,
    // no shell). It is the step that can fail for reasons of the machine, and it
    // cannot be undone — nothing here knows the previous password to put back. So
    // it goes first: if it fails, nothing was written and both passwords are
    // still the old one.
    if (isProduction()) {
      await this.utils.auth.changeSystemPassword(password);
    }

    // Then the login hash. A failure here leaves the system on the new password
    // and the login on the old one; chpasswd cannot be rolled back, so say so
    // plainly instead of reporting a generic database error. Repeating the change
    // brings them back in line (chpasswd just sets the same password again).
    try {
      await this.knex('setup').where('id', setup.id).update({
        password: hashedPassword
      });
    } catch (err) {
      // Message only: a knex error object carries the bindings, which here are
      // the password hash.
      console.error('Failed to store the new login password:', err.message);
      throw new Error(
        'The system password was changed, but the new login password could not be saved: ' +
          'the previous login password still works. Repeat the change to bring them back in line.'
      );
    }
  }

  // Initial setup
  setup({ password }) {
    return inTurn(() => this._setup({ password }));
  }

  async _setup({ password }) {
    try {
      // Before anything is stored: the app and system passwords must not diverge,
      // and the password must be one the wizard would have accepted.
      assertPasswordAcceptable(password);

      // Checked inside the turn, so a second setup that queued behind the first
      // sees its row.
      const [setup] = await this.knex('setup').select('*').limit(1);

      if (setup) {
        throw new Error('Setup already done');
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 12);

      // The system password first (only in production; uses stdin-based chpasswd,
      // no shell). Insert first and a chpasswd failure left a setup row behind:
      // the wizard then said "Setup already done" and the one flow a user cannot
      // retry past was stuck. This way a failure leaves no setup row, and a
      // failed insert after it only means the wizard is run again.
      if (isProduction()) {
        await this.utils.auth.changeSystemPassword(password);
      }

      // Insert the setup record
      await this.knex('setup').insert({
        password: hashedPassword
      });
    } catch (err) {
      // The message is safe to log — db.js sets compileSqlOnError:false, so knex
      // leaves `?` placeholders in it rather than interpolating the bindings,
      // which on the insert above are the password hash. The error OBJECT is not:
      // it still carries `bindings`, so log the message only.
      //
      // This block also wraps changeSystemPassword, whose failures are plain
      // Errors with no `code` — logging that alone left the one flow a user
      // cannot retry past with nothing to explain it.
      console.error('Failed to set password:', err.message);
      throw err;
    }
  }

}

module.exports = (knex, utils) => new AuthService(knex, utils);