const jwt = require('jsonwebtoken');
const config = require('config');
const services = require('../services');
const { knex } = require('../db');

async function createContext({ req }) {
  // Extract token from Authorization header
  const token = req.headers.authorization?.replace('Bearer ', '');

  // Create a base context
  const context = {
    knex,
    services,
    isAuthenticated: false,
    user: null
  };

  // If token exists, verify it
  if (token) {
    try {
      const decoded = jwt.verify(token, config.get('server.secret'), {
        audience: 'auth'
      });

      context.user = decoded;
      context.isAuthenticated = true;
    } catch (error) {
      // Token verification failed, but we'll continue with unauthenticated context
      console.error('JWT verification failed:', error.message);
    }
  }

  return context;
}

module.exports = { createContext };