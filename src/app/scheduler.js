const { knex } = require('../db');
const _ = require('lodash');
const services = require('../services');

// Servizi da monitorare (miner, node)
const SERVICE_NAMES = ['miner', 'node'];

/**
 * Questa funzione aggiorna lo stato dei servizi nel DB
 */
async function updateServiceStatus(serviceName, status) {
  await knex('service_status').where({ service_name: serviceName }).update({
    status,
    last_checked: new Date(),
  });
}

/**
 * Questa funzione controlla e aggiorna lo stato di tutti i servizi
 */
async function checkAndUpdateServices() {
  try {
    // Controlla lo stato del miner
    const minerStatus = await services.miner.checkOnline();
    await updateServiceStatus('miner', minerStatus?.online?.status);

    // Controlla lo stato del nodo
    const nodeStatus = await services.node.checkOnline();
    await updateServiceStatus('node', nodeStatus?.online?.status);
  } catch (error) {
    console.error('Error checking services:', error);
  }
}

/**
 * Inizializza le righe del DB se non esistono
 */
async function initServiceStatusRows() {
  for (const service of SERVICE_NAMES) {
    const record = await knex('service_status')
      .where({ service_name: service })
      .first();

    if (!record) {
      await knex('service_status').insert({
        service_name: service,
        status: 'offline',
        last_checked: new Date(),
      });
    }
  }
}

/**
 * Questa funzione si occupa di raccogliere le statistiche dal miner
 */
async function fetchStatistics() {
  try {
    // Verifica se il miner è online
    const minserService = await knex('service_status')
      .select('status')
      .where({ service_name: 'miner' })
      .first();

    // Se il miner non è online, return
    if (minserService.status !== 'online') return;

    // Ottieni le statistiche del miner
    const { stats } = await services.miner.getStats();
    if (!stats || stats.length === 0) return;

    // Elabora i dati per ogni scheda
    const boards = stats.map((board) => {
      const {
        master: {
          boardsI: voltage,
          boardsW: wattTotal,
          intervals: {
            int_3600: { chipSpeed },
            int_30: { bySol: hashrateInGh, byPool: poolHashrateInGh },
          },
        },
        slots: {
          int_0: { temperature, errorRate },
        },
        pool: {
          intervals: {
            int_0: { sharesRejected, sharesAccepted, sharesSent },
          },
        },
        fans: {
          int_0: { rpm: fanRpm },
        },
        uuid,
      } = board;

      return {
        uuid,
        hashrateInGh,
        poolHashrateInGh,
        sharesAccepted,
        sharesRejected,
        sharesSent,
        errorRate,
        wattTotal,
        temperature,
        voltage,
        chipSpeed,
        fanRpm: fanRpm && fanRpm.length && fanRpm[0],
      };
    });

    // Calcola i totali
    const totals = boards.reduce(
      (acc, board) => {
        acc.hashrateInGh += parseFloat(board.hashrateInGh);
        acc.poolHashrateInGh += parseFloat(board.poolHashrateInGh);
        acc.sharesAccepted += parseFloat(board.sharesAccepted);
        acc.sharesRejected += parseFloat(board.sharesRejected);
        acc.sharesSent += parseFloat(board.sharesSent);
        acc.errorRate += parseFloat(board.errorRate);
        acc.wattTotal += parseFloat(board.wattTotal);
        acc.voltage += parseFloat(board.voltage);
        acc.chipSpeed += parseFloat(board.chipSpeed);
        return acc;
      },
      {
        uuid: 'totals',
        hashrateInGh: 0,
        poolHashrateInGh: 0,
        sharesAccepted: 0,
        sharesRejected: 0,
        sharesSent: 0,
        errorRate: 0,
        wattTotal: 0,
        temperature: 0,
        voltage: 0,
        chipSpeed: 0,
        fanRpm: 0,
      }
    );

    totals.temperature = _.meanBy(boards, 'temperature');
    totals.fanRpm = _.meanBy(boards, 'fanRpm');
    boards.push(totals);

    // Inserisci i dati nel DB in una transazione
    await knex.transaction(async (trx) => {
      // Elimina i dati vecchi (più di 7 giorni)
      const rowsBefore = await trx('time_series_data').count('* as count');
      console.log('Rows before deletion:', rowsBefore[0].count);

      const deletedRows = await trx('time_series_data')
        .where('createdAt', '<', knex.raw("datetime('now', '-7 days')"))
        .del();
      console.log('Deleted rows:', deletedRows);

      const rowsAfter = await trx('time_series_data').count('* as count');
      console.log('Rows after deletion:', rowsAfter[0].count);

      // Inserisci i nuovi dati
      await trx('time_series_data').insert(boards);
    });

    console.log('Time series data inserted');
  } catch (error) {
    console.error('Error while fetching statistics from the miner:', error);
  }
}

/**
 * La funzione principale che avvia tutti i task schedulati
 */
async function startAllSchedulers() {
  try {
    // Inizializza le righe del DB per lo stato dei servizi
    await initServiceStatusRows();

    // Controlla immediatamente la prima volta
    await checkAndUpdateServices();

    // Poi imposta gli intervalli
    setInterval(checkAndUpdateServices, 5000); // Controlla ogni 5 secondi
    setInterval(fetchStatistics, 30000); // Raccoglie statistiche ogni 30 secondi
  } catch (error) {
    console.error('Failed to initialize schedulers:', error);
  }
}

// Avvia immediatamente gli scheduler
startAllSchedulers();
