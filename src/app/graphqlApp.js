const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { json } = require('body-parser');
const cors = require('cors');
const schema = require('../graphql/schema');
const { createContext } = require('../graphql/context');

async function setupApolloServer(app) {
  // Create Apollo Server
  const server = new ApolloServer({
    schema,
    formatError: (error) => {
      // Keep the original error message
      return {
        message: error.message,
        path: error.path,
        extensions: error.extensions
      };
    }
  });

  // Start the server
  await server.start();

  // Apply middleware
  app.use(
    '/api/graphql',
    cors(),
    json(),
    expressMiddleware(server, {
      context: createContext
    })
  );

  return app;
}

module.exports = setupApolloServer;