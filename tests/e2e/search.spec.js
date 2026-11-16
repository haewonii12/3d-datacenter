import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc, state, reach } from './helpers.js';
import { normalize } from '../../src/data/schema.js';

const file = JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8'));
// These specs exercise the first DC (the default view); multi-DC behaviour lives in datacenter.spec.js.
const raw = file.datacenters[0];
const data = normalize(file).datacenters[0];

/** serverId → {floorId, rackId, server}, from the JSON file itself. */
const where = new Map();
for (const f of raw.floors)
  for (const r of f.racks) for (const s of r.servers || []) where.set(s.id, { floorId: f.id, rackId: r.id, server: s });
const allHostnames = [...where.values()].map((e) => e.server.hostname.toLowerCase());

/** A well-filled server on a non-2F floor (so search must move across floors). */
const target = (() => {
  const f = data.floors.find((x) => x.id === '3F');
  const rack = f.racks.find((r) => r.servers.length >= 6 && r.row > 1 && r.row < f.rows);
  return { floorId: f.id, rackId: rack.id, server: rack.servers[2] };
})();
/** A service name that is not a substring of any hostname → only `service`-type results. */
const serviceName = [...new Set(raw.floors.flatMap((f) => f.racks.flatMap((r) => r.servers.flatMap((s) => s.services.map((v) => v.name)))))]
  .find((n) => !allHostnames.some((h) => h.includes(n.toLowerCase())));


/** AC16 / AC4 / AC8: server state, other floors hidden, camera at the rack preset. */
async function expectAtServer(page, serverId) {
  const { floorId, rackId } = where.get(serverId);
  await reach(page, { floor: floorId, rack: rackId, server: serverId });
  const own = new Set(raw.floors.find((f) => f.id === floorId).racks.map((r) => r.id));
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
  await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText(where.get(serverId).server.hostname);
}

test.describe('search', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('AC15: partial hostname → ≤20 hostname results containing it; service name → service results', async ({ page }) => {
    await boot(page);
    const list = page.locator('#search-results');
    await expect(list).toBeHidden();
    const partial = target.server.hostname.slice(0, -1); // e.g. "web-012" → web-0120…web-0129
    await page.locator('#search').fill(partial);
    const items = list.locator('.result');
    await expect(list).toBeVisible();
    await expect.poll(() => items.count()).toBeGreaterThan(0);
    const n = await items.count();
    expect(n).toBeLessThanOrEqual(20);
    for (let i = 0; i < n; i++) {
      await expect(items.nth(i)).toHaveAttribute('data-type', 'hostname');
      await expect(items.nth(i).locator('.label')).toContainText(partial);
      await expect(items.nth(i).locator('.tag')).toHaveText('호스트');
    }
    await expect(items.first()).toHaveClass(/active/);

    // Broad query is capped at 20.
    await page.locator('#search').fill('web');
    await expect.poll(() => items.count()).toBe(20);

    expect(serviceName).toBeTruthy();
    await page.locator('#search').fill(serviceName.toUpperCase());
    await expect(items.first()).toHaveAttribute('data-type', 'service');
    const m = await items.count();
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(20);
    for (let i = 0; i < m; i++) {
      await expect(items.nth(i)).toHaveAttribute('data-type', 'service');
      await expect(items.nth(i).locator('.label')).toHaveText(serviceName);
      await expect(items.nth(i).locator('.tag')).toHaveText('서비스');
      // sub = hostname of a server that really runs the service
      const id = await items.nth(i).getAttribute('data-server-id');
      const { server } = where.get(id);
      await expect(items.nth(i).locator('.sub')).toHaveText(server.hostname);
      expect(server.services.map((s) => s.name)).toContain(serviceName);
    }

    await page.locator('#search').fill('zz-no-such-host');
    await expect(list.locator('.no-result')).toHaveText('결과 없음');
    await expect(items).toHaveCount(0);

    await page.locator('#search').fill('');
    await expect(list).toBeHidden();
  });

  test('AC16/AC4/AC8: from overview, hostname + Enter → server, other floors hidden, camera at rack preset', async ({ page }) => {
    await boot(page);
    expect(await dc(page, () => window.__dc.mode())).toBe('overview');
    await page.locator('#search').fill(target.server.hostname);
    await expect(page.locator('#search-results .result.active')).toHaveAttribute('data-server-id', target.server.id);
    await page.keyboard.press('Enter');
    await expectAtServer(page, target.server.id);
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#search-results')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#search'))).toBe(false);
  });

  test('AC16: service name → click a (non-first) result → that server, camera at rack preset', async ({ page }) => {
    await boot(page, '#floor=2F');
    await page.locator('#search').fill(serviceName);
    const items = page.locator('#search-results .result');
    await expect.poll(() => items.count()).toBeGreaterThan(3);
    const pick = items.nth(3);
    const id = await pick.getAttribute('data-server-id');
    expect(where.get(id).server.services.map((s) => s.name)).toContain(serviceName);
    await pick.click();
    await expectAtServer(page, id);
    await expect(page.locator('#search-results')).toBeHidden();
  });

  test('ESC in search clears the input, closes the list and keeps the view state', async ({ page }) => {
    await boot(page, `#server=${encodeURIComponent(target.server.id)}`);
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
