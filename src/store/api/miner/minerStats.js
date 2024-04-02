const { join } = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const _ = require('lodash');
const moment = require('moment');
const { existsSync } = require('fs');
const c = require('config');

module.exports = ({ define }) => {
  define(
    'stats',
    async (payload, { knex, errors, dispatch }) => {
      const settings = await dispatch('api/settings/collection/read');
      const { items: pools } = await dispatch('api/pools/collection/read', {});
      const stats = await getMinerStats(errors, settings, pools);
      const ckpoolStats = await getCkpoolStats(errors, settings, pools);
      return { stats, ckpool: ckpoolStats };
    },
    {
      auth: true,
    }
  );
};

const parseFileToJsonArray = async (filePath) => {
  try {
    // Read the file content
    const fileContent = await fs.readFile(filePath, 'utf8');

    // Divide the file content into lines
    const lines = fileContent.split('\n');

    const allKeys = {};

    // Analyze each line
    lines.forEach((line) => {
      if (line.trim() !== '') {
        try {
          const jsonObject = JSON.parse(line);

          // Add the keys to the allKeys object
          Object.entries(jsonObject).forEach(([key, value]) => {
            if (!allKeys[key]) {
              allKeys[key] = null;
            }
            allKeys[key] = value;
          });
        } catch (error) {
          console.error(
            `Error during the parsing of the line: ${error.message}`
          );
        }
      }
    });

    return allKeys;
  } catch (error) {
    console.error(`Error during the reading of the file: ${error.message}`);
    return {};
  }
};

const getCkpoolStats = async (errors, settings, pools) => {
  return new Promise((resolve, reject) => {
    (async () => {
      // Get ckpool data
      let ckpoolData = null;

      try {
        if (settings?.nodeEnableSoloMining) {
          const poolUsername = pools[0] && pools[0].username;
          const ckpoolPoolStatsFile = path.resolve(
            __dirname,
            '../../../../backend/ckpool/logs/pool/pool.status'
          );

          const ckpoolUsersStatsFile = path.resolve(
            __dirname,
            `../../../../backend/ckpool/logs/users/${poolUsername}`
          );

          if (
            existsSync(ckpoolPoolStatsFile) &&
            existsSync(ckpoolUsersStatsFile)
          ) {
            await Promise.all([
              (async () => {
                let ckpoolPoolData = await parseFileToJsonArray(
                  ckpoolPoolStatsFile
                );
                let ckpoolUsersData = await fs.readFile(
                  ckpoolUsersStatsFile,
                  'utf8'
                );

                ckpoolUsersData = JSON.parse(ckpoolUsersData);

                ckpoolData = {
                  pool: ckpoolPoolData,
                  users: ckpoolUsersData,
                };
              })(),
            ]);
          }
        }

        resolve(ckpoolData);
      } catch (err) {
        reject(new errors.InternalError(err.toString()));
      }
    })();
  });
};

const getMinerStats = async (errors, settings, pools) => {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const statsDir = path.resolve(
          __dirname,
          '../../../../backend/apollo-miner/'
        );
        const statsFilePattern = 'apollo-miner.*';
        let statsFiles = await fs.readdir(statsDir);
        statsFiles = _.filter(statsFiles, (f) => {
          return f.match(statsFilePattern);
        });

        let stats = [];

        const findFileDetails = (fileName) => {
          const match = fileName.match(/^(apollo-miner)(?:-v(\d+))?\.(.+)$/);
          if (match) {
            const [, , version, id] = match;
            const fileVersion = version ? 'v' + version : 'v1';
            return { version: fileVersion, id };
          } else {
            return null;
          }
        };

        await Promise.all(
          statsFiles.map(async (file) => {
            const data = await fs.readFile(`${statsDir}/${file}`);
            let received = data.toString('utf8').trim();
            // JSON from miner is dirty, clean it
            received = received
              .replace(/\-nan/g, '0')
              .replace(/[^\x00-\x7F]/g, '')
              .replace('}{', '},{')
              .replace(String.fromCharCode(0), '')
              .replace(/[^\}]+$/, '');

            received = JSON.parse(received);

            const fileDetails = findFileDetails(file);
            received.uuid = fileDetails.id;
            received.version = fileDetails.version;

            received.master.intervals = _.mapKeys(
              received.master.intervals,
              (value, name) => {
                return `int_${name}`;
              }
            );

            received.pool.intervals = _.mapKeys(
              received.pool.intervals,
              (value, name) => {
                return `int_${name}`;
              }
            );

            received.fans = _.mapKeys(received.fans, (value, name) => {
              return `int_${name}`;
            });

            received.slots = _.mapKeys(received.slots, (value, name) => {
              return `int_${name}`;
            });

            // Hack to add timezone to miner date
            let offset = new Date().getTimezoneOffset();
            offset *= -1;
            received.date = moment(`${received.date}`, 'YYYY-MM-DD HH:mm:ss')
              .utcOffset(offset)
              .format();

            stats.push(received);
          })
        );

        resolve(stats);
      } catch (err) {
        reject(new errors.InternalError(err.toString()));
      }
    })();
  });
};
