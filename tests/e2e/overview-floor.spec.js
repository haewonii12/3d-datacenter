import { test, expect } from '@playwright/test';
import { boot, bootMap, settled, loadSample, FIRST_DC, trackErrors } from './helpers.js';
import { floorStats, occupancy, colorFor, bandFor } from '../../src/domain/occupancy.js';
import { slotCount } from '../../src/domain/slots.js';

const data = loadSample().datacenters.find((d) => d.id === FIRST_DC);
const floorIds = data.floors.map((f) => f.id);
const pct = (avg) => `${Math.round(avg * 100)}%`;
const cellsUsed = (f) => f.racks.reduce((a, r) => a + r.span, 0);

test.describe('overview & floor', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

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

  test('AC6: empty slot count = zone cells - cells covered by racks per floor', async ({ page }) => {
    await boot(page);
    for (const f of data.floors) {
      expect(await page.evaluate((id) => window.__dc.emptySlotCount(id), f.id)).toBe(slotCount(f) - cellsUsed(f));
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
    expect(await page.evaluate(() => window.__dc.state())).toEqual({ dc: FIRST_DC, floor: '2F', rack: null, server: null });
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
    await expect(sum.locator('[data-k=zones]')).toHaveText(f2.zones.map((z) => z.id).join(' · '));
    for (const b of ['green', 'yellow', 'red']) await expect(sum.locator(`[data-k=${b}]`)).toHaveText(String(s.bands[b]));
    await expect(page.locator('#breadcrumb')).toContainText('2F');
  });

  test('floor → overview restores all floors; summary hidden', async ({ page }) => {
    await boot(page, '#dc=%EA%B0%80%EC%82%B0IDC&floor=3F');
    expect(await page.evaluate(() => window.__dc.floorOpacity('1F'))).toBe(0);
    await page.evaluate(() => window.__dc.navigate({ floor: null }));
    await settled(page);
    expect(await page.evaluate(() => window.__dc.mode())).toBe('overview');
    for (const id of floorIds) expect(await page.evaluate((i) => window.__dc.floorOpacity(i), id)).toBe(1);
    await expect(page.locator('#floor-summary')).toBeHidden();
    await expect(page.locator('.floor-label')).toHaveCount(4);
    for (const id of floorIds) await expect(page.locator(`.floor-label[data-floor="${id}"]`)).toBeVisible();
  });

  test('map entry: no hash shows the map and no floor labels; overview ESC returns to it', async ({ page }) => {
    await bootMap(page);
    expect(await page.evaluate(() => window.__dc.mode())).toBe('map');
    expect(await page.evaluate(() => location.hash)).toBe('#map');
    await expect(page.locator('#floor-summary')).toBeHidden();
    await boot(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__dc.mode())).toBe('map');
    await expect(page.locator('#map-view')).toBeVisible();
  });
});

test.describe('AC2: load errors and warnings', () => {
  const rec = (rack, pos, name, cells = '1A0101', build = FIRST_DC) => ({
    build_name: build,
    floorspace_name: cells,
    company: '테스트',
    rack_name: rack,
    device_position: pos,
    device_name: name,
  });
  const serve = (page, body) =>
    page.route('**/data/datacenter.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    );

  test('bad JSON → #error mentions JSON', async ({ page }) => {
    await serve(page, '{bad json');
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error')).toContainText('JSON');
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('empty record list → #error', async ({ page }) => {
    await serve(page, []);
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('#error')).toContainText('레코드가 없습니다');
  });

  test('records without a usable rack_name → #error (no valid records)', async ({ page }) => {
    await serve(page, [rec('', '2U (1-2)', 'x')]);
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('#error')).toContainText('유효한 레코드가 없습니다');
  });

  test('AC2: unparsable device_position → warning, info line, and the device panel explains why it is not drawn', async ({ page }) => {
    await serve(page, [rec('RK1', '2U (1-2)', 'ok-01'), rec('RK1', 'wrong', 'bad-01')]);
    await page.goto(`/?debug=1#dc=${encodeURIComponent(FIRST_DC)}&server=${encodeURIComponent('RK1:invalid:0')}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    await expect(page.locator('#warnings')).toBeVisible();
    await expect(page.locator('#info')).toContainText('장착 위치 오류 장비 1대');
    await expect(page.locator('#elevation .elev-server')).toHaveCount(1); // only ok-01 is drawn
    await expect(page.locator('#elevation .elev-bad li')).toHaveCount(1);
    await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText('bad-01');
    await expect(page.locator('#server-detail [data-k=violations]')).toContainText('해석할 수 없어');
  });

  test('overlap → no #error, warnings badge ≥ 1 with a grouped list, devices flagged', async ({ page }) => {
    await serve(page, [rec('RK1', '3U (1-3)', 'h1'), rec('RK1', '2U (2-3)', 'h2')]);
    await page.goto(`/?debug=1#dc=${encodeURIComponent(FIRST_DC)}&rack=RK1`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    await expect(page.locator('#error')).toBeHidden();
    const badge = page.locator('#warnings');
    await expect(badge).toBeVisible();
    const n = Number((await badge.textContent()).replace(/[^0-9]/g, ''));
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#warnings-list')).toBeHidden();
    await badge.click();
    await expect(page.locator('#warnings-list')).toBeVisible();
    await expect(page.locator('#warnings-list [data-kind=mount-overlap]').first()).toBeVisible();
    await expect(page.locator('#warnings-list')).toContainText('h1 / h2');
    await expect(page.locator('#elevation .elev-server.invalid')).toHaveCount(2);
    expect(await page.evaluate(() => window.__dc.violationRackIds())).toEqual(['RK1']);
  });
});
