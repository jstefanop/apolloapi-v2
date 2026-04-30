// tests/services.test.js
// Tests for ServicesService.getStats() — the function that pushServicesStatus() relies on.
// Verifies camelCase aliasing (serviceName, requestedStatus, etc.) and timestamp conversion.

const { knex } = require('../src/db');
const ServicesService = require('../src/services/services')(knex);

describe('ServicesService', () => {
  beforeEach(async () => {
    await knex('service_status').del();
  });

  describe('getStats() — field aliasing', () => {
    it('returns camelCase field names (not snake_case)', async () => {
      await knex('service_status').insert({
        service_name: 'miner',
        status: 'online',
        requested_status: 'online',
        requested_at: null,
        last_checked: new Date(),
      });

      const { data } = await ServicesService.getStats();

      expect(data).toHaveLength(1);
      const row = data[0];

      // camelCase fields must be present
      expect(row).toHaveProperty('serviceName', 'miner');
      expect(row).toHaveProperty('requestedStatus', 'online');
      expect(row).toHaveProperty('lastChecked');

      // snake_case originals must NOT leak through
      expect(row).not.toHaveProperty('service_name');
      expect(row).not.toHaveProperty('requested_status');
      expect(row).not.toHaveProperty('last_checked');
    });

    it('returns all services when no filter is applied', async () => {
      await knex('service_status').insert([
        { service_name: 'miner', status: 'online',  last_checked: new Date() },
        { service_name: 'node',  status: 'offline', last_checked: new Date() },
        { service_name: 'solo',  status: 'pending', last_checked: new Date() },
      ]);

      const { data } = await ServicesService.getStats();

      expect(data).toHaveLength(3);
      const names = data.map((r) => r.serviceName);
      expect(names).toContain('miner');
      expect(names).toContain('node');
      expect(names).toContain('solo');
    });

    it('filters by serviceName when provided', async () => {
      await knex('service_status').insert([
        { service_name: 'miner', status: 'online',  last_checked: new Date() },
        { service_name: 'node',  status: 'offline', last_checked: new Date() },
      ]);

      const { data } = await ServicesService.getStats({ serviceName: 'miner' });

      expect(data).toHaveLength(1);
      expect(data[0].serviceName).toBe('miner');
      expect(data[0].status).toBe('online');
    });

    it('returns empty array when table is empty', async () => {
      const { data } = await ServicesService.getStats();
      expect(data).toEqual([]);
    });
  });

  describe('getStats() — timestamp conversion', () => {
    it('converts numeric lastChecked timestamp to ISO UTC string', async () => {
      const now = Date.now();
      await knex('service_status').insert({
        service_name: 'miner',
        status: 'online',
        last_checked: now,
      });

      const { data } = await ServicesService.getStats();
      const row = data[0];

      expect(typeof row.lastChecked).toBe('string');
      // Must be parseable as a date and within 5 seconds of now
      const parsed = new Date(row.lastChecked).getTime();
      expect(Math.abs(parsed - now)).toBeLessThan(5000);
    });

    it('returns null for requestedAt when not set', async () => {
      await knex('service_status').insert({
        service_name: 'miner',
        status: 'offline',
        requested_at: null,
        last_checked: new Date(),
      });

      const { data } = await ServicesService.getStats();
      expect(data[0].requestedAt).toBeNull();
    });

    it('converts requestedAt to ISO UTC string when present', async () => {
      const ts = Date.now();
      await knex('service_status').insert({
        service_name: 'miner',
        status: 'pending',
        requested_status: 'online',
        requested_at: ts,
        last_checked: new Date(),
      });

      const { data } = await ServicesService.getStats();
      const row = data[0];

      expect(typeof row.requestedAt).toBe('string');
      const parsed = new Date(row.requestedAt).getTime();
      expect(Math.abs(parsed - ts)).toBeLessThan(5000);
    });
  });

  describe('getStats() — status values', () => {
    it.each([['online'], ['offline'], ['pending'], ['unknown']])(
      'preserves status value "%s"',
      async (status) => {
        await knex('service_status').del();
        await knex('service_status').insert({
          service_name: 'miner',
          status,
          last_checked: new Date(),
        });

        const { data } = await ServicesService.getStats();
        expect(data[0].status).toBe(status);
      }
    );
  });
});
