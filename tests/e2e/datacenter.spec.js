import { test, expect } from '@playwright/test';
import { boot, bootMap, settled, dc, state, reach, loadSample, FIRST_DC, trackErrors } from './helpers.js';
import { floorStats } from '../../src/domain/occupancy.js';
import { rackLabel } from '../../src/domain/layout.js';

const data = loadSample();
const DC = Object.fromEntries(data.datacenters.map((d) => [d.id, d]));
const [GS, YDP, PJ] = data.datacenters.map((d) => d.id);
const pct = (avg) => `${Math.round(avg * 100)}%`;
const VIEW = { w: 1280, h: 720, top: 44 }; // playwright viewport; the top bar covers y < 44

const at = (dcId, o = {}) => ({ dc: dcId, floor: null, rack: null, server: null, ...o });
const inView = (p) => p && p.x > 0 && p.x < VIEW.w && p.y > VIEW.top && p.y < VIEW.h;
const hash = (page) => page.evaluate(() => location.hash);
const goDc = (page, id) => page.evaluate((x) => window.__dc.navigate({ dc: x }), id);
const rackCount = (d) => d.floors.reduce((a, f) => a + f.racks.length, 0);
const deviceCount = (d) => d.floors.reduce((a, f) => a + f.racks.reduce((b, r) => b + r.servers.length, 0), 0);

/** The racks nearest to each corner of a floor's grid (corner slots may be empty). */
function cornerRacks(floor) {
  const corners = [[1, 1], [1, floor.cols], [floor.rows, 1], [floor.rows, floor.cols]];
  return corners.map(([row, col]) =>
    floor.racks.reduce((best, r) => (Math.hypot(r.row - row, r.col - col) < Math.hypot(best.row - row, best.col - col) ? r : best)),
  );
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
  await expect(page.locator('#breadcrumb')).toHaveText(`지도>${d.name}`);
}

