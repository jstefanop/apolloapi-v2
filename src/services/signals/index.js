/**
 * Signal registry.
 *
 * Every factor the rules engine can reason about is a provider here. Adding a
 * source (weather, spot price, an MQTT-fed number…) means adding a file, never
 * touching the engine.
 *
 * A provider that throws, or that cannot produce a value, yields `stale: true`
 * rather than a fabricated zero. The engine treats a stale signal as "cannot
 * evaluate": the rule does not match. That is the difference between an
 * automation that fails safe and one that stops the miner because a stat file
 * was momentarily unreadable.
 */

const clock = require('./clock');
const sun = require('./sun');
const minerTemp = require('./minerTemp');
const minerState = require('./minerState');
const energyTariff = require('./energyTariff');
const weather = require('./weather');
const mqttInput = require('./mqttInput');

const PROVIDERS = [clock, sun, minerTemp, minerState, energyTariff, weather, mqttInput];

const READ_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// A provider's descriptors, static or config-derived (MQTT inputs are dynamic).
const providerDescriptors = (provider, config) =>
  provider.describe ? provider.describe(config) : provider.descriptors;

// Flat list of descriptors — the UI builds the condition form from these, so no
// signal is hardcoded on the frontend. `config` supplies the dynamic ones.
function descriptors(config) {
  return PROVIDERS.flatMap((p) => providerDescriptors(p, config));
}

function descriptorsById(config) {
  return Object.fromEntries(descriptors(config).map((d) => [d.id, d]));
}

// Read every provider. Returns { 'signal.id': { value, stale?, error? } }.
async function readAll(ctx) {
  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        return await withTimeout(provider.read(ctx), READ_TIMEOUT_MS, provider.namespace);
      } catch (error) {
        // Mark every signal this provider owns as stale, keeping the reason.
        return Object.fromEntries(
          providerDescriptors(provider, ctx.config).map((d) => [
            d.id,
            { value: null, stale: true, error: error.message },
          ])
        );
      }
    })
  );

  const signals = Object.assign({}, ...results);
  const ts = ctx.now.getTime();
  Object.values(signals).forEach((s) => {
    s.ts = ts;
    s.stale = !!s.stale || s.value === null || s.value === undefined;
  });

  return signals;
}

module.exports = { PROVIDERS, descriptors, descriptorsById, readAll };
