// tests/setup.js
const { knex } = require('../src/db');
const fs = require('fs');

// Mock del modulo config per evitare avvisi durante i test
jest.mock('config', () => ({
  get: (path) => {
    const parts = path.split('.');
    let value;

    if (parts[0] === 'db' && parts[1] === 'url') {
      value = ':memory:';
    } else if (parts[0] === 'server') {
      if (parts[1] === 'port') value = 5000;
      if (parts[1] === 'secret') value = 'test-secret-key-for-jwt-token-generation';
    }

    return value;
  }
}));

// Disattiva lo scheduler durante i test per evitare che cerchi tabelle prima che siano create
jest.mock('../src/app/scheduler', () => ({
  startAllSchedulers: jest.fn()
}));

// Mock delle operazioni del file system
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    constants: {
      ...originalFs.constants,
      F_OK: 0
    },
    promises: {
      access: jest.fn().mockImplementation(() => Promise.resolve()),
      readdir: jest.fn().mockImplementation((path) => {
        if (path.includes('apollo-miner')) {
          return Promise.resolve(['apollo-miner-v2.123456']);
        }
        return Promise.resolve([]);
      }),
      readFile: jest.fn().mockImplementation((path) => {
        if (path.includes('apollo-miner')) {
          return Promise.resolve(JSON.stringify({
            date: '2025-03-22 10:00:00',
            master: {
              boardsI: 36.5,
              boardsW: 250,
              intervals: {
                "30": { bySol: 7500, byPool: 7450 },
                "300": { bySol: 7400, byPool: 7350 },
                "900": { bySol: 7300, byPool: 7250 },
                "3600": { bySol: 7200, byPool: 7150 },
                "0": { bySol: 7100, byPool: 7050 }
              }
            },
            pool: { intervals: { "0": { sharesAccepted: 100, sharesRejected: 2, sharesSent: 102 } } },
            slots: { "0": { temperature: 65, errorRate: 0.5 } },
            fans: { "0": { rpm: [4000] } }
          }));
        }
        else if (path.includes('format_node_disk_c_done') || path.includes('update_progress')) {
          return Promise.resolve('75');
        }
        else if (path.includes('bitcoin.conf')) {
          return Promise.resolve('server=1\nrpcuser=futurebit\nrpcpassword=testpassword');
        }
        return Promise.resolve('Mock file content');
      }),
      writeFile: jest.fn().mockResolvedValue(undefined),
      stat: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          isFile: () => true,
          mtimeMs: Date.now() - 5000 // Modified 5 seconds ago
        });
      }),
      mkdir: jest.fn().mockResolvedValue(undefined)
    }
  };
});

// Mock per child_process
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, options, callback) => {
    if (callback) {
      callback(null, { stdout: 'Mock command output' });
    }
    return { stdout: 'Mock command output' };
  }),
  execSync: jest.fn(() => 'Mock command output'),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn((event, callback) => callback('Mock stdout output')) },
    stderr: { on: jest.fn((event, callback) => callback('')) },
    on: jest.fn((event, callback) => {
      if (event === 'close') callback(0);
    })
  }))
}));

// Impostazioni per supertest
jest.mock('@apollo/server/express4', () => {
  const originalModule = jest.requireActual('@apollo/server/express4');
  return {
    ...originalModule,
    expressMiddleware: jest.fn(() => (req, res, next) => {
      // Simulazione di risposta GraphQL
      const body = req.body;
      if (body && body.query) {
        // Crea una risposta simulata per le richieste GraphQL
        res.status(200).json({
          data: {},
          errors: null
        });
      } else {
        next();
      }
    })
  };
});

