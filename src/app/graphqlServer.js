import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import store from './../store/index.js';
import schema from './../graphql/index.js';

// Create an async function to build and start ApolloServer
export async function createApolloServer() {
  // If your `schema` is a GraphQLSchema, pass { schema } directly
  // If it's { typeDefs, resolvers }, do: new ApolloServer({ typeDefs, resolvers })
  const apolloServer = new ApolloServer({
    schema,  // or { typeDefs, resolvers }
    // The "context" is the replacement for the old createGraphqlApp logic
    // We'll handle it in the expressMiddleware below (Apollo Server v4 style).
  });

  // Start the server so it's ready to handle requests
  await apolloServer.start();

  // Return both the server instance, and the "expressMiddleware" configured
  // so we can plug it into Express in app.js
  const apolloMiddleware = expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      return {
        dispatch(method, payload) {
          return store.dispatch(method, payload, req, {
            cid: req.headers['x-request-id'],
            internal: !!req.headers['x-test-request']
          });
        },
        jwt: {
          secret: process.env.APP_SECRET,
          audience: 'auth'
        }
      };
    }
  });

  return { apolloServer, apolloMiddleware };
}