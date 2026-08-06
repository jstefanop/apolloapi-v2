// tests/poolProfiles.test.js
// Saved pools run against the real in-memory sqlite, because the behaviour worth
// pinning is what the table does: re-saving a name replaces rather than piles up
// (the only way to fix a typo with no manage screen), and saving never disturbs
// the pools the miner is actually running.
const { knex } = require('../src/db');
const createPoolProfiles = require('../src/services/poolProfiles');
const resolver = require('../src/graphql/resolvers/poolProfiles');

const svc = createPoolProfiles(knex);

const profile = {
  name: 'Ocean home',
  url: 'stratum+tcp://mine.ocean.xyz:3334',
  username: 'bc1qexample.worker',
  password: 'x',
};

describe('PoolProfilesService', () => {
  beforeEach(async () => {
    await knex('pool_profiles').del();
  });

  it('saves and lists a profile whole', async () => {
    await svc.save(profile);
    const { profiles } = await svc.list();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject(profile);
    expect(profiles[0].id).toEqual(expect.any(Number));
  });

  it('replaces the profile that already owns the name', async () => {
    await svc.save(profile);
    await svc.save({ ...profile, url: 'stratum+tcp://corrected:3333' });

    const { profiles } = await svc.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].url).toBe('stratum+tcp://corrected:3333');
  });

  // Read-then-write left a window where both callers saw the name free and both
  // inserted, and the loser reached the user as raw UNIQUE-constraint text.
  it('survives two saves of the same name at once', async () => {
    await Promise.all([
      svc.save(profile),
      svc.save({ ...profile, url: 'stratum+tcp://second:3333' }),
    ]);

    const { profiles } = await svc.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe(profile.name);
  });

  it('keeps profiles that differ only by name', async () => {
    await svc.save(profile);
    await svc.save({ ...profile, name: 'Ocean office' });

    const { profiles } = await svc.list();
    expect(profiles.map((p) => p.name)).toEqual(['Ocean home', 'Ocean office']);
  });

  it('trims the name and url so a stray space is not a second profile', async () => {
    await svc.save({ ...profile, name: '  Ocean home  ', url: ` ${profile.url} ` });
    await svc.save(profile);

    const { profiles } = await svc.list();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('Ocean home');
    expect(profiles[0].url).toBe(profile.url);
  });

  it.each([
    ['a blank name', { ...profile, name: '   ' }, /name is required/i],
    ['a missing name', { url: profile.url }, /name is required/i],
    ['a blank url', { ...profile, url: '' }, /URL is required/i],
  ])('refuses %s', async (_label, input, message) => {
    await expect(svc.save(input)).rejects.toThrow(message);
    const { profiles } = await svc.list();
    expect(profiles).toHaveLength(0);
  });

  it('accepts a profile with no worker or password', async () => {
    await svc.save({ name: 'Bare', url: profile.url });
    const { profiles } = await svc.list();

    expect(profiles[0]).toMatchObject({ username: null, password: null });
  });

  // The reason this table exists instead of a flag on `pools`: configurator.js
  // turns every row of that one into miner CLI args, so a bookmarked pool living
  // there would be a pool the device starts mining to.
  it('never touches the pools the miner is running', async () => {
    await knex('pools').del();
    await knex('pools').insert({
      enabled: true, url: 'stratum+tcp://active:3333', index: 1, donation: 0,
    });

    await svc.save(profile);

    const pools = await knex('pools').select('url');
    expect(pools).toEqual([{ url: 'stratum+tcp://active:3333' }]);
  });
});

describe('PoolProfiles resolvers', () => {
  it('reports a service failure as an error field, not a thrown query', async () => {
    const services = {
      poolProfiles: {
        save: jest.fn().mockRejectedValue(new Error('disk is full')),
      },
    };

    const result = await resolver.PoolProfileMutations.save(
      null,
      { input: profile },
      { services }
    );

    expect(result).toEqual({ result: null, error: { message: 'disk is full' } });
  });

  it('passes the input through untouched', async () => {
    const save = jest.fn().mockResolvedValue({ profile });
    await resolver.PoolProfileMutations.save(
      null,
      { input: profile },
      { services: { poolProfiles: { save } } }
    );

    expect(save).toHaveBeenCalledWith(profile);
  });
});
