import { test, expect } from '@playwright/test';
import { boot, dc, state, reach, loadSample, FIRST_DC, trackErrors } from './helpers.js';

// These specs exercise the first DC (the default view); multi-DC behaviour lives in datacenter.spec.js.
const data = loadSample().datacenters.find((d) => d.id === FIRST_DC);
const serverHash = (id) => `#dc=${encodeURIComponent(FIRST_DC)}&server=${encodeURIComponent(id)}`;

/** serverId → {floorId, rackId, rack, server}, from the dataset itself. */
const where = new Map();
for (const f of data.floors) for (const r of f.racks) for (const s of r.servers) where.set(s.id, { floorId: f.id, rackId: r.id, rack: r, server: s });

/** A well-filled device on a non-2F floor (so search must move across floors). */
const target = (() => {
  const f = data.floors.find((x) => x.id === '3F');
  const rack = f.racks.find((r) => r.servers.length >= 6 && r.row > 1 && r.row < f.rows);
  return { floorId: f.id, rack, server: rack.servers[2] };
})();
/** A company that is not a substring of any device or rack name → only `company`-type results. */
const company = (() => {
  const names = [...where.values()].map((e) => e.server.device_name.toLowerCase());
  return [...where.values()].map((e) => e.server.company).find((c) => c && !names.some((n) => n.includes(c.toLowerCase())));
})();

/** AC16 / AC4 / AC8: server state, other floors hidden, camera at the rack preset. */
async function expectAtServer(page, serverId) {
  const { floorId, rackId } = where.get(serverId);
  await reach(page, { floor: floorId, rack: rackId, server: serverId });
  const own = new Set(data.floors.find((f) => f.id === floorId).racks.map((r) => r.id));
  const visible = await dc(page, () => window.__dc.visibleRackIds());
  expect(visible.length).toBeGreaterThan(0);
  for (const id of visible) expect(own.has(id), id).toBe(true);
  for (const f of data.floors) {
    if (f.id === floorId) continue;
    expect(await dc(page, (id) => window.__dc.floorOpacity(id), f.id)).toBe(0);
    expect(await dc(page, (id) => window.__dc.floorVisible(id), f.id)).toBe(false);
  }
  const c = await dc(page, (id) => window.__dc.rackCenter(id), rackId);
  const n = await dc(page, (id) => window.__dc.frontNormal(id), rackId);
  const cam = await dc(page, () => window.__dc.camera());
  const want = { x: c.x + n.x * 3.5, y: c.y + n.y * 3.5 + 0.3, z: c.z + n.z * 3.5 };
  expect(Math.hypot(cam.target.x - c.x, cam.target.y - c.y, cam.target.z - c.z)).toBeLessThan(0.01);
  expect(Math.hypot(cam.position.x - want.x, cam.position.y - want.y, cam.position.z - want.z)).toBeLessThan(0.1);
  await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText(where.get(serverId).server.device_name);
}

