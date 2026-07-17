jest.mock('axios');
const axios = require('axios');
const clock = require('../src/services/signals/clock');
const sun = require('../src/services/signals/sun');
const energyTariff = require('../src/services/signals/energyTariff');
const minerTemp = require('../src/services/signals/minerTemp');
const weather = require('../src/services/signals/weather');
const registry = require('../src/services/signals');

const read = (provider, ctx) => provider.read({ now: new Date(), ...ctx });

describe('signal: clock', () => {
  it('reports wall-clock time in the configured timezone, not UTC', async () => {
    const now = new Date('2026-07-14T22:30:00Z'); // Tuesday 22:30 UTC = Wednesday 00:30 in Rome (CEST)

    const utc = await clock.read({ now, config: { timezone: 'UTC' } });
    expect(utc['clock.time'].value).toBe('22:30');
    expect(utc['clock.weekday'].value).toBe(2); // Tuesday

    const rome = await clock.read({ now, config: { timezone: 'Europe/Rome' } });
    expect(rome['clock.time'].value).toBe('00:30');
    expect(rome['clock.weekday'].value).toBe(3); // already Wednesday there
  });

  it('renders midnight as 00:00, never 24:00', async () => {
    const signals = await clock.read({
      now: new Date('2026-07-14T00:00:00Z'),
      config: { timezone: 'UTC' },
    });
    expect(signals['clock.time'].value).toBe('00:00');
  });
});

describe('signal: sun', () => {
  const rome = { latitude: 41.9, longitude: 12.5, timezone: 'Europe/Rome' };

  it('is stale without coordinates — a rule on it must not match', async () => {
    const signals = await read(sun, { config: { latitude: null, longitude: null } });
    expect(signals['sun.isDay'].stale).toBe(true);
    expect(signals['sun.minutesToSunset'].stale).toBe(true);
  });

  it('knows day from night', async () => {
    const noon = await sun.read({ now: new Date('2026-07-14T10:00:00Z'), config: rome });
    expect(noon['sun.isDay'].value).toBe(true);

    const night = await sun.read({ now: new Date('2026-07-14T01:00:00Z'), config: rome });
    expect(night['sun.isDay'].value).toBe(false);
  });

  it('counts down to the *next* sunset, so the value is never negative', async () => {
    // Late evening: today's sunset is already past, the next one is tomorrow.
    const signals = await sun.read({ now: new Date('2026-07-14T21:00:00Z'), config: rome });
    const minutes = signals['sun.minutesToSunset'].value;

    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(24 * 60);
  });
});

describe('signal: energy tariff', () => {
  const config = {
    timezone: 'UTC',
    tariff: {
      currency: 'EUR',
      flatPrice: 0.25,
      periods: [{ days: [1, 2, 3, 4, 5], from: '23:00', to: '07:00', price: 0.12, band: 'night' }],
    },
  };

  it('is stale when no tariff was entered — no guessing at prices', async () => {
    const signals = await energyTariff.read({ now: new Date(), config: { tariff: null } });
    expect(signals['energy.price'].stale).toBe(true);
    expect(signals['energy.band'].stale).toBe(true);
  });

  it('falls back to the flat price outside every band', async () => {
    // Tuesday 12:00 UTC
    const signals = await energyTariff.read({ now: new Date('2026-07-14T12:00:00Z'), config });
    expect(signals['energy.price'].value).toBe(0.25);
    expect(signals['energy.band'].value).toBe('flat');
  });

  it('applies a band that wraps past midnight, on both sides of it', async () => {
    // Tuesday 23:30 — inside the window, on the day it starts.
    const evening = await energyTariff.read({ now: new Date('2026-07-14T23:30:00Z'), config });
    expect(evening['energy.price'].value).toBe(0.12);
    expect(evening['energy.band'].value).toBe('night');

    // Wednesday 02:00 — still the same window, which started on Tuesday.
    const smallHours = await energyTariff.read({ now: new Date('2026-07-15T02:00:00Z'), config });
    expect(smallHours['energy.price'].value).toBe(0.12);
  });

  it('respects the days of the week, counting the day the window opened', async () => {
    // Sunday 02:00: the window that would cover it opened on Saturday, which is
    // not in the Mon-Fri list → flat price.
    const sunday = await energyTariff.read({ now: new Date('2026-07-19T02:00:00Z'), config });
    expect(sunday['energy.price'].value).toBe(0.25);

    // Saturday 23:30: Saturday is not in the list either.
    const saturday = await energyTariff.read({ now: new Date('2026-07-18T23:30:00Z'), config });
    expect(saturday['energy.price'].value).toBe(0.25);
  });

  it('parses the tariff when it arrives as raw JSON from the DB', async () => {
    const signals = await energyTariff.read({
      now: new Date('2026-07-14T12:00:00Z'),
      config: { timezone: 'UTC', tariff: JSON.stringify(config.tariff) },
    });
    expect(signals['energy.price'].value).toBe(0.25);
  });
});

