const moment = require('moment');

module.exports = ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    let { startDate, endDate, interval } = payload || {};

    // Set default values for startDate and endDate
    if (!startDate) startDate = moment().subtract(30, 'days').format();
    if (!endDate) endDate = moment().format();
    // Set interval to 'day' if not provided
    if (!interval) interval = 'day';

    const data = await getAggregateDataInRange(knex, startDate, endDate, interval);

    return { data };
  });
};

const getAggregateDataInRange = async (knex, startDate, endDate, interval) => {
  try {
    const aggregateData = await knex('time_series_data')
      .select(
        knex.raw('datetime(createdAt) as date'),
        knex.raw('avg(hashrateInGh) as hashrate'),
        knex.raw('avg(poolHashrateInGh) as poolHashrate'),
        knex.raw('avg(sharesAccepted) as accepted'),
        knex.raw('avg(sharesRejected) as rejected'),
        knex.raw('avg(sharesSent) as sent'),
        knex.raw('avg(errorRate) as errors'),
        knex.raw('avg(wattTotal) as watts'),
        knex.raw('avg(temperature) as temperature'),
        knex.raw('avg(voltage) as voltage'),
        knex.raw('avg(chipSpeed) as chipSpeed'),
        knex.raw('avg(fanRpm) as fanRpm')
      )
      .whereBetween('createdAt', [startDate, endDate])
      .where('uuid', 'totals')
      .groupByRaw('datetime(createdAt)')
      .orderByRaw('datetime(createdAt)');

    const result = [];
    let currentDate = moment(startDate);
    const endDateObj = moment(endDate);
    while (currentDate <= endDateObj) {
      const formattedDate = currentDate.startOf('day').format();
      const dataForDate = aggregateData.find((entry) =>
        moment(entry.date).isSame(currentDate, 'day')
      );
      result.push({
        date: formattedDate,
        hashrate: dataForDate ? dataForDate.hashrate : 0,
        poolHashrate: dataForDate ? dataForDate.poolHashrate : 0,
        accepted: dataForDate ? dataForDate.accepted : 0,
        rejected: dataForDate ? dataForDate.rejected : 0,
        sent: dataForDate ? dataForDate.sent : 0,
        errors: dataForDate ? dataForDate.errors : 0,
        watts: dataForDate ? dataForDate.watts : 0,
        temperature: dataForDate ? dataForDate.temperature : 0,
        voltage: dataForDate ? dataForDate.voltage : 0,
        chipSpeed: dataForDate ? dataForDate.chipSpeed : 0,
        fanRpm: dataForDate ? dataForDate.fanRpm : 0,
      });
      currentDate.add(1, 'days');
    }

    return result;
  } catch (error) {
    console.error('Error while fetching time series:', error);
    throw error;
  }
};
