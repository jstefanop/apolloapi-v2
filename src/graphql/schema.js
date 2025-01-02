import { fileURLToPath } from 'url';
import path from 'path';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { loadFiles } from '@graphql-tools/load-files';
import { mergeTypeDefs, mergeResolvers } from '@graphql-tools/merge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildSchema() {
  // Load .js files from "graphqlModules"
  const modulesArray = await loadFiles(
    [
      path.join(__dirname, 'graphqlModules', 'common', '**/*.js'),
      path.join(__dirname, 'graphqlModules', '**/*.js')
    ],
    {
      noRequire: true,
      exportNames: ['typeDef', 'resolver'],
      ignoreIndex: true,
      extensions: ['js'],
    }
  );

  const typeDefsArray = [];
  const resolversArray = [];

  for (const mod of modulesArray) {
    if (mod.typeDefs) {
      typeDefsArray.push(mod.typeDefs);
    }
    if (mod.resolvers) {
      resolversArray.push(mod.resolvers);
    }
  }

  const typeDefs = mergeTypeDefs(typeDefsArray);
  const resolvers = mergeResolvers(resolversArray);

  return makeExecutableSchema({
    typeDefs,
    resolvers,
  });
}

const schema = await buildSchema();

export default schema;
