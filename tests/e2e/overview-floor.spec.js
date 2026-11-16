import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { settled } from './helpers.js';
import { normalize } from '../../src/data/schema.js';
import { floorStats, occupancy, colorFor, bandFor } from '../../src/domain/occupancy.js';

const data = normalize(JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8'))).datacenters[0];
const floorIds = data.floors.map((f) => f.id);
const pct = (avg) => `${Math.round(avg * 100)}%`;

async function boot(page, url = '/?debug=1') {
  await page.goto(url);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  await page.waitForFunction(() => window.__dc && window.__dc.isSettled(), null, { timeout: 5000 });
}


test.describe('overview & floor', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('AC17: initial overview with 4 floor labels from floorStats', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.__dc.mode())).toBe('overview');
    await expect(page.locator('.floor-label')).toHaveCount(4);
    for (const f of data.floors) {
      const s = floorStats(f);
      await expect(page.locator(`.floor-label[data-floor="${f.id}"]`)).toHaveText(
        `${f.id} · 랙 ${s.racks}/${s.slots} · 평균 ${pct(s.avg)}`,
      );
      await expect(page.locator(`.floor-label[data-floor="${f.id}"]`)).toBeVisible();
    }
    for (const id of floorIds) expect(await page.evaluate((i) => window.__dc.floorOpacity(i), id)).toBe(1);
  });

  test('AC5: instance colors match colorFor(occupancy) for green/yellow/red racks', async ({ page }) => {
    await boot(page);
    const racks = data.floors.flatMap((f) => f.racks);
    for (const band of ['green', 'yellow', 'red']) {
      const rack = racks.find((r) => bandFor(occupancy(r)) === band);
      expect(rack, `a ${band} rack exists`).toBeTruthy();
      const got = await page.evaluate((id) => window.__dc.rackInstanceColor(id), rack.id);
      expect(got.toLowerCase()).toBe(colorFor(occupancy(rack)).toLowerCase());
    }
  });

  test('AC6: empty slot count = rows*cols - racks per floor', async ({ page }) => {
    await boot(page);
    for (const f of data.floors) {
      expect(await page.evaluate((id) => window.__dc.emptySlotCount(id), f.id)).toBe(f.rows * f.cols - f.racks.length);
    }
  });

  test('AC18/AC4/AC7: label click enters floor with observable fade; summary matches', async ({ page }) => {
    await boot(page);
    const pos = await page.evaluate(() => window.__dc.floorLabelScreenPos('2F'));
    expect(pos).toBeTruthy();
    await page.mouse.click(pos.x, pos.y);
    const samples = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const out = [];
          const t0 = performance.now();
          const iv = setInterval(() => {
            out.push(window.__dc.floorOpacity('1F'));
            if (performance.now() - t0 > 1000) {
              clearInterval(iv);
              resolve(out);
            }
          }, 5);
        }),
    );
    expect(samples.some((o) => o > 0 && o < 1), `samples: ${samples.join(',')}`).toBe(true);
    await settled(page);
    expect(await page.evaluate(() => window.__dc.state())).toEqual({ dc: 'seoul-1', floor: '2F', rack: null, server: null });
    expect(await page.evaluate(() => window.__dc.mode())).toBe('floor');
    for (const id of floorIds.filter((i) => i !== '2F')) {
      expect(await page.evaluate((i) => window.__dc.floorOpacity(i), id)).toBe(0);
      expect(await page.evaluate((i) => window.__dc.floorVisible(i), id)).toBe(false);
      await expect(page.locator(`.floor-label[data-floor="${id}"]`)).toBeHidden();
    }
    expect(await page.evaluate(() => window.__dc.floorOpacity('2F'))).toBe(1);
    const f2 = data.floors.find((f) => f.id === '2F');
    const ids = await page.evaluate(() => window.__dc.visibleRackIds());
    expect(ids.length).toBe(f2.racks.length);
    const own = new Set(f2.racks.map((r) => r.id));
    expect(ids.every((id) => own.has(id))).toBe(true);

    const s = floorStats(f2);
    const sum = page.locator('#floor-summary');
    await expect(sum).toBeVisible();
    await expect(sum.locator('[data-k=racks]')).toHaveText(String(s.racks));
    await expect(sum.locator('[data-k=slots]')).toHaveText(String(s.slots));
    await expect(sum.locator('[data-k=avg]')).toHaveText(pct(s.avg));
    for (const b of ['green', 'yellow', 'red']) await expect(sum.locator(`[data-k=${b}]`)).toHaveText(String(s.bands[b]));
    await expect(page.locator('#breadcrumb')).toContainText('2F');
  });

  test('floor → overview restores all floors; summary hidden', async ({ page }) => {
    await boot(page, '/?debug=1#floor=3F');
    expect(await page.evaluate(() => window.__dc.floorOpacity('1F'))).toBe(0);
    await page.evaluate(() => window.__dc.navigate({}));
    await settled(page);
    expect(await page.evaluate(() => window.__dc.mode())).toBe('overview');
    for (const id of floorIds) expect(await page.evaluate((i) => window.__dc.floorOpacity(i), id)).toBe(1);
    await expect(page.locator('#floor-summary')).toBeHidden();
    await expect(page.locator('.floor-label')).toHaveCount(4);
    for (const id of floorIds) await expect(page.locator(`.floor-label[data-floor="${id}"]`)).toBeVisible();
  });
});

test.describe('AC2: load errors and warnings', () => {
  const fixture = (mutate) => {
    const json = {
      version: 1,
      floors: [
        {
          id: '1F',
          level: 1,
          rows: 2,
          cols: 2,
          racks: [{ id: 'R1', row: 1, col: 1, servers: [{ id: 's1', hostname: 'h1', unit: 1, height_u: 2 }] }],
        },
      ],
    };
    mutate(json);
    return JSON.stringify(json);
  };
  const serve = (page, body) =>
    page.route('**/data/datacenter.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));

  test('bad JSON → #error mentions JSON', async ({ page }) => {
    await serve(page, '{bad json');
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error')).toContainText('JSON');
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('missing rows → #error contains floors[0].rows', async ({ page }) => {
    await serve(page, fixture((j) => delete j.floors[0].rows));
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('#error')).toContainText('floors[0].rows');
  });

  test('AC13/AC2: bad service status → warning + grey status-unknown badge', async ({ page }) => {
    await serve(page, fixture((j) => (j.floors[0].racks[0].servers[0].services = [{ name: 'x-api', team: 't', status: 'weird' }])));
    await page.goto('/?debug=1#server=s1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect(page.locator('#warnings')).toBeVisible();
    const badge = page.locator('#server-detail .service .badge');
    await expect(badge).toHaveClass(/\bstatus-unknown\b/);
    await expect(badge).toHaveText('알수없음');
  });

  test('overlap → no #error, warnings badge ≥ 1 with list', async ({ page }) => {
    await serve(page, fixture((j) => j.floors[0].racks[0].servers.push({ id: 's2', hostname: 'h2', unit: 2 })));
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect(page.locator('#error')).toBeHidden();
    const badge = page.locator('#warnings');
    await expect(badge).toBeVisible();
    const n = Number((await badge.textContent()).replace(/[^0-9]/g, ''));
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#warnings-list')).toBeHidden();
    await badge.click();
    await expect(page.locator('#warnings-list')).toBeVisible();
    await expect(page.locator('#warnings-list')).toContainText('floors[0].racks[0].servers[1].unit');
    await expect(page.locator('#info')).toContainText('1');
  });
});
