const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { useServer } = require('graphql-ws/use/ws');
const { WebSocketServer } = require('ws');
const { json } = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const config = require('config');
const schema = require('../graphql/schema');
const { createContext } = require('../graphql/context');
const { knex } = require('../db');
const services = require('../services');

async function setupApolloServer(app, httpServer) {
  // Create Apollo Server (HTTP)
  const server = new ApolloServer({
    schema,
    formatError: (error) => ({
      message: error.message,
      path: error.path,
      extensions: error.extensions
    })
  });

  await server.start();

  // WebSocket server — shares the same port/path as Apollo HTTP
  const wss = new WebSocketServer({ server: httpServer, path: '/api/graphql' });

  useServer(
    {
      schema,
      // Authenticate the WS connection using the JWT passed in connectionParams.
      // Throwing here rejects the connection before any subscription can be opened.
      onConnect: async (ctx) => {
        const authHeader = ctx.connectionParams?.authorization || '';
        const token = authHeader.replace('Bearer ', '').trim();

        if (!token) {
          throw new Error('Unauthorized: missing token');
        }

        try {
          const user = jwt.verify(token, config.get('server.secret'), {
            audience: 'auth',
          });

          console.log(`[WS] Client connected, user: ${user.username || user.sub || 'unknown'}`);

          // Trigger an immediate data push ~1s after connection so the client
          // gets data right away without waiting for the next scheduler tick.
          // The delay lets all 6 subscription async iterators register before the first publish.
          const initialPushTimer = setTimeout(() => {
            try {
              // Import lazily to avoid circular dependency at module load time
              const { pushAllStats } = require('./scheduler');
              if (typeof pushAllStats !== 'function') return;
              Promise.resolve(pushAllStats()).catch((error) => {
                console.error('[WS] Initial stats push failed:', error);
              });
            } catch (error) {
              console.error('[WS] Could not start initial stats push:', error);
            }
          }, 1000);
          if (ctx.extra) {
            ctx.extra.apolloInitialPushTimer = initialPushTimer;
          }

          return { user };
        } catch (err) {
          console.warn('[WS] Auth failed:', err.message);
          throw new Error('Unauthorized: invalid token');
        }
      },
      onDisconnect: (ctx) => {
        if (ctx.extra?.apolloInitialPushTimer) {
          clearTimeout(ctx.extra.apolloInitialPushTimer);
          ctx.extra.apolloInitialPushTimer = null;
        }
        console.log('[WS] Client disconnected');
      },
      // Build the GraphQL execution context for each subscription operation
      context: (ctx) => ({
        knex,
        services,
        isAuthenticated: !!ctx.extra?.user,
        user: ctx.extra?.user,
      }),
    },
    wss
  );

  // Apply Apollo HTTP middleware (unchanged — handles queries and mutations)
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
