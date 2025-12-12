const { makeExecutableSchema } = require('@graphql-tools/schema');
const { loadFilesSync } = require('@graphql-tools/load-files');
const { mergeTypeDefs, mergeResolvers } = require('@graphql-tools/merge');
const path = require('path');
const { authDirectiveTransformer } = require('./directives/auth');

// Load type definitions from separate files
const typesArray = loadFilesSync(path.join(__dirname, './typeDefs'), {
  extensions: ['js', 'gql']
});

// Load resolvers from separate files
const resolversArray = loadFilesSync(path.join(__dirname, './resolvers'), {
  extensions: ['js']
});

// Merge type definitions and resolvers
const typeDefs = mergeTypeDefs(typesArray);
const resolvers = mergeResolvers(resolversArray);

// Create executable schema
let schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

// Apply directive transformers
schema = authDirectiveTransformer(schema);

module.exports = schema;