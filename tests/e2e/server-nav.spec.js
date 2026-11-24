import { test, expect } from '@playwright/test';
import { boot, settled, dc, state, reach, loadSample, FIRST_DC, trackErrors } from './helpers.js';
import { RACK, rackFootprint, frontNormal, rackLabel, rackCellsLabel, unitRangeLabel } from '../../src/domain/layout.js';

// These specs exercise the first DC (the default view); multi-DC behaviour lives in datacenter.spec.js.
const data = loadSample().datacenters.find((d) => d.id === FIRST_DC);
const f2 = data.floors.find((f) => f.id === '2F');
const hashOf = (o = {}) =>
  `#dc=${encodeURIComponent(FIRST_DC)}${Object.entries(o).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;

/** deviceId → {floor, rack, server}, from the dataset itself. */
const lookup = new Map();
for (const floor of data.floors) for (const rack of floor.racks) for (const server of rack.servers) lookup.set(server.id, { floor, rack, server });

/** `2F · 2A0301–02-U10–11`, built from the dataset fields. */
const location = (id) => {
  const { floor, rack, server } = lookup.get(id);
  return `${floor.id} · ${rackCellsLabel(rack)}-${unitRangeLabel(server)}`;
};
const rackZ = (rack) => rackFootprint(f2, rack).cz;

/** Interior, well-filled single-cell rack of 2F with the given row parity (its facing row is between camera and rack). */
function interiorRack(parity, skip = 0) {
  const mid = (f2.cols + 1) / 2;
  return f2.racks
    .filter((r) => r.row % 2 === parity && r.servers.length >= 6 && r.span === 1 && r.col > 2 && r.col < f2.cols - 1)
    .filter((r) => r.row > 1 && r.row < f2.rows)
    .sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.row - b.row)[skip];
}

/** Canvas points (not covered by DOM overlays) whose pick satisfies `ok`, scanned on a grid. */
async function findPoint(page, ok) {
  const pts = await page.evaluate(() => {
    const out = [];
    const canvas = document.querySelector('#viewport canvas');
    for (let y = 70; y <= 880; y += 40)
      for (let x = 20; x <= 1030; x += 40) if (document.elementFromPoint(x, y) === canvas) out.push({ x, y });
    return out;
  });
  const hits = await dc(page, (ps) => ps.map((p) => window.__dc.pickAt(p.x, p.y)), pts);
  const i = hits.findIndex(ok);
  return i < 0 ? null : pts[i];
}
const isEmpty = (h) => !h || h.kind === 'slab';

async function expectPanel(page, serverId) {
  const { server, rack } = lookup.get(serverId);
  const d = page.locator('#server-detail');
  await expect(d).toBeVisible();
  await expect(d.locator('[data-k=device_name]')).toHaveText(server.device_name);
  await expect(d.locator('[data-k=company]')).toHaveText(server.company);
  await expect(d.locator('[data-k=build_name]')).toHaveText(data.name);
  await expect(d.locator('[data-k=rack_name]')).toHaveText(rack.name);
  await expect(d.locator('[data-k=floorspace_name]')).toHaveText(rack.floorspaces.join(','));
  await expect(d.locator('[data-k=device_position]')).toHaveText(server.device_position);
  await expect(d.locator('[data-k=location]')).toHaveText(location(serverId));
  await expect(d.locator('[data-k=violations]')).toHaveCount(0);
  // Both the elevation and the details are in view (details below the compacted elevation).
  await expect(page.locator('#elevation')).toBeVisible();
  await expect(page.locator(`#elevation [data-server-id="${serverId}"]`)).toHaveClass(/selected/);
}

/** Selected server slid out 0.25 along n and emissive; all others at 0 and not emissive. */
async function expectSlid(page, selectedId) {
  const meshes = await dc(page, () => window.__dc.serverMeshes());
  expect(meshes.length).toBeGreaterThan(0);
  for (const m of meshes) {
    const em = await dc(page, (id) => window.__dc.serverEmissive(id), m.id);
    if (m.id === selectedId) {
      expect(Math.abs(m.offsetAlongNormal - 0.25)).toBeLessThan(0.01);
      expect(em).not.toBe(0);
    } else {
      expect(m.offsetAlongNormal, m.id).toBe(0);
      expect(em, m.id).toBe(0);
    }
  }
}

