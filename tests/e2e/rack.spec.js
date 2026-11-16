import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc } from './helpers.js';
import { normalize } from '../../src/data/schema.js';
import { usedU, occupancy, colorFor } from '../../src/domain/occupancy.js';
import { RACK, gridToWorld, floorY, unitToY, frontNormal, rackLabel } from '../../src/domain/layout.js';

const file = JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8'));
// These specs exercise the first DC (the default view); multi-DC behaviour lives in datacenter.spec.js.
const raw = file.datacenters[0];
const data = normalize(file).datacenters[0];
// Floors bottom-to-top by level (same order the scene stacks them).
const floorIndex = new Map(
  data.floors
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.level ?? a.i) - (b.f.level ?? b.i) || a.i - b.i)
    .map(({ f }, idx) => [f.id, idx]),
);
const allRacks = data.floors.flatMap((f) => f.racks.map((rack) => ({ rack, floor: f })));
const byId = new Map(allRacks.map((e) => [e.rack.id, e]));

/** Expected world center of a rack, from data + layout constants (independent of the scene). */
function center(rackId) {
  const { rack, floor } = byId.get(rackId);
  const { x, z } = gridToWorld(floor, rack.row, rack.col);
  return { x, y: floorY(floorIndex.get(floor.id)) + RACK.h / 2, z };
}
const bottomY = (rackId) => center(rackId).y - RACK.h / 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);


/** Well-filled racks near the middle columns of a floor with the requested row parity, best first. */
function rackCandidates(floorId, parity) {
  const f = data.floors.find((x) => x.id === floorId);
  const mid = (f.cols + 1) / 2;
  return f.racks
    .filter((r) => r.row % 2 === parity && r.servers.length >= 6)
    .sort((a, b) => Math.abs(a.col - mid) - Math.abs(b.col - mid) || b.row - a.row);
}
const pickRack = (floorId, parity) => rackCandidates(floorId, parity)[0];

/** First candidate whose screen center is not occluded by another rack in the current view. */
async function unoccluded(page, racks) {
  const ids = racks.map((r) => r.id);
  const id = await page.evaluate(
    (list) =>
      list.find((rid) => {
        const p = window.__dc.rackScreenPos(rid);
        const h = p && window.__dc.pickAt(p.x, p.y);
        return h && h.kind === 'rack' && h.id === rid;
      }),
    ids,
  );
  expect(id, 'an unoccluded rack').toBeTruthy();
  return byId.get(id).rack;
}

/** Hovers a rack at its screen pos and checks the tooltip names it (proves it is the picked rack). */
async function hoverRack(page, rackId) {
  const pos = await dc(page, (id) => window.__dc.rackScreenPos(id), rackId);
  expect(pos).toBeTruthy();
  await page.mouse.move(pos.x, pos.y);
  const { rack, floor } = byId.get(rackId);
  await expect(page.locator('#tooltip')).toBeVisible();
  await expect(page.locator('#tooltip')).toContainText(`${rackLabel(rack)} · ${floor.id}`);
  return pos;
}

/** Scans screen points for one whose pick satisfies `ok`. */
async function findPoint(page, ok) {
  const pts = [];
  for (let y = 70; y <= 880; y += 45) for (let x = 20; x <= 1020; x += 50) pts.push({ x, y });
  const hits = await dc(page, (ps) => ps.map((p) => window.__dc.pickAt(p.x, p.y)), pts);
  const i = hits.findIndex(ok);
  return i < 0 ? null : pts[i];
}

