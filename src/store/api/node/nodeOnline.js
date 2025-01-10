const { exec } = require('child_process');

module.exports = ({ define }) => {
  define(
    'online',
    async (payload, { knex, errors, utils }) => {
      const online = await isOnline();
      online.timestamp = new Date().toISOString();
      return { online };
    },
    (payload) => ({
      auth: payload.useAuth || true,
    })
  );
};

function isOnline() {
  return new Promise((resolve, reject) => {
    exec(
      'systemctl is-active node >/dev/null 2>&1 && echo true || echo false',
      {},
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          const current = stdout.toString().replace(/(\r\n|\n|\r)/gm, '');
          const status = current == 'true';

          resolve({ status: status });
        }
      }
    );
  });
}
