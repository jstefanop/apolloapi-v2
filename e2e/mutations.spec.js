const { test, expect } = require('@playwright/test');

// Mutating journeys on the fake device — the ones that on real hardware cause
// actual bitcoind restarts; here they are instant and safe.

test.describe('node software switch', () => {
  test('selecting a different Core version shows the Save & Restart bar and saves', async ({ page }) => {
    await page.goto('/settings/node');

    // 31.0 is Core-only (unique). Fresh device defaults to 28.1, so this is a change.
    await page.getByRole('button', { name: '31.0', exact: true }).click();

    const saveBar = page.getByRole('button', { name: /Save & Restart/i });
    await expect(saveBar).toBeVisible();

    await saveBar.click();
    // Once applied the dirty bar goes away.
    await expect(saveBar).toBeHidden({ timeout: 20_000 });
  });
});

// Note: node start/stop is covered by T1 integration (service_status + systemctl)
// and the manual real-device tour. On the fake the node RPC is intentionally
// always-up (so overview/stats render in normal `yarn dev`), which doesn't model
// the offline transition — not worth degrading dev realism for it here.

test.describe('pool change', () => {
  test('changing the pool URL persists', async ({ page }) => {
    await page.goto('/settings/pools');

    const newUrl = 'stratum+tcp://e2e-changed.example.com:4444';
    const urlInput = page.locator('input[value*="stratum+tcp"]').first();
    await expect(urlInput).toBeVisible();
    await urlInput.fill(newUrl);

    await page.getByRole('button', { name: /Save/i }).first().click();

    // Reload and confirm the new URL persisted.
    await page.reload();
    await expect(page.locator(`input[value="${newUrl}"]`)).toBeVisible({ timeout: 15_000 });
  });
});
