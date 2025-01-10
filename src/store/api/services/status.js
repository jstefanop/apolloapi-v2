const moment = require('moment');

module.exports = ({ define }) => {
  define('status', async (payload, { knex, errors }) => {
    try {
      const { serviceName } = payload || {};

      const convertToUtcDateTime = (timestamp) => {
        if (!timestamp) return null;
        return moment(Number(timestamp))
          .utc()
          .format();
      };

      const fieldsMapping = [
        'id',
        'service_name as serviceName',
        'status',
        'requested_status as requestedStatus',
        'last_checked as lastChecked',
      ];

      let data;

      if (serviceName) {
        const status = await knex('service_status')
          .select(fieldsMapping)
          .where({ service_name: serviceName })
          .first();

        if (status) {
          status.lastChecked = convertToUtcDateTime(status.lastChecked);
        }

        data = [status];
      } else {
        const statuses = await knex('service_status')
          .select(fieldsMapping)
          .orderBy('id', 'desc');

        for (const row of statuses) {
          row.lastChecked = convertToUtcDateTime(row.lastChecked);
        }

        data = statuses;
      }

      return { data };
    } catch (error) {
      console.error('Error fetching service status:', error);
      throw errors.internalServerError();
    }
  });
};