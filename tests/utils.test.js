const utils = require('../src/utils');

describe('authentication utilities', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await utils.auth.hashPassword('correct horse battery staple');

    await expect(
      utils.auth.comparePassword('correct horse battery staple', hash)
    ).resolves.toBe(true);
    await expect(utils.auth.comparePassword('wrong', hash)).resolves.toBe(false);
  });

  it('rejects empty password comparisons', () => {
    expect(utils.auth.comparePassword('', 'hash')).toBe(false);
    expect(utils.auth.comparePassword('password', '')).toBe(false);
  });

  it('creates an access token', () => {
    expect(utils.auth.generateAccessToken().accessToken).toEqual(
      expect.any(String)
    );
  });
});
