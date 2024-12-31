import dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

export default {
  db: {
    url: join(__dirname, '..', 'futurebit.sqlite')
  },
  settings: {
  },
  server: {
    secret: process.env.APP_SECRET,
    port: process.env.PORT || 5000
  }
};