test.describe('server selection & navigation', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('AC12/AC14: 3D click on a server of an interior rack → panel, slide-out; switching reverts; ESC clears', async ({ page }) => {
    const rack = interiorRack(1);
    await boot(page, hashOf({ rack: rack.id }));
    // The facing row (between camera and rack) is culled, so it no longer occludes the servers.
    const n = frontNormal(rack.row);
    const sel = { z: rackZ(rack) };
    const facing = f2.racks.filter((r) => (rackZ(r) - sel.z) * n.z > RACK.d / 2);
    expect(facing.length).toBeGreaterThan(0);
    expect((await dc(page, () => window.__dc.culledRackIds())).sort()).toEqual(facing.map((r) => r.id).sort());

    const [a, b] = [...rack.servers].sort((x, y) => y.height_u - x.height_u || x.unit - y.unit);
    const sp = await dc(page, (id) => window.__dc.serverScreenPos(id), a.id);
    expect(await dc(page, (p) => window.__dc.pickAt(p.x, p.y), sp)).toEqual({ kind: 'server', id: a.id });
    const cam = await dc(page, () => window.__dc.camera());
    await page.mouse.click(sp.x, sp.y);
    await reach(page, { floor: '2F', rack: rack.id, server: a.id });
    await expectPanel(page, a.id);
    await expectSlid(page, a.id);
    await expect(page.locator('#breadcrumb')).toHaveText(`지도>${data.name}>2F>${rackLabel(rack)}>${a.device_name}`);
    await expect(page.locator('#breadcrumb [data-level=server]')).toHaveClass(/current/);

    // Another server of the same rack: previous reverts, camera stays at the rack preset.
    const bp = await dc(page, (id) => window.__dc.serverScreenPos(id), b.id);
    expect(await dc(page, (p) => window.__dc.pickAt(p.x, p.y), bp)).toEqual({ kind: 'server', id: b.id });
    await page.mouse.click(bp.x, bp.y);
    await reach(page, { floor: '2F', rack: rack.id, server: b.id });
    await expectPanel(page, b.id);
    await expectSlid(page, b.id);
    // (camera-controls resolves setLookAt slightly before damping fully stops, hence the 0.05 tolerance.)
    const cam2 = await dc(page, () => window.__dc.camera());
    for (const k of ['position', 'target'])
      expect(Math.hypot(cam2[k].x - cam[k].x, cam2[k].y - cam[k].y, cam2[k].z - cam[k].z)).toBeLessThan(0.05);
    const c = await dc(page, (id) => window.__dc.rackCenter(id), rack.id);
    const want = { x: c.x + n.x * 3.5, y: c.y + 0.3, z: c.z + n.z * 3.5 };
    expect(Math.hypot(cam2.position.x - want.x, cam2.position.y - want.y, cam2.position.z - want.z)).toBeLessThan(0.05);

    // ESC: server → rack, every offset 0, no emissive.
    await page.keyboard.press('Escape');
    await reach(page, { floor: '2F', rack: rack.id });
    await expectSlid(page, null);
    await expect(page.locator('#server-detail')).toBeHidden();
    await expect(page.locator('#elevation .elev-server.selected')).toHaveCount(0);
  });

  test('AC12: elevation block click → server panel', async ({ page }) => {
    const rack = interiorRack(0);
    const s = rack.servers.find((x) => x.height_u === 1) ?? rack.servers[0];
    await boot(page, hashOf({ rack: rack.id }));
    // Right after the hashchange is applied the 200ms slide is running and isSettled() reports it.
    const mid = await page.evaluate(async (id) => {
      const changed = new Promise((r) => window.addEventListener('hashchange', r, { once: true }));
      document.querySelector(`#elevation [data-server-id="${id}"]`).click();
      await changed;
      const m = window.__dc.serverMeshes().find((x) => x.id === id);
      return { settled: window.__dc.isSettled(), off: m.offsetAlongNormal };
    }, s.id);
    expect(mid.settled).toBe(false);
    expect(mid.off).toBeLessThan(0.25);
    await reach(page, { floor: '2F', rack: rack.id, server: s.id });
    await expectPanel(page, s.id);
    await expectSlid(page, s.id);
  });

  test('AC11: ESC chain (server → rack → floor → overview → map), ESC in search input ignored, breadcrumb crumbs', async ({ page }) => {
    const rack = interiorRack(1);
    const s = rack.servers[0];
    await boot(page, hashOf({ server: s.id }));
    await reach(page, { floor: '2F', rack: rack.id, server: s.id });

    await page.locator('#search').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(await state(page)).toEqual({ dc: FIRST_DC, floor: '2F', rack: rack.id, server: s.id });
    await page.locator('#search').blur();

    await page.keyboard.press('Escape');
    await reach(page, { floor: '2F', rack: rack.id });
    await page.keyboard.press('Escape');
    await reach(page, { floor: '2F' });
    await page.keyboard.press('Escape');
    await reach(page, {});
    // One more ESC at the DC overview goes to the map.
    await page.keyboard.press('Escape');
    await reach(page, { dc: null });
    await expect(page.locator('#map-view')).toBeVisible();

    // Breadcrumb: server → "2F" → floor; then the DC crumb → overview; then 지도 → map.
    await dc(page, ({ d, id }) => window.__dc.navigate({ dc: d, server: id }), { d: FIRST_DC, id: s.id });
    await reach(page, { floor: '2F', rack: rack.id, server: s.id });
    await page.locator('#breadcrumb [data-level=floor]').click();
    await reach(page, { floor: '2F' });
    await expect(page.locator('#breadcrumb [data-level=floor]')).toHaveClass(/current/);
    await page.locator('#breadcrumb [data-level=dc]').click();
    await reach(page, {});
    await expect(page.locator('#breadcrumb [data-level]')).toHaveCount(2);
    await page.locator('#breadcrumb [data-level=root]').click();
    await reach(page, { dc: null });
    await expect(page.locator('#breadcrumb [data-level]')).toHaveCount(1);
  });

  test('AC11: empty-space click server → rack → floor → overview; server click switches; drag keeps state', async ({ page }) => {
    const rack = interiorRack(1);
    const [a, b] = rack.servers;
    await boot(page, hashOf({ server: a.id }));
    await reach(page, { floor: '2F', rack: rack.id, server: a.id });

    // 2-pass in server mode: a click on another server selects it.
    const bp = await dc(page, (id) => window.__dc.serverScreenPos(id), b.id);
    expect(await dc(page, (p) => window.__dc.pickAt(p.x, p.y), bp)).toEqual({ kind: 'server', id: b.id });
    await page.mouse.click(bp.x, bp.y);
    await reach(page, { floor: '2F', rack: rack.id, server: b.id });

    // Orbit drag (50px) in server mode leaves the state unchanged.
    const e0 = await findPoint(page, isEmpty);
    expect(e0, 'empty space in server mode').toBeTruthy();
    await page.mouse.move(e0.x, e0.y);
    await page.mouse.down();
    await page.mouse.move(e0.x + 50, e0.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await state(page)).toEqual({ dc: FIRST_DC, floor: '2F', rack: rack.id, server: b.id });

    const e1 = await findPoint(page, isEmpty);
    await page.mouse.click(e1.x, e1.y);
    await reach(page, { floor: '2F', rack: rack.id });
    await expectSlid(page, null);

    const e2 = await findPoint(page, isEmpty);
    expect(e2, 'empty space in rack mode').toBeTruthy();
    await page.mouse.click(e2.x, e2.y);
    await reach(page, { floor: '2F' });
    // AC21 tail: back on the floor the racks are fully opaque again.
    expect(await dc(page, () => window.__dc.floorOpacity('2F'))).toBe(1);

    const e3 = await findPoint(page, isEmpty);
    expect(e3, 'empty space in floor mode').toBeTruthy();
    await page.mouse.click(e3.x, e3.y);
    await reach(page, {});
  });

  test('AC21 tail / AC4: rack → ESC → floor opacity 1; breadcrumb "2F" from rack hides other floors', async ({ page }) => {
    const rack = interiorRack(0);
    await boot(page, hashOf({ rack: rack.id }));
    await page.keyboard.press('Escape');
    await reach(page, { floor: '2F' });
    expect(await dc(page, () => window.__dc.floorOpacity('2F'))).toBe(1);
    expect(await dc(page, () => window.__dc.culledRackIds())).toEqual([]);

    await dc(page, (id) => window.__dc.navigate({ rack: id }), rack.id);
    await reach(page, { floor: '2F', rack: rack.id });
    await page.locator('#breadcrumb [data-level=floor]').click();
    await reach(page, { floor: '2F' });
    const own = new Set(f2.racks.map((r) => r.id));
    const visible = await dc(page, () => window.__dc.visibleRackIds());
    expect(visible.length).toBe(own.size);
    for (const id of visible) expect(own.has(id), id).toBe(true);
    for (const f of data.floors) {
      if (f.id === '2F') continue;
      expect(await dc(page, (id) => window.__dc.floorOpacity(id), f.id)).toBe(0);
      expect(await dc(page, (id) => window.__dc.floorVisible(id), f.id)).toBe(false);
    }
  });

  test('AC20: reload restores server state; goBack → previous; invalid rack → floor ancestor', async ({ page }) => {
    const rack = interiorRack(1);
    const s = rack.servers[1];
    await boot(page);
    await dc(page, () => window.__dc.navigate({ floor: '2F' }));
    await reach(page, { floor: '2F' });
    await dc(page, (id) => window.__dc.navigate({ rack: id }), rack.id);
    await reach(page, { floor: '2F', rack: rack.id });
    await page.locator(`#elevation [data-server-id="${s.id}"]`).click();
    await reach(page, { floor: '2F', rack: rack.id, server: s.id });

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    expect(await state(page)).toEqual({ dc: FIRST_DC, floor: '2F', rack: rack.id, server: s.id });
    await expectPanel(page, s.id);
    await expectSlid(page, s.id);

    await page.goBack();
    await reach(page, { floor: '2F', rack: rack.id });
    await expectSlid(page, null);
    await page.goBack();
    await reach(page, { floor: '2F' });

    await page.goto(`/?debug=1${hashOf({ floor: '2F', rack: 'NOPE' })}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    expect(await state(page)).toEqual({ dc: FIRST_DC, floor: '2F', rack: null, server: null });
    expect(await page.evaluate(() => location.hash)).toBe(hashOf({ floor: '2F' }));
  });
});