test.describe('search', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('AC15: partial device_name → ≤20 device results containing it; broad query capped at 20', async ({ page }) => {
    await boot(page);
    const list = page.locator('#search-results');
    await expect(list).toBeHidden();
    const partial = target.server.device_name.slice(0, -1); // e.g. "web-gs-0123" → …01230…01239
    await page.locator('#search').fill(partial);
    const items = list.locator('.result');
    await expect(list).toBeVisible();
    await expect.poll(() => items.count()).toBeGreaterThan(0);
    const n = await items.count();
    expect(n).toBeLessThanOrEqual(20);
    for (let i = 0; i < n; i++) {
      await expect(items.nth(i)).toHaveAttribute('data-type', 'device');
      await expect(items.nth(i).locator('.label')).toContainText(partial);
      await expect(items.nth(i).locator('.tag')).toHaveText('장비');
    }
    await expect(items.first()).toHaveClass(/active/);
    // sub = `rack · cells` of the device's own rack (no DC suffix inside the current DC)
    const id = await items.first().getAttribute('data-server-id');
    await expect(items.first().locator('.sub')).toHaveText(`${where.get(id).rack.name} · ${where.get(id).rack.floorspaces.join(',')}`);

    // Broad query is capped at 20.
    await page.locator('#search').fill('web');
    await expect.poll(() => items.count()).toBe(20);

    await page.locator('#search').fill('zz-no-such-device');
    await expect(list.locator('.no-result')).toHaveText('결과 없음');
    await expect(items).toHaveCount(0);

    await page.locator('#search').fill('');
    await expect(list).toBeHidden();
  });

  test('AC15: company name → company results (회사 tag, sub = device · rack); rack name → rack result', async ({ page }) => {
    expect(company).toBeTruthy();
    await boot(page);
    const items = page.locator('#search-results .result');
    await page.locator('#search').fill(company);
    await expect(items.first()).toHaveAttribute('data-type', 'company');
    const m = await items.count();
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(20);
    for (let i = 0; i < m; i++) {
      await expect(items.nth(i)).toHaveAttribute('data-type', 'company');
      await expect(items.nth(i).locator('.label')).toHaveText(company);
      await expect(items.nth(i).locator('.tag')).toHaveText('회사');
      const e = where.get(await items.nth(i).getAttribute('data-server-id'));
      expect(e.server.company).toBe(company);
      await expect(items.nth(i).locator('.sub')).toContainText(`${e.server.device_name} · ${e.rack.name}`);
    }

    const rack = target.rack;
    await page.locator('#search').fill(rack.name);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute('data-type', 'rack');
    await expect(items.first()).toHaveAttribute('data-rack-id', rack.id);
    await expect(items.first().locator('.label')).toHaveText(rack.name);
    await expect(items.first().locator('.tag')).toHaveText('랙');
    await expect(items.first().locator('.sub')).toHaveText(rack.floorspaces.join(','));
  });

  test('rack result + Enter → opens the rack (no device selected)', async ({ page }) => {
    await boot(page);
    const rack = target.rack;
    await page.locator('#search').fill(rack.name);
    await expect(page.locator('#search-results .result.active')).toHaveAttribute('data-type', 'rack');
    await page.keyboard.press('Enter');
    await reach(page, { floor: target.floorId, rack: rack.id });
    expect(await dc(page, () => window.__dc.mode())).toBe('rack');
    expect(await dc(page, () => window.__dc.selectedRackId())).toBe(rack.id);
    await expect(page.locator('#elevation h2')).toContainText(rack.name);
    await expect(page.locator('#server-detail')).toBeHidden();
  });

  test('AC16/AC4/AC8: from overview, device_name + Enter → device, other floors hidden, camera at rack preset', async ({ page }) => {
    await boot(page);
    expect(await dc(page, () => window.__dc.mode())).toBe('overview');
    await page.locator('#search').fill(target.server.device_name);
    await expect(page.locator('#search-results .result.active')).toHaveAttribute('data-server-id', target.server.id);
    await page.keyboard.press('Enter');
    await expectAtServer(page, target.server.id);
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#search-results')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#search'))).toBe(false);
  });

  test('AC16: company name → click a (non-first) result → that device, camera at rack preset', async ({ page }) => {
    await boot(page, `#dc=${encodeURIComponent(FIRST_DC)}&floor=2F`);
    await page.locator('#search').fill(company);
    const items = page.locator('#search-results .result');
    await expect.poll(() => items.count()).toBeGreaterThan(3);
    const pick = items.nth(3);
    const id = await pick.getAttribute('data-server-id');
    expect(where.get(id).server.company).toBe(company);
    await pick.click();
    await expectAtServer(page, id);
    await expect(page.locator('#search-results')).toBeHidden();
  });

  test('ESC in search clears the input, closes the list and keeps the view state', async ({ page }) => {
    await boot(page, serverHash(target.server.id));
    const before = await state(page);
    expect(before.server).toBe(target.server.id);
    await page.locator('#search').fill('web');
    await expect(page.locator('#search-results')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#search-results')).toBeHidden();
    await page.waitForTimeout(300);
    expect(await state(page)).toEqual(before);
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#search'))).toBe(false);
  });

  test('↑/↓ moves the active item (wraps); outside click closes', async ({ page }) => {
    await boot(page);
    await page.locator('#search').fill('web');
    const items = page.locator('#search-results .result');
    await expect.poll(() => items.count()).toBe(20);
    const activeIndex = () => page.evaluate(() => [...document.querySelectorAll('#search-results .result')].findIndex((e) => e.classList.contains('active')));
    expect(await activeIndex()).toBe(0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await activeIndex()).toBe(2);
    await page.keyboard.press('ArrowUp');
    expect(await activeIndex()).toBe(1);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await activeIndex()).toBe(19);
    await expect(page.locator('#search-results .result.active')).toHaveCount(1);

    // Enter picks the highlighted (not the first) item.
    await page.keyboard.press('ArrowUp');
    const id = await page.locator('#search-results .result.active').getAttribute('data-server-id');
    expect(await activeIndex()).toBe(18);
    await page.keyboard.press('Enter');
    await expectAtServer(page, id);

    // Outside click closes the dropdown.
    await page.locator('#search').fill('db');
    await expect(page.locator('#search-results')).toBeVisible();
    await page.locator('#breadcrumb').click({ position: { x: 600, y: 10 } });
    await expect(page.locator('#search-results')).toBeHidden();
  });
});
