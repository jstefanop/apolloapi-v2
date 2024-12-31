import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import _ from 'lodash';
import moment from 'moment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default ({ define }) => {
  define(
    'stats',
    async (payload, { knex, errors, dispatch }) => {
      const settings = await dispatch('api/settings/collection/read');
      const { items: pools } = await dispatch('api/pools/collection/read', {});
      const stats = await getMinerStats(errors, settings, pools);
      const ckpoolStats = await getCkpoolStats(errors, settings, pools);
      return { stats, ckpool: ckpoolStats };
    },
    (payload) => ({
      auth: payload.useAuth || true,
    })
  );
};

const parseFileToJsonArray = async (filePath) => {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n');
    const allKeys = {};

    lines.forEach((line) => {
      if (line.trim() !== '') {
        try {
          const jsonObject = JSON.parse(line);
          Object.entries(jsonObject).forEach(([key, value]) => {
            if (!allKeys[key]) {
              allKeys[key] = null;
            }
            allKeys[key] = value;
          });
        } catch (error) {
          console.error(`Error during the parsing of the line: ${error.message}`);
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
  try {
    if (settings?.nodeEnableSoloMining) {
      const ckpoolPoolStatsFile = path.resolve(
        __dirname,
        '../../../../backend/ckpool/logs/pool/pool.status'
      );

      const ckpoolUsersStatsDir = path.resolve(
        __dirname,
        '../../../../backend/ckpool/logs/users/'
      );

      try {
        await fs.stat(ckpoolUsersStatsDir);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }

      let filenames = await fs.readdir(ckpoolUsersStatsDir);
      filenames = filenames.filter((filename) => !filename.match(/\.ds_store/i));

      const usersDataPromises = filenames.map(async (filename) => {
        const ckpoolUsersStatsFile = path.resolve(ckpoolUsersStatsDir, filename);
        const ckpoolUsersData = await fs.readFile(ckpoolUsersStatsFile, 'utf8');
        return JSON.parse(ckpoolUsersData);
      });

      const usersData = await Promise.all(usersDataPromises);

      return {
        pool: await parseFileToJsonArray(ckpoolPoolStatsFile),
        users: usersData,
      };
    }

    return null;
  } catch (err) {
    throw new errors.InternalError(err.toString());
  }
};

const getMinerStats = async (errors, settings, pools) => {
  try {
    const statsDir = path.resolve(__dirname, '../../../../backend/apollo-miner/');
    const statsFilePattern = 'apollo-miner.*';
    let statsFiles = await fs.readdir(statsDir);
    statsFiles = _.filter(statsFiles, (f) => f.match(statsFilePattern));

    const stats = [];

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
          (value, name) => `int_${name}`
        );

        received.pool.intervals = _.mapKeys(
          received.pool.intervals,
          (value, name) => `int_${name}`
        );

        received.fans = _.mapKeys(received.fans, (value, name) => `int_${name}`);
        received.slots = _.mapKeys(received.slots, (value, name) => `int_${name}`);

        const offset = new Date().getTimezoneOffset() * -1;
        received.date = moment(`${received.date}`, 'YYYY-MM-DD HH:mm:ss')
          .utcOffset(offset)
          .format();

        stats.push(received);
      })
    );

    return stats;
  } catch (err) {
    throw new errors.InternalError(err.toString());
  }
};