describe('signal: miner temperature', () => {
  it('takes the hottest board', async () => {
    const deps = {
      miner: {
        getStats: async () => ({
          stats: [
            { slots: { int_0: { temperature: 62 } } },
            { slots: { int_0: { temperature: 71 } } },
          ],
        }),
      },
    };

    const signals = await read(minerTemp, { deps });
    expect(signals['miner.temperature'].value).toBe(71);
  });

  it('handles the string temperature the stat file actually reports', async () => {
    // The real stat file gives "62.43" (a string); it must not be dropped.
    const deps = { miner: { getStats: async () => ({ stats: [{ slots: { int_0: { temperature: '62.43' } } }] }) } };
    const signals = await read(minerTemp, { deps });
    expect(signals['miner.temperature'].value).toBe(62.43);
    expect(signals['miner.temperature'].stale).toBeFalsy();
  });

  it('is stale — not zero — when the miner is off', async () => {
    const deps = { miner: { getStats: async () => ({ stats: [] }) } };
    const signals = await read(minerTemp, { deps });

    expect(signals['miner.temperature'].stale).toBe(true);
    expect(signals['miner.temperature'].value).toBeNull();
  });

  it('is stale when reading the stat file throws', async () => {
    const deps = {
      miner: {
        getStats: async () => {
          throw new Error('stat file unreadable');
        },
      },
    };

    const signals = await read(minerTemp, { deps });
    expect(signals['miner.temperature'].stale).toBe(true);
  });

  // A tiny knex stand-in: knex('service_status').select().where().first() -> row.
  const fakeKnex = (status) => () => ({
    select() {
      return this;
    },
    where() {
      return this;
    },
    first: async () => (status ? { status } : undefined),
  });

  it('is pending (spinner, not "no data") while the miner is starting', async () => {
    const deps = { miner: { getStats: async () => ({ stats: [] }) } };
    const signals = await read(minerTemp, { knex: fakeKnex('online'), deps });
    expect(signals['miner.temperature'].stale).toBe(true);
    expect(signals['miner.temperature'].pending).toBe(true);
  });

  it('is not pending when the miner is off — there is genuinely no temperature', async () => {
    const deps = { miner: { getStats: async () => ({ stats: [] }) } };
    const signals = await read(minerTemp, { knex: fakeKnex('offline'), deps });
    expect(signals['miner.temperature'].stale).toBe(true);
    expect(signals['miner.temperature'].pending).toBeFalsy();
  });
});

describe('signal: weather (Open-Meteo)', () => {
  beforeEach(() => weather._reset());

  it('is stale without a location — a rule on it does not match', async () => {
    const signals = await weather.read({ config: { latitude: null, longitude: null } });
    expect(signals['weather.temperature'].stale).toBe(true);
    expect(signals['weather.cloudCover'].stale).toBe(true);
    // Nothing to fetch without coordinates, so not pending (no spinner).
    expect(signals['weather.temperature'].pending).toBeFalsy();
  });

  it('is pending (spinner) while the first value is being fetched', async () => {
    const signals = await weather.read({ config: { latitude: 41.9, longitude: 12.5 } });
    expect(signals['weather.temperature'].stale).toBe(true);
    expect(signals['weather.temperature'].pending).toBe(true);
  });

  it('exposes outdoor temperature, cloud cover and solar radiation once fetched', async () => {
    axios.get.mockResolvedValue({
      data: { current: { temperature_2m: 12.3, cloud_cover: 40, shortwave_radiation: 550 } },
    });
    await weather._refresh(41.9, 12.5);

    const signals = await weather.read({ config: { latitude: 41.9, longitude: 12.5 } });
    expect(signals['weather.temperature'].value).toBe(12.3);
    expect(signals['weather.cloudCover'].value).toBe(40);
    expect(signals['weather.solarRadiation'].value).toBe(550);
  });

  it('stays stale (never throws) when Open-Meteo is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('network down'));
    await weather._refresh(41.9, 12.5);

    const signals = await weather.read({ config: { latitude: 41.9, longitude: 12.5 } });
    expect(signals['weather.temperature'].stale).toBe(true);
  });

  it('goes stale when a warm cache ages out during a long outage', async () => {
    axios.get.mockResolvedValue({
      data: { current: { temperature_2m: 25, cloud_cover: 5, shortwave_radiation: 800 } },
    });
    await weather._refresh(41.9, 12.5); // sunny-morning value

    const config = { latitude: 41.9, longitude: 12.5 };
    expect((await weather.read({ config }))['weather.solarRadiation'].value).toBe(800);

    // ~2h later, network down, no fresh value: the day-old reading must not pass.
    axios.get.mockRejectedValue(new Error('network down'));
    const aged = await weather.read({ config, now: new Date(Date.now() + 2 * 60 * 60 * 1000) });
    expect(aged['weather.solarRadiation']).toMatchObject({ value: null, stale: true });
  });

  it('reports outdoor temperature in °C so the UI can convert to the user unit', () => {
    expect(weather.descriptors.find((d) => d.id === 'weather.temperature').unit).toBe('°C');
  });
});

describe('signal registry', () => {
  it('marks every signal of a provider that blows up as stale, instead of failing the tick', async () => {
    const signals = await registry.readAll({
      knex: null,
      // minerState and minerTemp will throw: no knex, no services.
      deps: {},
      config: { timezone: 'UTC', latitude: null, longitude: null, tariff: null },
      now: new Date(),
    });

    expect(signals['clock.time'].stale).toBe(false); // the clock still works
    expect(signals['miner.temperature'].stale).toBe(true);
    expect(signals['miner.running'].stale).toBe(true);
  });

  it('exposes descriptors so the UI can build the condition form from them', () => {
    const ids = registry.descriptors().map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['clock.time', 'miner.temperature', 'energy.price']));

    const byId = registry.descriptorsById();
    expect(byId['miner.temperature'].supportsHysteresis).toBe(true);
    expect(byId['clock.weekday'].supportsHysteresis).toBe(false);
  });
});
