import { test, expect } from '@playwright/test';

test('app boots and loads the sample dataset', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
});
