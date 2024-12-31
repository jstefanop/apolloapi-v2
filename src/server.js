import app from './app/index.js';

const port = process.env.PORT || 5000

app.listen(port, () => {
  console.log(`ENV: ${process.env.NODE_ENV || 'dev'} - Server listening on port ${port}`);
});
