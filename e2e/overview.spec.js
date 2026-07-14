const { test, expect } = require('@playwright/test');

// First E2E smoke: with the authenticated storageState from global-setup, the
// app shell loads against the fake device (no hardware).
test.describe('fake device — authenticated shell', () => {
  test('overview is reachable and the app shell renders', async ({ page }) => {
    await page.goto('/overview');

    // Logged in (storageState carried the next-auth session).
    await expect(page).not.toHaveURL(/\/signin/);

    // Sidebar navigation for a miner device.
    await expect(page.getByRole('link', { name: /Overview/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Node/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Miner/i })).toBeVisible();
  });
});
