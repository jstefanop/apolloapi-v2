import moment from 'moment';

export default ({ define }) => {
  define('stats', async (payload, { knex, errors, utils }) => {
    let { startDate, endDate, interval, itemId } = payload || {};

    // Interval can be day or hour
    // Set interval to 'day' if not provided
    if (!interval) interval = 'day';

    // Set default values for startDate and endDate
    if (!startDate) startDate = moment().subtract(interval === 'day' ? 30 : 1, 'days');
    if (!endDate) endDate = moment();

    const format = 'YYYY-MM-DD HH:mm:ssZ';

    startDate = moment(startDate).utc().format(format);
    endDate = moment(endDate).utc().format(format);

    if (!itemId) itemId = 'totals';

    const data = await getAggregateDataInRange(
      knex,
      startDate,
      endDate,
      interval,
      itemId
    );

    return { data };
  });
};

const getAggregateDataInRange = async (knex, startDate, endDate, interval, itemId) => {
  try {
    const dateFormat = interval === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';

    const aggregateData = await knex('time_series_data')
      .select(
        knex.raw(
          `strftime('${dateFormat}', datetime(createdAt, 'localtime')) as date`
        ),
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
      .where('uuid', itemId)
      .groupByRaw(`strftime('${dateFormat}', datetime(createdAt, 'localtime'))`)
      .orderByRaw(
        `strftime('${dateFormat}', datetime(createdAt, 'localtime'))`
      );

    const result = [];
    let currentDate = moment(startDate);
    const endDateObj = moment(endDate);

    while (currentDate <= endDateObj) {
      const formattedDate = currentDate.utc().format();
      const dataForDate = aggregateData.find((entry) => {
        const entryDate = moment(entry.date).format('YYYY-MM-DD HH:mm:ssZ');
        return moment(entryDate).utc().isSame(currentDate.utc(), interval);
      });

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

      currentDate.add(1, interval);
    }

    return result;
  } catch (error) {
    console.error('Error while fetching time series:', error);
    throw error;
  }
};
