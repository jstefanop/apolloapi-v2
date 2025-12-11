// Mock config values for testing
module.exports = {
  db: {
    url: ':memory:'
  },
  server: {
    port: 5002,
    secret: 'test-secret-key-for-jwt-token-generation'
  }
};