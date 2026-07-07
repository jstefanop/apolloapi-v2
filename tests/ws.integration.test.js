// tests/ws.integration.test.js
// End-to-end integration test for the GraphQL WebSocket Subscription pipeline.
// Spins up a real Express + Apollo + graphql-ws server on an ephemeral port,
// connects with a real graphql-ws client, subscribes, publishes via pubsub, and
// asserts the event is received.
//
// Auth variants:
//   OK  — valid JWT → connection accepted, event delivered
//   Fail — missing token  → connection rejected with "Unauthorized"
//   Fail — invalid token  → connection rejected with "Unauthorized"

// Use the real Apollo Server middleware (setup.js mocks this)
jest.unmock('@apollo/server/express4');

// The scheduler is still mocked (setup.js) — pushAllStats is a no-op which is fine for WS tests.

jest.setTimeout(20000);

const http   = require('http');
const express = require('express');
const jwt    = require('jsonwebtoken');
const { createClient } = require('graphql-ws');
const { WebSocket }   = require('ws');

const SECRET   = 'test-secret-key-for-jwt-token-generation';
const AUDIENCE = 'auth';

function makeToken(payload = { sub: 'testuser', username: 'testuser' }) {
  return jwt.sign(payload, SECRET, { audience: AUDIENCE, expiresIn: '1h' });
}

// Build a one-off server and return { url, wss, httpServer, close }
async function startTestServer() {
  const app        = express();
  const httpServer = http.createServer(app);

  const setupApolloServer = require('../src/app/graphqlApp');
  await setupApolloServer(app, httpServer);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const url = `ws://127.0.0.1:${port}/api/graphql`;

  async function close() {
    await new Promise((res) => httpServer.close(res));
  }

  return { url, httpServer, close };
}

// Create a graphql-ws client and wait until it is connected (or fails)
function makeWsClient(url, token) {
  const connParams = token ? { authorization: `Bearer ${token}` } : {};
  return createClient({
    url,
    webSocketImpl: WebSocket,
    connectionParams: connParams,
    retryAttempts: 0, // don't retry on auth failure
    shouldRetry: () => false,
  });
}

// Subscribe to the `mcu` subscription and collect the first received value.
// Always resolves (never rejects) — returns { type: 'next'|'error'|'complete', data?, err? }.
function subscribeToMcu(client) {
  return new Promise((resolve) => {
    client.subscribe(
      {
        query: `
          subscription {
            mcu {
              result {
                stats {
                  uptime
                }
              }
              error {
                message
              }
            }
          }
        `,
      },
      {
        next:     (data) => resolve({ type: 'next', data }),
        error:    (err)  => resolve({ type: 'error', err }),
        complete: ()     => resolve({ type: 'complete' }),
      }
    );
  });
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('WebSocket GraphQL Subscriptions — integration', () => {
  let server;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server?.close();
  });

  // ----------------------------------------------------------------------- //
  // Auth: valid token
  // ----------------------------------------------------------------------- //
  it('Auth OK — valid token: client connects and receives a published event', async () => {
    const pubsub = require('../src/graphql/pubsub');
    const TOPICS = require('../src/graphql/topics');

    const token  = makeToken();
    const client = makeWsClient(server.url, token);

    try {
      const eventPromise = subscribeToMcu(client);

      // Give the subscription a moment to register, then publish
      await new Promise((r) => setTimeout(r, 400));
      pubsub.publish(TOPICS.MCU, {
        mcu: { result: { stats: { uptime: '12345' } }, error: null },
      });

      const result = await Promise.race([
        eventPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve({ type: 'timeout' }), 5000)
        ),
      ]);

      expect(result.type).toBe('next');
      // graphql-ws next callback receives { data: { mcu: ... } }
      expect(result.data?.data?.mcu).toBeDefined();
    } finally {
      client.dispose();
    }
  });

  // ----------------------------------------------------------------------- //
  // Auth: missing token
  // ----------------------------------------------------------------------- //
  it('Auth fail — missing token: connection is rejected', async () => {
    const client = makeWsClient(server.url, null /* no token */);

    // The subscription error callback receives a CloseEvent or Error when auth fails
    const result = await new Promise((resolve) => {
        client.subscribe(
          {
            query: `subscription {
              mcu { result { stats { uptime } } error { message } }
            }`,
          },
          {
            next: () => resolve({ type: 'next' }),
            error: (err) => resolve({ type: 'error', err }),
            complete: () => resolve({ type: 'complete' }),
          }
        );

        // Safety timeout in case the client hangs
        setTimeout(() => resolve({ type: 'timeout' }), 5000);
      });

    client.dispose();

    // We expect an error (auth rejection), not data
    expect(result.type).toBe('error');
  });

  // ----------------------------------------------------------------------- //
  // Auth: invalid token
  // ----------------------------------------------------------------------- //
  it('Auth fail — invalid/tampered token: connection is rejected', async () => {
    const badToken = makeToken() + 'TAMPERED';
    const client   = makeWsClient(server.url, badToken);

    const result = await new Promise((resolve) => {
      client.subscribe(
        {
          query: `subscription {
            mcu { result { stats { uptime } } error { message } }
          }`,
        },
        {
          next: () => resolve({ type: 'next' }),
          error: (err) => resolve({ type: 'error', err }),
          complete: () => resolve({ type: 'complete' }),
        }
      );

      setTimeout(() => resolve({ type: 'timeout' }), 5000);
    });

    client.dispose();

    expect(result.type).toBe('error');
  });
});