test.describe('rack mode', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('AC19: overview rack click → rack mode, same id', async ({ page }) => {
    await boot(page);
    // Top floor, front-most row, right-most column (closest to the overview camera).
    const top = [...floorIndex].sort((a, b) => b[1] - a[1])[0][0];
    const f = data.floors.find((x) => x.id === top);
    const rack = [...f.racks].sort((a, b) => b.row - a.row || b.col - a.col)[0];
    const pos = await hoverRack(page, rack.id);
    await page.mouse.click(pos.x, pos.y);
    await expect.poll(() => dc(page, () => window.__dc.mode())).toBe('rack');
    await settled(page);
    expect(await dc(page, () => window.__dc.state())).toEqual({ dc: 'seoul-1', floor: top, rack: rack.id, server: null });
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#tooltip')).toBeHidden();
  });

  for (const parity of [1, 0]) {
    test(`AC8/AC9/AC7: click ${parity ? 'odd' : 'even'}-row rack in floor mode → smooth camera, framed, servers placed`, async ({ page }) => {
      await boot(page, '#floor=2F');
      const rack = await unoccluded(page, rackCandidates('2F', parity));
      // AC7 tooltip: label + percent
      const pos = await hoverRack(page, rack.id);
      const pct = `${Math.round((usedU(rack) / rack.total_u) * 100)}%`;
      await expect(page.locator('#tooltip')).toHaveText(
        `${rackLabel(rack)} · 2F · ${usedU(rack)}/${rack.total_u}U (${pct})`,
      );

      const start = await dc(page, () => window.__dc.camera());
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(150);
      const mid = await dc(page, () => window.__dc.camera());
      await settled(page);
      const end = await dc(page, () => window.__dc.camera());
      expect(dist(mid.position, start.position)).toBeGreaterThan(0.01);
      expect(dist(mid.position, end.position)).toBeGreaterThan(0.01);

      expect(await dc(page, () => window.__dc.state())).toEqual({ dc: 'seoul-1', floor: '2F', rack: rack.id, server: null });
      const c = center(rack.id);
      const n = frontNormal(rack.row);
      expect(dist(end.target, c)).toBeLessThan(0.01);
      expect(dist(end.position, { x: c.x + n.x * 3.5, y: c.y + 0.3, z: c.z + n.z * 3.5 })).toBeLessThan(0.1);
      expect(await dc(page, (id) => window.__dc.frontNormal(id), rack.id)).toEqual(n);
      expect(dist(await dc(page, (id) => window.__dc.rackCenter(id), rack.id), c)).toBeLessThan(1e-6);

      // AC9: one mesh per server at rack bottom + unitToY
      const meshes = await dc(page, () => window.__dc.serverMeshes());
      expect(meshes.length).toBe(rack.servers.length);
      const want = new Map(rack.servers.map((s) => [s.id, s]));
      for (const m of meshes) {
        const s = want.get(m.id);
        expect(s, m.id).toBeTruthy();
        expect(Math.abs(m.worldPos.y - (bottomY(rack.id) + unitToY(s.unit, s.height_u)))).toBeLessThan(0.001);
        expect(m.offsetAlongNormal).toBe(0);
      }
      // Selected instance is pulled out, floor racks faded.
      expect(await dc(page, () => window.__dc.visibleRackIds())).not.toContain(rack.id);
      expect(await dc(page, () => window.__dc.floorOpacity('2F'))).toBeCloseTo(0.15, 5);

      // AC7 (rack mode): hovering a server shows hostname · U-range
      const s = rack.servers.find((x) => x.height_u >= 2) ?? rack.servers[0];
      const sp = await dc(page, (id) => window.__dc.serverScreenPos(id), s.id);
      expect(await dc(page, (p) => window.__dc.pickAt(p.x, p.y), sp)).toEqual({ kind: 'server', id: s.id });
      await page.mouse.move(sp.x, sp.y);
      await expect(page.locator('#tooltip')).toBeVisible();
      await expect(page.locator('#tooltip')).toContainText(s.hostname);
    });
  }

  test('AC10/AC3: elevation rows U42→U1, empty rows, height_u-less server spans 1 row, click selects', async ({ page }) => {
    // Raw JSON: a server with no height_u.
    let target = null;
    for (const f of raw.floors)
      for (const r of f.racks)
        for (const s of r.servers || []) if (!target && s.height_u == null) target = { rackId: r.id, serverId: s.id };
    expect(target).toBeTruthy();
    const rack = byId.get(target.rackId).rack;
    await boot(page, `#rack=${encodeURIComponent(rack.id)}`);
    const panel = page.locator('#panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(rackLabel(rack));
    await expect(panel.locator('[data-k=usage]')).toHaveText(
      `${usedU(rack)}/42U (${Math.round((usedU(rack) / 42) * 100)}%)`,
    );
    const us = await panel.locator('[data-u]').evaluateAll((els) => els.map((e) => [e.dataset.u, e.textContent.trim()]));
    expect(us.map((u) => Number(u[0]))).toEqual(Array.from({ length: 42 }, (_, i) => 42 - i));
    expect(us.map((u) => u[1])).toEqual(Array.from({ length: 42 }, (_, i) => `U${42 - i}`));

    const occ = new Set();
    for (const s of rack.servers) for (let u = s.unit; u < s.unit + s.height_u; u++) occ.add(u);
    const empties = await panel.locator('[data-u].empty').evaluateAll((els) => els.map((e) => Number(e.dataset.u)));
    expect(empties.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 42 }, (_, i) => i + 1).filter((u) => !occ.has(u)),
    );

    const block = panel.locator(`[data-server-id="${target.serverId}"]`);
    await expect(block).toBeVisible();
    const server = rack.servers.find((s) => s.id === target.serverId);
    await expect(block).toContainText(server.hostname);
    const bb = await block.boundingBox();
    const rowBox = await panel.locator(`[data-u="${server.unit}"]`).boundingBox();
    expect(bb.height).toBeLessThanOrEqual(rowBox.height + 0.5);
    expect(bb.y).toBeGreaterThanOrEqual(rowBox.y - 0.5);
    expect(bb.y + bb.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5);
    // a multi-U block spans exactly its rows
    const multi = rack.servers.find((s) => s.height_u >= 2);
    if (multi) {
      const mb = await panel.locator(`[data-server-id="${multi.id}"]`).boundingBox();
      const topRow = await panel.locator(`[data-u="${multi.unit + multi.height_u - 1}"]`).boundingBox();
      const botRow = await panel.locator(`[data-u="${multi.unit}"]`).boundingBox();
      expect(mb.y).toBeGreaterThanOrEqual(topRow.y - 0.5);
      expect(mb.y + mb.height).toBeLessThanOrEqual(botRow.y + botRow.height + 0.5);
      expect(mb.height).toBeGreaterThan(topRow.height * (multi.height_u - 1));
    }

    await block.click();
    await expect.poll(() => dc(page, () => window.__dc.state())).toEqual({
      dc: 'seoul-1',
      floor: byId.get(rack.id).floor.id,
      rack: rack.id,
      server: target.serverId,
    });
    await expect(block).toHaveClass(/selected/);
  });

  test('AC10: empty rack shows 42 .empty rows and no meshes', async ({ page }) => {
    const empty = allRacks.find((e) => e.rack.servers.length === 0);
    expect(empty).toBeTruthy();
    await boot(page, `#rack=${encodeURIComponent(empty.rack.id)}`);
    await expect(page.locator('#panel [data-u]')).toHaveCount(42);
    await expect(page.locator('#panel [data-u].empty')).toHaveCount(42);
    await expect(page.locator('#panel [data-server-id]')).toHaveCount(0);
    expect(await dc(page, () => window.__dc.serverMeshes())).toEqual([]);
  });

  // US-005 fix: racks on the camera side of the selected rack (the facing row the aisle camera sits
  // behind) are zero-scaled and unpickable in rack mode, so AC21 now switches to a same-row neighbour.
  test('AC21: click a faded same-row neighbour → switches rack, rebuilds meshes, restores old instance', async ({ page }) => {
    const rack = pickRack('2F', 1);
    await boot(page, '#floor=2F');
    await dc(page, (id) => window.__dc.navigate({ rack: id }), rack.id);
    await expect.poll(() => dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await settled(page);
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    const sel = await dc(page, (id) => window.__dc.rackScreenPos(id), rack.id);
    // A point well away from the selected rack's screen bounds that picks a (faded) rack of the same row.
    const pt = await findPoint(page, (h) => h && h.kind === 'rack' && byId.get(h.id).rack.row === rack.row);
    expect(pt, 'a faded same-row rack is pickable').toBeTruthy();
    expect(Math.abs(pt.x - sel.x)).toBeGreaterThan(120);
    const expected = await dc(page, (p) => window.__dc.pickAt(p.x, p.y), pt);
    expect(expected.id).not.toBe(rack.id);
    await page.mouse.click(pt.x, pt.y);
    await expect.poll(() => dc(page, () => window.__dc.state().rack)).not.toBe(rack.id);
    await settled(page);
    const st = await dc(page, () => window.__dc.state());
    expect(st.rack).toBe(expected.id);
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(expected.id);
    const next = byId.get(expected.id).rack;
    const ids = (await dc(page, () => window.__dc.serverMeshes())).map((m) => m.id).sort();
    expect(ids).toEqual(next.servers.map((s) => s.id).sort());
    // Old instance visible again (not pulled out) and keeps its occupancy color.
    const visible = await dc(page, () => window.__dc.visibleRackIds());
    expect(visible).toContain(rack.id);
    expect(visible).not.toContain(expected.id);
    await dc(page, () => window.__dc.navigate({ floor: '2F' }));
    await expect.poll(() => dc(page, () => window.__dc.mode())).toBe('floor');
    await settled(page);
    expect(await dc(page, () => window.__dc.floorOpacity('2F'))).toBe(1);
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(null);
    expect(await dc(page, () => window.__dc.serverMeshes())).toEqual([]);
    expect(await dc(page, () => window.__dc.culledRackIds())).toEqual([]);
    const all2F = data.floors.find((f) => f.id === '2F').racks.map((r) => r.id).sort();
    expect((await dc(page, () => window.__dc.visibleRackIds())).sort()).toEqual(all2F);
    expect(((await dc(page, (id) => window.__dc.rackInstanceColor(id), rack.id)) || '').toLowerCase()).toBe(
      colorFor(occupancy(rack)).toLowerCase(),
    );
    await expect(page.locator('#panel')).toBeHidden();
  });

  // US-005 fix: with the facing row culled, an ordinary interior rack has real empty space in the aisle
  // view (previously the facing row filled the whole screen; the old test needed an end-of-row rack).
  test('AC11: empty-U click and orbit drag keep state; empty-space click → floor (interior rack)', async ({ page }) => {
    const f2 = data.floors.find((f) => f.id === '2F');
    const rack = rackCandidates('2F', 1).find((r) => usedU(r) < 36 && r.col > 2 && r.col < f2.cols - 1);
    expect(rack).toBeTruthy();
    const used = (u) => rack.servers.some((s) => u >= s.unit && u < s.unit + s.height_u);
    const freeUnits = Array.from({ length: 42 }, (_, i) => i + 1).filter((u) => !used(u));
    expect(freeUnits.length).toBeGreaterThan(0);
    await boot(page, `#rack=${encodeURIComponent(rack.id)}`);
    const before = await dc(page, () => window.__dc.state());

    // Culled set = racks of the floor with (center − selected)·n > RACK.d/2, computed from data.
    const sc = center(rack.id);
    const n = frontNormal(rack.row);
    const facing = f2.racks.filter((r) => (center(r.id).z - sc.z) * n.z > RACK.d / 2).map((r) => r.id);
    expect(facing.length).toBeGreaterThan(0);
    expect((await dc(page, () => window.__dc.culledRackIds())).sort()).toEqual([...facing].sort());
    const visible = await dc(page, () => window.__dc.visibleRackIds());
    for (const id of facing) expect(visible).not.toContain(id);

    const up = await page.evaluate(
      ({ units, id }) => {
        for (const u of units) {
          const p = window.__dc.unitScreenPos(u);
          const h = p && window.__dc.pickAt(p.x, p.y);
          if (h && h.kind === 'selectedRack' && h.id === id) return p;
        }
        return null;
      },
      { units: freeUnits, id: rack.id },
    );
    expect(up, 'an empty U point on the selected rack').toBeTruthy();
    await page.mouse.click(up.x, up.y);
    await page.waitForTimeout(200);
    expect(await dc(page, () => window.__dc.state())).toEqual(before);

    // An aisle point that lies on the camera-facing face of the facing-row rack directly across
    // (so it hit that rack before the fix) and now picks nothing.
    const across = f2.racks.find((r) => r.col === rack.col && r.row === rack.row + 1);
    expect(across && facing.includes(across.id)).toBeTruthy();
    const ac = center(across.id);
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => ({ x: ac.x + (sx * RACK.w) / 2, y: ac.y + (sy * RACK.h) / 2, z: ac.z + (n.z * RACK.d) / 2 })),
    );
    const scr = await dc(page, (cs) => cs.map((c) => window.__dc.toScreen(c)), corners);
    expect(scr.every(Boolean)).toBe(true);
    const xs = scr.map((p) => p.x);
    const ys = scr.map((p) => p.y);
    const inside = (p) =>
      p.x > Math.min(...xs) + 10 && p.x < Math.max(...xs) - 10 && p.y > Math.min(...ys) + 10 && p.y < Math.max(...ys) - 10;
    const pts = [];
    for (let y = 70; y <= 880; y += 45) for (let x = 20; x <= 1020; x += 50) pts.push({ x, y });
    const inFace = pts.filter(inside);
    const hits = await dc(page, (ps) => ps.map((p) => window.__dc.pickAt(p.x, p.y)), inFace);
    const target = inFace[hits.findIndex((h) => !h)];
    expect(target, 'an aisle point on the culled facing-row face picks nothing').toBeTruthy();

    // Orbit drag starting on empty space must not count as a click.
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 50, target.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await dc(page, () => window.__dc.state())).toEqual(before);
    // Re-frame (the orbit moved the camera), then click the same aisle point → up() → floor.
    await dc(page, () => window.__dc.navigate({ floor: '2F' }));
    await expect.poll(() => dc(page, () => window.__dc.mode())).toBe('floor');
    await dc(page, (id) => window.__dc.navigate({ rack: id }), rack.id);
    await expect.poll(() => dc(page, () => window.__dc.mode())).toBe('rack');
    await settled(page);
    expect(await dc(page, (p) => window.__dc.pickAt(p.x, p.y), target)).toBe(null);
    await page.mouse.click(target.x, target.y);
    await expect.poll(() => dc(page, () => window.__dc.mode())).toBe('floor');
    await settled(page);
    expect(await dc(page, () => window.__dc.state())).toEqual({ dc: 'seoul-1', floor: before.floor, rack: null, server: null });
    expect(await dc(page, (id) => window.__dc.floorOpacity(id), before.floor)).toBe(1);
  });
});
