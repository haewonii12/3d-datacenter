import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc, state, trackErrors, dcHash } from './helpers.js';

const MAP = { dc: null, floor: null, rack: null, server: null };

/** Uploads examples/violations.csv (known rule violations, see examples/README.md) and opens 가산IDC 1F. */
async function loadViolations(page) {
  await boot(page);
  await page.locator('#file-input').setInputFiles({ name: 'violations.csv', mimeType: 'text/csv', buffer: readFileSync('examples/violations.csv') });
  await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
  await expect.poll(() => state(page)).toEqual(MAP); // an upload resets to the map
  await page.evaluate(() => window.__dc.navigate({ dc: '가산IDC', floor: '1F' }));
  await expect.poll(() => state(page)).toMatchObject({ dc: '가산IDC', floor: '1F' });
  await settled(page);
}

const openRack = async (page, id) => {
  await page.evaluate((r) => window.__dc.navigate({ rack: r }), id);
  await expect.poll(() => state(page)).toMatchObject({ rack: id });
  await settled(page);
};

test.describe('mount rules and violations', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('warnings are grouped by kind; every rule violation is listed', async ({ page }) => {
    await loadViolations(page);
    await page.locator('#warnings').click();
    const count = (k) => page.locator(`#warnings-list li[data-kind="${k}"]:not(.warn-group)`);
    await expect(count('mount-overlap')).toHaveCount(3); // same 1U, containment, 2U overlap
    await expect(count('rack-cell-conflict')).toHaveCount(1);
    await expect(count('rack-noncontiguous')).toHaveCount(1);
    await expect(count('position-invalid')).toHaveCount(2);
    await expect(count('unknown-build')).toHaveCount(1);
    await expect(page.locator('#warnings')).toHaveText('⚠ 8');
    await expect(page.locator('#warnings-list .warn-group').first()).toHaveText('장비 겹침 (3)');
  });

  test('violating racks get red edges; both racks of a cell conflict are kept and flagged', async ({ page }) => {
    await loadViolations(page);
    const red = await dc(page, () => window.__dc.violationRackIds().sort());
    expect(red).toEqual(['RV-CELL-A', 'RV-CELL-B', 'RV-CONTAIN', 'RV-GAP', 'RV-OVERLAP', 'RV-SAME']);
    expect(await dc(page, () => window.__dc.visibleRackIds())).toEqual(expect.arrayContaining(['RV-CELL-A', 'RV-CELL-B']));
  });

  test('AC17: 3U (29-31) + 2U (31-32) share U31 as halves (no violation); the overlapping pair is red', async ({ page }) => {
    await loadViolations(page);
    await openRack(page, 'RV-OVERLAP');
    const devs = await dc(page, () => window.__dc.data().datacenters[0].floors[0].racks.find((r) => r.id === 'RV-OVERLAP').servers.map((s) => [s.device_name, s.id]));
    const id = Object.fromEntries(devs);
    const ok = page.locator(`.elev-server[data-server-id="${id['boundary-ok-a']}"]`);
    const ok2 = page.locator(`.elev-server[data-server-id="${id['boundary-ok-b']}"]`);
    await expect(ok).toHaveClass(/shared/);
    await expect(ok2).toHaveClass(/shared/);
    await expect(ok).not.toHaveClass(/invalid/);
    await expect(page.locator(`.elev-server[data-server-id="${id['overlap-a']}"]`)).toHaveClass(/invalid/);
    // elevation: the lower block ends where the upper one starts (U31 split in two)
    const a = await ok.boundingBox();
    const b = await ok2.boundingBox();
    expect(Math.abs(a.y - (b.y + b.height))).toBeLessThan(3);
    // 3D: the two meshes touch at the middle of U31 without overlapping
    const ys = await dc(page, (ids) => {
      const m = window.__dc.serverMeshes();
      return ids.map((x) => m.find((d) => d.id === x).worldPos.y);
    }, [id['boundary-ok-a'], id['boundary-ok-b']]);
    expect(ys[1]).toBeGreaterThan(ys[0]);
  });

  test('AC18: two 1U devices on the same U are both red, with the reason in the device panel', async ({ page }) => {
    await loadViolations(page);
    await openRack(page, 'RV-SAME');
    await expect(page.locator('.elev-server.invalid')).toHaveCount(2);
    await page.locator('.elev-server').first().click();
    await expect.poll(() => state(page)).toMatchObject({ rack: 'RV-SAME' });
    await settled(page);
    await expect(page.locator('#server-detail [data-k=violations] li')).toHaveCount(1);
    await expect(page.locator('#server-detail [data-k=violations]')).toContainText('겹칩니다');
  });

  test('AC20: unparsable positions are not drawn but listed under 위치 오류', async ({ page }) => {
    await loadViolations(page);
    await openRack(page, 'RV-BADPOS');
    await expect(page.locator('.elev-server')).toHaveCount(0);
    await expect(page.locator('.elev-bad li')).toHaveCount(2);
    await expect(page.locator('.elev-bad-title')).toHaveText('위치 오류 (2)');
    expect(await dc(page, () => window.__dc.serverMeshes().length)).toBe(0);
  });

  test('devices fill the rack width when nothing overlaps (one lane), in 3D and in the elevation', async ({ page }) => {
    await boot(page, `${dcHash()}&floor=3F`);
    const id = await dc(page, () => window.__dc.data().datacenters[0].floors.find((x) => x.id === '3F').racks.find((r) => r.servers.length > 3).id);
    await openRack(page, id);
    const fp = await dc(page, (r) => window.__dc.rackFootprint(r), id);
    const widths = await dc(page, () => window.__dc.serverMeshes().map((m) => m.width));
    expect(widths.length).toBeGreaterThan(3);
    for (const w of widths) expect(w).toBeGreaterThan(fp.w * 0.8);
    await expect(page.locator('.elev-server[data-lane]')).toHaveCount(0);
    const grid = await page.locator('.elev-grid').boundingBox();
    const block = await page.locator('.elev-server').first().boundingBox();
    expect(block.width).toBeGreaterThan((grid.width - 38) * 0.9);
  });

  test('AC13: a 2-cell rack is twice as wide and picking anywhere on it selects it', async ({ page }) => {
    await boot(page, `${dcHash()}&floor=3F`);
    const { id, fp } = await dc(page, () => {
      const f = window.__dc.data().datacenters[0].floors.find((x) => x.id === '3F');
      const r = f.racks.find((x) => x.floorspaces.length === 2);
      return { id: r.id, fp: window.__dc.rackFootprint(r.id) };
    });
    const one = await dc(page, () => {
      const f = window.__dc.data().datacenters[0].floors.find((x) => x.id === '3F');
      return window.__dc.rackFootprint(f.racks.find((x) => x.floorspaces.length === 1).id);
    });
    expect(fp.w).toBeGreaterThan(one.w * 1.9);
    // points over each of its two cells pick the same rack
    for (const dx of [-0.35, 0.35]) {
      const p = await dc(page, ({ id, dx }) => {
        const c = window.__dc.rackCenter(id);
        return window.__dc.toScreen({ x: c.x + dx, y: c.y + 0.9, z: c.z });
      }, { id, dx });
      expect(await dc(page, ({ x, y }) => window.__dc.pickAt(x, y), p)).toEqual({ kind: 'rack', id });
    }
  });

  test('warning click navigates to the offending device', async ({ page }) => {
    await loadViolations(page);
    await page.locator('#warnings').click();
    await page.locator('#warnings-list li.pickable[data-kind=mount-overlap]').first().click();
    await expect.poll(() => state(page)).toMatchObject({ dc: '가산IDC', rack: 'RV-SAME' });
    await settled(page);
    expect((await state(page)).server).not.toBeNull();
  });
});
