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

    // Change the system password before committing the application password.
    if (isProduction()) {
      await this.utils.auth.changeSystemPassword(password);
    }

    await this.knex('setup').update({
      password: hashedPassword
    });
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

      // Set the system password before committing setup. A chpasswd failure
      // must leave the setup wizard retryable.
      if (isProduction()) {
        await this.utils.auth.changeSystemPassword(password);
      }

      await this.knex('setup').insert({
        password: hashedPassword
      });
    } catch (err) {
      console.log('ERROR', err);
      throw err;
    }
  }

}

module.exports = (knex, utils) => new AuthService(knex, utils);