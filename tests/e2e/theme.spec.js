import { test, expect } from '@playwright/test';
import { boot, settled, dc, trackErrors, dcHash } from './helpers.js';

test.describe('themes', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('AC6: the toggle switches the theme and the choice survives a reload', async ({ page }, info) => {
    await boot(page);
    const start = info.project.name; // each project presets its theme
    expect(await dc(page, () => window.__dc.theme())).toBe(start);
    await expect(page.locator('html')).toHaveAttribute('data-theme', start);
    const other = start === 'dark' ? 'light' : 'dark';
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    expect(await dc(page, () => window.__dc.theme())).toBe(other);
    expect(await dc(page, () => localStorage.getItem('dc3d.theme'))).toBe(other);
    await settled(page);
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    expect(await dc(page, () => window.__dc.theme())).toBe(other);
  });

  test('AC7/AC8: gradient background, fog, zone walls, occupancy rings and device panels in both themes', async ({ page }, info) => {
    await boot(page, `${dcHash()}&floor=3F`);
    expect(await dc(page, () => window.__dc.background())).toBe('texture');
    expect(await dc(page, () => window.__dc.fog())).toBe(true);
    const zones = await dc(page, () => window.__dc.zoneIds('3F'));
    expect(zones.length).toBeGreaterThan(0);
    expect(await dc(page, () => window.__dc.wallCount('3F'))).toBe(zones.length * 4);
    const racks = await dc(page, () => window.__dc.data().datacenters[0].floors.find((f) => f.id === '3F').racks.length);
    expect(await dc(page, () => window.__dc.bandCount('3F'))).toBe(racks);
    const usedU = await dc(page, () => {
      const f = window.__dc.data().datacenters[0].floors.find((x) => x.id === '3F');
      let n = 0;
      for (const r of f.racks) {
        const u = new Set();
        for (const s of r.servers) {
          const m = /\((\d+)-(\d+)\)/.exec(s.device_position);
          if (m) for (let k = +m[1]; k <= +m[2]; k++) u.add(k);
        }
        n += u.size;
      }
      return n;
    });
    expect(await dc(page, () => window.__dc.panelCount('3F'))).toBe(usedU); // one LED panel per occupied U
    await page.screenshot({ path: `test-results/theme-${info.project.name}-floor.png` });
  });

  test('AC7: shadows on a single floor / rack, off in the overview', async ({ page }) => {
    await boot(page);
    expect(await dc(page, () => window.__dc.shadows())).toBe(false);
    await page.evaluate(() => window.__dc.navigate({ floor: '2F' }));
    await expect.poll(() => dc(page, () => window.__dc.shadows())).toBe(true);
    await settled(page);
    await page.evaluate(() => window.__dc.navigate({ floor: null }));
    await expect.poll(() => dc(page, () => window.__dc.shadows())).toBe(false);
  });

  test('switching the theme rebuilds the scene in place (state and DC kept)', async ({ page }) => {
    await boot(page, `${dcHash()}&floor=3F`);
    const before = await dc(page, () => window.__dc.state());
    await page.locator('#theme-toggle').click();
    await settled(page);
    expect(await dc(page, () => window.__dc.state())).toEqual(before);
    expect(await dc(page, () => window.__dc.builtDc())).toBe('가산IDC');
    expect(await dc(page, () => window.__dc.floorVisible('3F'))).toBe(true);
  });
});
