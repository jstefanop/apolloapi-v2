import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import jwt from 'jsonwebtoken';
import store from './../store/index.js';
import schema from './../graphql/index.js';

export async function createApolloServer() {
  const apolloServer = new ApolloServer({ schema });
  await apolloServer.start();

  const apolloMiddleware = expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      let user = null;
      let authenticated = false;

      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          user = jwt.verify(token, process.env.APP_SECRET);
          authenticated = true;
        } catch (err) {
          throw new Error('Invalid token');
        }
      }

      return {
        dispatch(method, payload) {
          return store.dispatch(method, payload, {
            authenticated,
            user,
            cid: req.headers['x-request-id'],
            internal: !!req.headers['x-test-request']
          });
        },
        jwt: {
          secret: process.env.APP_SECRET,
          audience: 'auth'
        },
        user,
        authenticated
      };
    }
  });

  return { apolloServer, apolloMiddleware };
}