const config = require('config')
const { createGraphqlApp } = require('backend-helpers')
const store = require('./../store')
const schema = require('./../graphql')

const { app } = createGraphqlApp(schema, {
  expressGraphql (request) {
    return {
      context: {
        dispatch (method, payload) {
          return store.dispatch(method, payload, request, {
            cid: request.headers['x-request-id'],
            internal: !!request.headers['x-test-request']
          })
        }
      }
    }
  },
  cors: true,
  jwt: {
    secret: config.get('server.secret'),
    audience: 'auth'
  }
})

module.exports = app
