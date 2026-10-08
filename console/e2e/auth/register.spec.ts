import { test, expect } from '@playwright/test';

test.describe('Administrator setup page', () => {
  test('directs provisioning to the deployment host', async ({ page }) => {
    await page.goto('/init-admin');
    await expect(
      page.getByRole('heading', { name: /administrator setup required/i }),
    ).toBeVisible();
    await expect(page.getByText('./scripts/install.sh')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /check setup status/i }),
    ).toBeVisible();
  });
});
