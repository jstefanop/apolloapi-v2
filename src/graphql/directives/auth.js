const { mapSchema, getDirective, MapperKind } = require('@graphql-tools/utils');
const { defaultFieldResolver } = require('graphql');
const { GraphQLError } = require('graphql');

function authDirectiveTransformer(schema) {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const authDirective = getDirective(schema, fieldConfig, 'auth')?.[0];

      if (authDirective) {
        const { resolve = defaultFieldResolver } = fieldConfig;

        fieldConfig.resolve = async function (source, args, context, info) {
          if (!context.isAuthenticated) {
            throw new GraphQLError('You must be authenticated to access this resource', {
              extensions: {
                code: 'UNAUTHENTICATED'
              }
            });
          }

          return resolve(source, args, context, info);
        };
      }

      return fieldConfig;
    }
  });
}

module.exports = { authDirectiveTransformer };