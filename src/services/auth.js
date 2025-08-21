const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { exec } = require('child_process');
const { AuthenticationError } = require('@apollo/server');

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
      throw new AuthenticationError('Setup not finished');
    }

    // Compare the password
    const isPasswordValid = await bcrypt.compare(password, setup.password);

    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid password');
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

    // Also update the system password
    await this._changeSystemPassword(password);
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

      // Set the system password
      await this._changeSystemPassword(password);
    } catch (err) {
      console.log('ERROR', err);
      throw err;
    }
  }

  // Helper method to change system password
  async _changeSystemPassword(password) {
    return new Promise((resolve, reject) => {
      exec(`echo 'futurebit:${password}' | sudo chpasswd`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = (knex, utils) => new AuthService(knex, utils);