import { test, expect } from '@playwright/test';
import { bootMap, settled, dc, state, trackErrors, dcHash } from './helpers.js';

test('AC2 / P2: no request leaves the origin; the map renders offline', async ({ page, context, baseURL }) => {
  const errors = trackErrors(page);
  const foreign = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['http:', 'https:'].includes(u.protocol)) return; // data:/blob:
    if (u.origin !== new URL(baseURL).origin) foreign.push(r.url());
  });
  await bootMap(page);
  await page.locator('.map-pin[data-dc="가산IDC"] .pin-dot').click();
  await expect.poll(() => state(page)).toMatchObject({ dc: '가산IDC' });
  await settled(page);
  await context.setOffline(true);
  // In-page navigation only (no service worker, so a reload would fail): map → DC → map, all offline.
  await page.evaluate((h) => (location.hash = h), dcHash('파주IDC'));
  await expect.poll(() => state(page)).toMatchObject({ dc: '파주IDC' });
  await settled(page);
  await page.evaluate(() => (location.hash = '#map'));
  await expect(page.locator('#map-view')).toBeVisible();
  await expect(page.locator('#map-view .map-area')).not.toHaveCount(0);
  await expect(page.locator('.map-pin[data-dc]')).toHaveCount(3);
  expect(await dc(page, () => window.__dc.mode())).toBe('map');
  await context.setOffline(false);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});
