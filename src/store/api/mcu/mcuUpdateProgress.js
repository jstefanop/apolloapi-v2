const { join } = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const _ = require('lodash');

module.exports = ({ define }) => {
  define(
    'updateProgress',
    async (payload, { knex, errors, utils }) => {
      try {
        const data = await fs.readFile(`/tmp/update_progress`);
        const progress = parseInt(data.toString());
        return { value: progress };
      } catch (error) {
        console.log('updateProgress', error);
        return { value: 0 };
      }
    },
    {
      auth: true,
    }
  );
};
