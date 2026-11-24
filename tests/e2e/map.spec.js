import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, bootMap, settled, dc, state, loadSample, trackErrors, dcHash } from './helpers.js';

const data = loadSample();
const MAP = { dc: null, floor: null, rack: null, server: null };
const DC = Object.fromEntries(data.datacenters.map((d) => [d.id, d]));
const dcCounts = (d) => ({
  floors: d.floors.length,
  racks: d.floors.reduce((a, f) => a + f.racks.length, 0),
  devices: d.floors.reduce((a, f) => a + f.racks.reduce((b, r) => b + r.servers.length, 0), 0),
});

test.describe('map entry screen', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('AC1: no hash → map with 3 pins, #map canonical hash, 3D paused', async ({ page }) => {
    await bootMap(page);
    expect(await state(page)).toEqual(MAP);
    expect(await dc(page, () => window.__dc.mode())).toBe('map');
    expect(await dc(page, () => location.hash)).toBe('#map');
    expect(await dc(page, () => window.__dc.paused())).toBe(true);
    await expect(page.locator('#map-view .map-area')).not.toHaveCount(0);
    await expect(page.locator('.map-pin[data-dc]')).toHaveCount(3);
    for (const id of ['가산IDC', '영등포IDC', '파주IDC']) await expect(page.locator(`.map-pin[data-dc="${id}"]`)).toBeVisible();
    await expect(page.locator('#breadcrumb')).toHaveText('지도');
    await expect(page.locator('#viewport')).toBeHidden();
  });

  test('legacy / unknown hashes resolve to the map', async ({ page }) => {
    await boot(page, '#floor=2F&rack=R-2F-01-01');
    expect(await state(page)).toEqual(MAP);
    expect(await dc(page, () => location.hash)).toBe('#map');
    await boot(page, '#dc=nope');
    expect(await state(page)).toEqual(MAP);
  });

  test('AC3: pin hover shows the DC name with rack and device counts', async ({ page }) => {
    await bootMap(page);
    for (const id of Object.keys(DC)) {
      const c = dcCounts(DC[id]);
      await page.locator(`.map-pin[data-dc="${id}"] .pin-dot`).hover();
      await expect(page.locator('.map-tip')).toBeVisible();
      await expect(page.locator('.map-tip')).toHaveText(`${id} · 층 ${c.floors} · 랙 ${c.racks} · 장비 ${c.devices}`);
    }
  });

  test('AC4: pin click enters the DC; 지도 crumb, ESC and back return to the map', async ({ page }) => {
    await bootMap(page);
    await page.locator('.map-pin[data-dc="가산IDC"] .pin-dot').click();
    await expect.poll(() => state(page)).toEqual({ ...MAP, dc: '가산IDC' });
    await settled(page);
    expect(await dc(page, () => location.hash)).toBe(dcHash('가산IDC'));
    expect(await dc(page, () => window.__dc.builtDc())).toBe('가산IDC');
    expect(await dc(page, () => window.__dc.paused())).toBe(false);
    await expect(page.locator('#map-view')).toBeHidden();
    await expect(page.locator('#breadcrumb .crumb')).toHaveText(['지도', '가산IDC']);

    await page.locator('#breadcrumb [data-level=root]').click();
    await expect.poll(() => state(page)).toEqual(MAP);
    await expect(page.locator('#map-view')).toBeVisible();

    // side list → another DC, then browser back → map
    await page.locator('.map-item[data-dc="파주IDC"]').click();
    await expect.poll(() => state(page)).toEqual({ ...MAP, dc: '파주IDC' });
    await settled(page);
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(DC['파주IDC'].floors.map((f) => f.id));
    await page.goBack();
    await expect.poll(() => state(page)).toEqual(MAP);

    // ESC at a DC overview goes up to the map
    await page.locator('.map-item[data-dc="영등포IDC"]').click();
    await expect.poll(() => state(page)).toEqual({ ...MAP, dc: '영등포IDC' });
    await settled(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => state(page)).toEqual(MAP);
  });

  test('map ↔ DC round trips keep the built scene and log no errors', async ({ page }) => {
    await boot(page, `${dcHash('가산IDC')}&floor=3F`);
    for (let i = 0; i < 3; i++) {
      await page.locator('#breadcrumb [data-level=root]').click();
      await expect.poll(() => state(page)).toEqual(MAP);
      await settled(page);
      await page.locator('.map-pin[data-dc="가산IDC"] .pin-dot').click();
      await expect.poll(() => state(page)).toEqual({ ...MAP, dc: '가산IDC' });
      await settled(page);
    }
    expect(await dc(page, () => window.__dc.builtDc())).toBe('가산IDC');
  });

  test('AC5: an unknown build is listed as 미등록 DC (enterable) with an unknown-build warning', async ({ page }) => {
    await bootMap(page);
    await page.locator('#file-input').setInputFiles({ name: 'violations.csv', mimeType: 'text/csv', buffer: readFileSync('examples/violations.csv') });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect(page.locator('.map-item.unknown')).toHaveCount(1);
    await expect(page.locator('.map-item.unknown .name')).toHaveText('의왕IDC');
    await expect(page.locator('.map-list .unknown-title')).toHaveText('미등록 DC (1)');
    await expect(page.locator('.map-pin[data-dc="의왕IDC"]')).toHaveCount(0);
    await page.locator('#warnings').click();
    await expect(page.locator('#warnings-list li[data-kind=unknown-build]:not(.warn-group)')).toHaveCount(1);
    await page.locator('#warnings').click();
    await page.locator('.map-item.unknown').click();
    await expect.poll(() => state(page)).toEqual({ ...MAP, dc: '의왕IDC' });
    await settled(page);
  });
});