test.describe('multiple datacenters', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('the map lists the 3 DCs (pins + side list with counts); a pin opens that DC overview', async ({ page }) => {
    await bootMap(page);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual([GS, YDP, PJ]);
    expect(await dc(page, () => window.__dc.currentDc())).toBeNull();
    expect(await dc(page, () => window.__dc.mode())).toBe('map');
    expect(await hash(page)).toBe('#map');
    await expect(page.locator('.map-pin[data-dc]')).toHaveCount(3);
    const items = page.locator('.map-item');
    await expect(items).toHaveCount(3);
    for (const [i, d] of data.datacenters.entries()) {
      await expect(items.nth(i)).toHaveAttribute('data-dc', d.id);
      await expect(items.nth(i).locator('.name')).toHaveText(d.name);
      await expect(items.nth(i).locator('.meta')).toHaveText(`층 ${d.floors.length} · 랙 ${rackCount(d)} · 장비 ${deviceCount(d)}`);
    }
    await page.locator(`.map-pin[data-dc="${YDP}"] .pin-dot`).click();
    await reach(page, at(YDP));
    expect(await hash(page)).toBe(`#dc=${encodeURIComponent(YDP)}`);
    await expectOverview(page, YDP);
  });

  test('map side list opens a DC; breadcrumb 지도 and ESC return to the map', async ({ page }) => {
    await bootMap(page);
    await page.locator(`.map-item[data-dc="${PJ}"]`).click();
    await reach(page, at(PJ));
    await expectOverview(page, PJ);
    await page.locator('#breadcrumb [data-level=root]').click();
    await reach(page, at(null));
    expect(await dc(page, () => window.__dc.mode())).toBe('map');
    await expect(page.locator('#map-view')).toBeVisible();
    await page.locator(`.map-item[data-dc="${GS}"]`).click();
    await reach(page, at(GS));
    await page.keyboard.press('Escape');
    await reach(page, at(null));
    await expect(page.locator('#map-view')).toBeVisible();
  });

  test(`switch to ${YDP}: its floor labels, hash, nothing stale; history back/forward; GPU memory returns`, async ({ page }) => {
    await boot(page);
    await expect(page.locator('#map-view')).toBeHidden();
    await expectOverview(page, GS);
    const mem0 = await dc(page, () => window.__dc.gpuMemory());
    await goDc(page, YDP);
    await reach(page, at(YDP));
    expect(await hash(page)).toBe(`#dc=${encodeURIComponent(YDP)}`);
    await expectOverview(page, YDP);
    // Only this DC's racks are built and visible.
    expect((await dc(page, () => window.__dc.visibleRackIds())).length).toBe(rackCount(DC[YDP]));

    await page.goBack();
    await reach(page, at(GS));
    await expectOverview(page, GS);
    await page.goForward();
    await reach(page, at(YDP));
    await expectOverview(page, YDP);

    // Back to the first DC: GPU geometries/textures return to the first build (old DC disposed).
    await goDc(page, GS);
    await reach(page, at(GS));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await dc(page, () => window.__dc.gpuMemory())).toEqual(mem0);
  });

  test('rack/server state survives a switch away and back (back button restores the previous DC deep state)', async ({ page }) => {
    const f = DC[YDP].floors[1];
    const rack = f.racks.find((r) => r.servers.length >= 4);
    const server = rack.servers[1];
    await boot(page, `#dc=${encodeURIComponent(YDP)}&server=${encodeURIComponent(server.id)}`);
    await reach(page, at(YDP, { floor: f.id, rack: rack.id, server: server.id }));
    await expect(page.locator('#server-detail [data-k=build_name]')).toHaveText(DC[YDP].name);
    await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText(server.device_name);
    await expect(page.locator('#breadcrumb')).toHaveText(`지도>${DC[YDP].name}>${f.id}>${rackLabel(rack)}>${server.device_name}`);
    await goDc(page, PJ);
    await reach(page, at(PJ));
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#server-detail')).toBeHidden();
    expect(await dc(page, () => window.__dc.selectedRackId())).toBeNull();
    await page.goBack();
    await reach(page, at(YDP, { floor: f.id, rack: rack.id, server: server.id }));
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText(server.device_name);
  });

  test(`camera frames the stack (overview) and ${PJ} larger floors (floor mode corner racks)`, async ({ page }) => {
    await boot(page);
    await expectOverview(page, GS);
    await goDc(page, PJ);
    await reach(page, at(PJ));
    await expectOverview(page, PJ);
    for (const f of DC[PJ].floors) {
      await page.evaluate((id) => window.__dc.navigate({ floor: id }), f.id);
      await reach(page, at(PJ, { floor: f.id }));
      for (const r of cornerRacks(f)) {
        const p = await dc(page, (id) => window.__dc.rackScreenPos(id), r.id);
        expect(inView(p), `${f.id} ${r.id} at ${JSON.stringify(p)}`).toBe(true);
      }
    }
    await goDc(page, YDP);
    await reach(page, at(YDP));
    await expectOverview(page, YDP);
  });

  test('deep link #dc=<DC>&floor=2F&rack=<id> opens that rack', async ({ page }) => {
    const f = DC[PJ].floors.find((x) => x.id === '2F');
    const rack = f.racks.find((r) => r.servers.length >= 6);
    await boot(page, `#dc=${encodeURIComponent(PJ)}&floor=2F&rack=${encodeURIComponent(rack.id)}`);
    await reach(page, at(PJ, { floor: '2F', rack: rack.id }));
    expect(await dc(page, () => window.__dc.mode())).toBe('rack');
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#elevation h2')).toHaveText(`${rackLabel(rack)} · 2F`);
    await expect(page.locator('#elevation .elev-server')).toHaveCount(rack.servers.length);
    await expect(page.locator(`#elevation [data-server-id="${rack.servers[0].id}"] .host`)).toHaveText(rack.servers[0].device_name);
  });

  test('unknown dc falls back to the map with the URL rewritten', async ({ page }) => {
    await boot(page, '#dc=nowhere&floor=2F');
    await reach(page, at(null));
    expect(await hash(page)).toBe('#map');
    await expect(page.locator('#map-view')).toBeVisible();
  });

  test('a hash without dc (old style) opens the map', async ({ page }) => {
    const rack = DC[GS].floors.find((x) => x.id === '2F').racks[5];
    await boot(page, `#floor=2F&rack=${encodeURIComponent(rack.id)}`);
    await reach(page, at(null));
    expect(await hash(page)).toBe('#map');
  });

  test('a single-DC records file with an unregistered build name lists it beside the map and opens it', async ({ page }) => {
    const records = [
      { build_name: '신규IDC', floorspace_name: '1A0101', company: '테스트', rack_name: 'RK1', device_position: '2U (1-2)', device_name: 'new-01' },
      { build_name: '신규IDC', floorspace_name: '2A0102', company: '테스트', rack_name: 'RK2', device_position: '', device_name: '' },
    ];
    await page.route('**/data/datacenter.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) }),
    );
    await bootMap(page);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(['신규IDC']);
    await expect(page.locator('.map-item.unknown')).toHaveCount(1);
    await expect(page.locator('.map-pin[data-dc]')).toHaveCount(0);
    await page.locator('.map-item[data-dc="신규IDC"]').click();
    await expect.poll(() => state(page)).toEqual(at('신규IDC'));
    await settled(page);
    await expect(page.locator('.floor-label')).toHaveCount(2);
    await dc(page, () => window.__dc.navigate({ rack: 'RK1' }));
    await expect.poll(() => state(page)).toEqual(at('신규IDC', { floor: '1F', rack: 'RK1' }));
    await expect(page.locator('#elevation .elev-server')).toHaveCount(1);
  });

  test('search finds a device that only exists in another DC, switches DC and opens the device', async ({ page }) => {
    const f = DC[YDP].floors[2];
    const rack = f.racks.find((r) => r.servers.length >= 3);
    const server = rack.servers[2];
    await boot(page);
    await page.locator('#search').fill(server.device_name);
    const first = page.locator('#search-results .result.active');
    await expect(first).toHaveAttribute('data-server-id', server.id);
    await expect(first).toHaveAttribute('data-dc-id', YDP);
    await expect(first.locator('.sub')).toHaveText(`${rack.name} · ${rack.floorspaces.join(',')} · ${DC[YDP].name}`);
    await page.keyboard.press('Enter');
    await reach(page, at(YDP, { floor: f.id, rack: rack.id, server: server.id }));
    expect(await dc(page, () => window.__dc.builtDc())).toBe(YDP);
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText(server.device_name);
    await expect(page.locator('#server-detail [data-k=build_name]')).toHaveText(DC[YDP].name);
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(DC[YDP].floors.map((x) => x.id));
    expect(await page.locator('.floor-label').count()).toBeLessThanOrEqual(DC[YDP].floors.length);
    // Same-DC results have no DC suffix now that this DC is current.
    await page.locator('#search').fill(server.device_name);
    await expect(page.locator('#search-results .result.active .sub')).toHaveText(`${rack.name} · ${rack.floorspaces.join(',')}`);
  });

  test('breadcrumb DC crumb shows the DC name and goes to that DC overview', async ({ page }) => {
    const f = DC[PJ].floors[0];
    const rack = f.racks.find((r) => r.servers.length >= 2);
    await boot(page, `#dc=${encodeURIComponent(PJ)}&rack=${encodeURIComponent(rack.id)}`);
    await reach(page, at(PJ, { floor: f.id, rack: rack.id }));
    const crumb = page.locator('#breadcrumb [data-level=dc]');
    await expect(crumb).toHaveText(DC[PJ].name);
    await expect(page.locator('#breadcrumb')).toHaveText(`지도>${DC[PJ].name}>${f.id}>${rackLabel(rack)}`);
    await crumb.click();
    await reach(page, at(PJ));
    expect(await dc(page, () => window.__dc.mode())).toBe('overview');
    await expectOverview(page, PJ);
    for (const x of DC[PJ].floors) expect(await dc(page, (id) => window.__dc.floorOpacity(id), x.id)).toBe(1);
  });
});
