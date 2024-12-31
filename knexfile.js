import config from 'config';

export default {
  client: 'sqlite',
  connection: config.get('db.url')
};
