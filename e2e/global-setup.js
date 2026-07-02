const { chromium, request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const GQL = 'http://localhost:5002/api/graphql';
const PASSWORD = 'e2epassword';
const TMP = path.join(__dirname, '.tmp');

const gql = async (api, query, variables, token) => {
  const res = await api.post(GQL, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    data: { query, variables },
  });
  return res.json();
};

// Bootstrap the fake device: create the account, seed a pool (so the guard
// doesn't bounce /overview to /settings/pools), then log in via the UI and save
// the authenticated storageState for all specs to reuse.
module.exports = async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const api = await request.newContext();

  // 1. Create the initial account (idempotent — ignore "already done").
  await gql(
    api,
    `query($input: AuthSetupInput!) { Auth { setup(input: $input) { error { message } } } }`,
    { input: { password: PASSWORD } }
  );

  // 2. Log in for a token, seed a pool so overview renders without redirect.
  const login = await gql(
    api,
    `query($input: AuthLoginInput!) { Auth { login(input: $input) { result { accessToken } error { message } } } }`,
    { input: { password: PASSWORD } }
  );
  const token = login?.data?.Auth?.login?.result?.accessToken;
  if (!token) throw new Error(`E2E login failed: ${JSON.stringify(login)}`);

  await gql(
    api,
    `query($input: PoolUpdateAllInput!) { Pool { updateAll(input: $input) { result { pools { id } } error { message } } } }`,
    { input: { pools: [{ index: 0, enabled: true, url: 'stratum+tcp://pool.example.com:3333', username: 'e2ewallet', password: 'x' }] } },
    token
  );
  await api.dispose();

  // 3. UI login → capture next-auth session cookie into storageState.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/signin');
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // After login the guard lands on /overview (pool exists) or /settings/*; either way we're authed.
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/signin'), { timeout: 20_000 });
  await page.context().storageState({ path: path.join(TMP, 'state.json') });
  await browser.close();
};
