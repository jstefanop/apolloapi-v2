const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { GraphQLError } = require('graphql');

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
    const [setup] = await this.knex('setup').select('*').limit(1);

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
  async changePassword({ password }) {
    // Check if setup exists
    const [setup] = await this.knex('setup').select('*').limit(1);

    if (!setup) {
      throw new Error('Setup not finished');
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update the password in the database
    await this.knex('setup').update({
      password: hashedPassword
    });

    // Also update the system password (only in production; uses stdin-based chpasswd, no shell)
    if (isProduction()) {
      await this.utils.auth.changeSystemPassword(password);
    }
  }

  // Initial setup
  async setup({ password }) {
    try {
      // Check if setup already exists
      const [setup] = await this.knex('setup').select('*').limit(1);

      if (setup) {
        throw new Error('Setup already done');
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insert the setup record
      await this.knex('setup').insert({
        password: hashedPassword
      });

      // Set the system password (only in production; uses stdin-based chpasswd, no shell)
      if (isProduction()) {
        await this.utils.auth.changeSystemPassword(password);
      }
    } catch (err) {
      // Neither the error object nor its message may be logged as-is: this is a
      // Knex error, and the bindings on the insert above are the password hash.
      // The object carries them in `bindings`, and knex interpolates them into
      // `message` too — which is why db.js sets compileSqlOnError:false. Log the
      // code alone; the error still propagates to the caller.
      console.error('Failed to set password. Database error code:', err.code || 'unknown');
      throw err;
    }
  }

}

module.exports = (knex, utils) => new AuthService(knex, utils);