// Setup e teardown per ogni test
beforeAll(async () => {
  // Crea tabelle necessarie per i test
  await knex.schema.hasTable('service_status').then(exists => {
    if (!exists) {
      return knex.schema.createTable('service_status', table => {
        table.increments('id');
        table.string('service_name');
        table.string('status');
        table.string('requested_status');
        table.timestamp('requested_at');
        table.timestamp('last_checked');
      });
    }
  });

  await knex.schema.hasTable('setup').then(exists => {
    if (!exists) {
      return knex.schema.createTable('setup', table => {
        table.increments('id');
        table.string('password');
        table.timestamps(true, true);
      });
    }
  });

  await knex.schema.hasTable('settings').then(exists => {
    if (!exists) {
      return knex.schema.createTable('settings', table => {
        table.increments('id');
        table.string('miner_mode').defaultTo('balanced');
        table.float('voltage').defaultTo(12.0);
        table.integer('frequency').defaultTo(650);
        table.integer('fan_low').defaultTo(40);
        table.integer('fan_high').defaultTo(60);
        table.boolean('api_allow').defaultTo(false);
        table.boolean('custom_approval').defaultTo(false);
        table.string('connected_wifi');
        table.boolean('left_sidebar_visibility').defaultTo(true);
        table.boolean('left_sidebar_extended').defaultTo(true);
        table.boolean('right_sidebar_visibility').defaultTo(true);
        table.string('temperature_unit').defaultTo('c');
        table.boolean('power_led_off').defaultTo(false);
        table.string('node_rpc_password');
        table.boolean('node_enable_tor').defaultTo(false);
        table.text('node_user_conf');
        table.boolean('node_enable_solo_mining').defaultTo(false);
        table.integer('node_max_connections').defaultTo(64);
        table.boolean('node_allow_lan').defaultTo(false);
        table.string('btcsig').defaultTo('mined by Solo Apollo');
        table.string('node_software').defaultTo('core-28.1');
        table.timestamps(true, true);
      });
    }
  });

  await knex.schema.hasTable('pools').then(exists => {
    if (!exists) {
      return knex.schema.createTable('pools', table => {
        table.increments('id');
        table.boolean('enabled').defaultTo(true);
        table.integer('donation').defaultTo(0);
        table.string('url').notNullable();
        table.string('username');
        table.string('password');
        table.string('proxy');
        table.integer('index').notNullable();
        table.timestamps(true, true);
      });
    }
  });

  await knex.schema.hasTable('time_series_data').then(exists => {
    if (!exists) {
      return knex.schema.createTable('time_series_data', table => {
        table.increments('id');
        table.string('uuid');
        table.float('hashrateInGh').defaultTo(0);
        table.float('poolHashrateInGh').defaultTo(0);
        table.float('sharesAccepted').defaultTo(0);
        table.float('sharesRejected').defaultTo(0);
        table.float('sharesSent').defaultTo(0);
        table.float('errorRate').defaultTo(0);
        table.float('wattTotal').defaultTo(0);
        table.float('temperature').defaultTo(0);
        table.float('voltage').defaultTo(0);
        table.float('chipSpeed').defaultTo(0);
        table.float('fanRpm').defaultTo(0);
        table.timestamp('createdAt').defaultTo(knex.fn.now());
      });
    }
  });

  // Inserisci dati di default per le impostazioni
  const settingsCount = await knex('settings').count('* as count').first();
  if (!settingsCount || settingsCount.count === 0) {
    await knex('settings').insert({
      miner_mode: 'balanced',
      voltage: 12.0,
      frequency: 650,
      fan_low: 40,
      fan_high: 60,
      temperature_unit: 'c',
      left_sidebar_visibility: true,
      left_sidebar_extended: true,
      right_sidebar_visibility: true,
      node_max_connections: 64,
      node_rpc_password: 'testpassword',
      created_at: knex.fn.now()
    });
  }

  // Inserisci pool di default per i test
  const poolsCount = await knex('pools').count('* as count').first();
  if (!poolsCount || poolsCount.count === 0) {
    await knex('pools').insert({
      enabled: true,
      donation: 0,
      url: 'stratum+tcp://pool.test.com:3333',
      username: 'testuser',
      password: 'x',
      proxy: null,
      index: 0,
      created_at: knex.fn.now()
    });
  }

  // Inserisci stati dei servizi di default
  const minerServiceCount = await knex('service_status')
    .where({ service_name: 'miner' })
    .count('* as count')
    .first();

  if (!minerServiceCount || minerServiceCount.count === 0) {
    await knex('service_status').insert({
      service_name: 'miner',
      status: 'offline',
      last_checked: new Date()
    });
  }

  const nodeServiceCount = await knex('service_status')
    .where({ service_name: 'node' })
    .count('* as count')
    .first();

  if (!nodeServiceCount || nodeServiceCount.count === 0) {
    await knex('service_status').insert({
      service_name: 'node',
      status: 'offline',
      last_checked: new Date()
    });
  }
});

afterAll(async () => {
  // Pulisci e chiudi la connessione al database
  try {
    // Elimina tutte le tabelle di test
    await knex.schema.dropTableIfExists('service_status');
    await knex.schema.dropTableIfExists('setup');
    await knex.schema.dropTableIfExists('settings');
    await knex.schema.dropTableIfExists('pools');
    await knex.schema.dropTableIfExists('time_series_data');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    // Chiudi la connessione al database
    await knex.destroy();
  }
});