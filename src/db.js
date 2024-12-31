import knex from 'knex';
import { join } from 'path';

const db = knex({
  client: 'sqlite3',
  connection: join(new URL('.', import.meta.url).pathname, '..', 'futurebit.sqlite'),
  useNullAsDefault: true,
  // debug: process.env.NODE_ENV === 'development',
});

export { db as knex };
