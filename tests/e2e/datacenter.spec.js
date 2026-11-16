import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc, state, reach } from './helpers.js';
import { normalize } from '../../src/data/schema.js';
import { floorStats } from '../../src/domain/occupancy.js';
import { rackLabel } from '../../src/domain/layout.js';

const data = normalize(JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8')));
const DC = Object.fromEntries(data.datacenters.map((d) => [d.id, d]));
const pct = (avg) => `${Math.round(avg * 100)}%`;
const VIEW = { w: 1280, h: 720, top: 44 }; // playwright viewport; the top bar covers y < 44

const at = (dcId, o = {}) => ({ dc: dcId, floor: null, rack: null, server: null, ...o });
const inView = (p) => p && p.x > 0 && p.x < VIEW.w && p.y > VIEW.top && p.y < VIEW.h;

/** The racks nearest to each corner of a floor's grid (corner slots may be empty). */
function cornerRacks(floor) {
  const corners = [[1, 1], [1, floor.cols], [floor.rows, 1], [floor.rows, floor.cols]];
  return corners.map(([row, col]) =>
    floor.racks.reduce((best, r) => (Math.hypot(r.row - row, r.col - col) < Math.hypot(best.row - row, best.col - col) ? r : best)),
  );
}

async function selectDc(page, id) {
  await page.locator('#dc-select').selectOption(id);
  await reach(page, at(id));
}

/** Overview of `dcId`: exactly its floor labels (no stale ones), texts from floorStats, all on screen. */
async function expectOverview(page, dcId) {
  const d = DC[dcId];
  await expect(page.locator('.floor-label')).toHaveCount(d.floors.length);
  for (const f of d.floors) {
    const s = floorStats(f);
    const label = page.locator(`.floor-label[data-floor="${f.id}"]`);
    await expect(label).toHaveText(`${f.id} · 랙 ${s.racks}/${s.slots} · 평균 ${pct(s.avg)}`);
    await expect(label).toBeVisible();
    const pos = await dc(page, (id) => window.__dc.floorLabelScreenPos(id), f.id);
    expect(inView(pos), `${dcId} ${f.id} label at ${JSON.stringify(pos)}`).toBe(true);
  }
  expect(await dc(page, () => window.__dc.builtDc())).toBe(dcId);
  expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(d.floors.map((f) => f.id));
  await expect(page.locator('#dc-select')).toHaveValue(dcId);
  await expect(page.locator('#breadcrumb')).toHaveText(d.name);
}

test.describe('multiple datacenters', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('selector lists the 3 DCs (name + counts title) and starts on the first', async ({ page }) => {
    await boot(page);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(['seoul-1', 'busan-1', 'daejeon-1']);
    expect(await dc(page, () => window.__dc.currentDc())).toBe('seoul-1');
    const opts = page.locator('#dc-select option');
    await expect(opts).toHaveCount(3);
    for (const [i, d] of data.datacenters.entries()) {
      await expect(opts.nth(i)).toHaveAttribute('value', d.id);
      await expect(opts.nth(i)).toHaveText(d.name);
      const racks = d.floors.reduce((a, f) => a + f.racks.length, 0);
      await expect(opts.nth(i)).toHaveAttribute('title', new RegExp(`^${d.floors.length}개 층 · 랙 ${racks} · `));
    }
    expect(await page.evaluate(() => location.hash)).toBe('#dc=seoul-1');
    await expectOverview(page, 'seoul-1');
  });

  test('switch to busan-1: 3 floor labels with its stats, hash dc=busan-1, nothing stale; back restores seoul-1', async ({ page }) => {
    await boot(page);
    const mem0 = await dc(page, () => window.__dc.gpuMemory());
    await selectDc(page, 'busan-1');
    expect(await page.evaluate(() => location.hash)).toBe('#dc=busan-1');
    await expectOverview(page, 'busan-1');
    // Only busan's racks are built and visible.
    const ids = await dc(page, () => window.__dc.visibleRackIds());
    expect(ids.length).toBe(DC['busan-1'].floors.reduce((a, f) => a + f.racks.length, 0));

    await page.goBack();
    await reach(page, at('seoul-1'));
    await expectOverview(page, 'seoul-1');
    await page.goForward();
    await reach(page, at('busan-1'));
    await expectOverview(page, 'busan-1');

    // Back to seoul via the selector: GPU geometries/textures return to the first build (old DC disposed).
    await selectDc(page, 'seoul-1');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await dc(page, () => window.__dc.gpuMemory())).toEqual(mem0);
  });

  test('rack/server state survives a switch away and back (back button restores the previous DC deep state)', async ({ page }) => {
    const f = DC['busan-1'].floors[1];
    const rack = f.racks.find((r) => r.servers.length >= 4);
    const server = rack.servers[1];
    await boot(page, `#dc=busan-1&server=${server.id}`);
    await reach(page, at('busan-1', { floor: f.id, rack: rack.id, server: server.id }));
    await expect(page.locator('#server-detail [data-k=dc]')).toHaveText('부산 DC2');
    await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText(server.hostname);
    await expect(page.locator('#breadcrumb')).toHaveText(`부산 DC2>${f.id}>${rackLabel(rack)}>${server.hostname}`);
    await page.locator('#dc-select').selectOption('daejeon-1');
    await reach(page, at('daejeon-1'));
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#server-detail')).toBeHidden();
    expect(await dc(page, () => window.__dc.selectedRackId())).toBeNull();
    await page.goBack();
    await reach(page, at('busan-1', { floor: f.id, rack: rack.id, server: server.id }));
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#dc-select')).toHaveValue('busan-1');
    await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText(server.hostname);
  });

  test('camera frames the stack (overview) and daejeon-1 larger floors (floor mode corner racks)', async ({ page }) => {
    await boot(page);
    await expectOverview(page, 'seoul-1');
    await selectDc(page, 'daejeon-1');
    await expectOverview(page, 'daejeon-1');
    for (const f of DC['daejeon-1'].floors) {
      await page.evaluate((id) => window.__dc.navigate({ floor: id }), f.id);
      await reach(page, at('daejeon-1', { floor: f.id }));
      for (const r of cornerRacks(f)) {
        const p = await dc(page, (id) => window.__dc.rackScreenPos(id), r.id);
        expect(inView(p), `${f.id} ${r.id} at ${JSON.stringify(p)}`).toBe(true);
      }
    }
    await selectDc(page, 'busan-1');
    await expectOverview(page, 'busan-1');
  });

  test('deep link #dc=daejeon-1&floor=2F&rack=<id> opens that rack', async ({ page }) => {
    const f = DC['daejeon-1'].floors.find((x) => x.id === '2F');
    const rack = f.racks.find((r) => r.servers.length >= 6);
    await boot(page, `#dc=daejeon-1&floor=2F&rack=${rack.id}`);
    await reach(page, at('daejeon-1', { floor: '2F', rack: rack.id }));
    expect(await dc(page, () => window.__dc.mode())).toBe('rack');
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#dc-select')).toHaveValue('daejeon-1');
    await expect(page.locator('#elevation h2')).toHaveText(`${rackLabel(rack)} · 2F`);
    await expect(page.locator('#elevation .elev-server')).toHaveCount(rack.servers.length);
    // Same id in seoul-1 is a different rack: the elevation must follow the DC, not just the rack id.
    const twin = DC['seoul-1'].floors.find((x) => x.id === '2F').racks.find((r) => r.id === rack.id);
    if (twin) {
      await page.locator('#dc-select').selectOption('seoul-1');
      await reach(page, at('seoul-1'));
      await page.evaluate((id) => window.__dc.navigate({ rack: id }), rack.id);
      await reach(page, at('seoul-1', { floor: '2F', rack: rack.id }));
      await expect(page.locator('#elevation .elev-server')).toHaveCount(twin.servers.length);
      await expect(page.locator(`#elevation [data-server-id="${twin.servers[0].id}"] .host`)).toHaveText(twin.servers[0].hostname);
    }
  });

  test('unknown dc falls back to the first DC with the URL rewritten', async ({ page }) => {
    await boot(page, '#dc=nowhere&floor=2F');
    await reach(page, at('seoul-1'));
    expect(await page.evaluate(() => location.hash)).toBe('#dc=seoul-1');
    await expectOverview(page, 'seoul-1');
  });

  test('legacy hash without dc opens the first DC', async ({ page }) => {
    const rack = DC['seoul-1'].floors.find((x) => x.id === '2F').racks[5];
    await boot(page, `#floor=2F&rack=${rack.id}`);
    await reach(page, at('seoul-1', { floor: '2F', rack: rack.id }));
    expect(await page.evaluate(() => location.hash)).toBe(`#dc=seoul-1&floor=2F&rack=${rack.id}`);
  });

  test('legacy v1 single-DC file loads as dc "default" and its legacy hash works', async ({ page }) => {
    const v1 = {
      version: 1,
      name: '구버전 DC',
      floors: [
        { id: '1F', level: 1, rows: 2, cols: 2, racks: [{ id: 'R1', row: 1, col: 1, servers: [{ id: 's1', hostname: 'old-01', unit: 1, height_u: 2 }] }] },
        { id: '2F', level: 2, rows: 3, cols: 4, racks: [{ id: 'R2', row: 2, col: 3, servers: [] }] },
      ],
    };
    await page.route('**/data/datacenter.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v1) }),
    );
    await page.goto('/?debug=1#floor=1F&rack=R1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect.poll(() => state(page)).toEqual(at('default', { floor: '1F', rack: 'R1' }));
    await settled(page);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(['default']);
    expect(await page.evaluate(() => location.hash)).toBe('#dc=default&floor=1F&rack=R1');
    await expect(page.locator('#dc-select option')).toHaveText(['구버전 DC']);
    await expect(page.locator('#breadcrumb [data-level=root]')).toHaveText('구버전 DC');
    await expect(page.locator('#elevation .elev-server')).toHaveCount(1);
    await expect(page.locator('#warnings')).toBeHidden();
  });

  test('search finds a hostname that only exists in another DC, switches DC and opens the server', async ({ page }) => {
    const f = DC['busan-1'].floors[2];
    const rack = f.racks.find((r) => r.servers.length >= 3);
    const server = rack.servers[2];
    expect(server.hostname).toContain('-pus-');
    await boot(page);
    await page.locator('#search').fill(server.hostname);
    const first = page.locator('#search-results .result.active');
    await expect(first).toHaveAttribute('data-server-id', server.id);
    await expect(first).toHaveAttribute('data-dc-id', 'busan-1');
    await expect(first.locator('.sub')).toHaveText(`${rack.id} · 부산 DC2`);
    await page.keyboard.press('Enter');
    await reach(page, at('busan-1', { floor: f.id, rack: rack.id, server: server.id }));
    expect(await dc(page, () => window.__dc.builtDc())).toBe('busan-1');
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#dc-select')).toHaveValue('busan-1');
    await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText(server.hostname);
    await expect(page.locator('#server-detail [data-k=dc]')).toHaveText('부산 DC2');
    // Server mode hides every floor label; CSS2DRenderer only attaches labels it has drawn, and seoul's are gone.
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(DC['busan-1'].floors.map((x) => x.id));
    expect(await page.locator('.floor-label').count()).toBeLessThanOrEqual(DC['busan-1'].floors.length);
    // Same-DC results have no DC suffix now that busan-1 is current.
    await page.locator('#search').fill(server.hostname);
    await expect(page.locator('#search-results .result.active .sub')).toHaveText(rack.id);
  });

  test('breadcrumb root shows the DC name and goes to that DC overview', async ({ page }) => {
    const f = DC['daejeon-1'].floors[0];
    const rack = f.racks.find((r) => r.servers.length >= 2);
    await boot(page, `#dc=daejeon-1&rack=${rack.id}`);
    await reach(page, at('daejeon-1', { floor: f.id, rack: rack.id }));
    const root = page.locator('#breadcrumb [data-level=root]');
    await expect(root).toHaveText('대전 DC3');
    await expect(page.locator('#breadcrumb')).toHaveText(`대전 DC3>${f.id}>${rackLabel(rack)}`);
    await root.click();
    await reach(page, at('daejeon-1'));
    expect(await dc(page, () => window.__dc.mode())).toBe('overview');
    await expectOverview(page, 'daejeon-1');
    for (const x of DC['daejeon-1'].floors) expect(await dc(page, (id) => window.__dc.floorOpacity(id), x.id)).toBe(1);
  });
});
