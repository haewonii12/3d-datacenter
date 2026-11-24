import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc, state, reach, loadSample, FIRST_DC, trackErrors } from './helpers.js';
import { normalize } from '../../src/data/schema.js';
import { parseDataset } from '../../src/data/load.js';
import { gridToWorld, floorY, rackLabel, rackCellsLabel } from '../../src/domain/layout.js';
import { emptySlots } from '../../src/domain/slots.js';
import { floorStats } from '../../src/domain/occupancy.js';
import { datasetToCsv } from '../../src/data/csv.js';

const data = loadSample();
const gs = data.datacenters.find((d) => d.id === FIRST_DC);
const at = (o = {}) => ({ dc: FIRST_DC, floor: null, rack: null, server: null, ...o });
const MAP = { dc: null, floor: null, rack: null, server: null };
const hashOf = (o = {}) =>
  `#dc=${encodeURIComponent(FIRST_DC)}${Object.entries(o).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`;
const counts = (d) => ({
  floors: d.floors.length,
  racks: d.floors.reduce((a, f) => a + f.racks.length, 0),
  devices: d.floors.reduce((a, f) => a + f.racks.reduce((b, r) => b + r.servers.length, 0), 0),
});
const meta = (d) => `층 ${counts(d).floors} · 랙 ${counts(d).racks} · 장비 ${counts(d).devices}`;

/** A rack of the first DC with ≥2 devices and free U above its last device; no invalid devices. */
function pickRack() {
  for (const floor of gs.floors)
    for (const rack of floor.racks) {
      const top = Math.max(...rack.servers.map((s) => s.unit + s.height_u - 1));
      if (rack.servers.length >= 2 && top <= 38 && !rack.servers.some((s) => s.invalid))
        return { floor, rack, server: rack.servers[0], freeU: top + 1 };
    }
  throw new Error('no suitable rack');
}
const { floor: F, rack: R, server: S, freeU } = pickRack();

const rec = (build, cells, rack, pos = '', name = '', company = '테스트') => ({
  build_name: build,
  floorspace_name: cells,
  company,
  rack_name: rack,
  device_position: pos,
  device_name: name,
});
const tiny = (build = '업로드IDC') => [rec(build, '1A0101', 'R-A', '2U (1-2)', 'up-web-01'), rec(build, '1A0102', 'R-B')];
const upload = (page, name, body) =>
  page.locator('#file-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });

const editOn = async (page) => {
  await page.locator('#edit-toggle').click();
  await expect(page.locator('#editor')).toBeVisible();
};
const saved = (page) => expect(page.locator('#app')).toHaveAttribute('data-saved', 'ok');
const mapItems = (page) => page.locator('.map-item');

test.describe('upload + edit', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('upload a valid file → replaces every DC, resets to the map, survives reload; reset restores the original', async ({ page }) => {
    await boot(page, hashOf({ floor: F.id }));
    await page.locator('#file-input').setInputFiles('examples/upload-example.json');
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual(MAP);
    await settled(page);
    await expect(page.locator('#map-view')).toBeVisible();
    await expect(page.locator('#data-status')).toContainText('upload-example.json');
    const up = parseDataset(readFileSync('examples/upload-example.json', 'utf8'), 'x').data;
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(up.datacenters.map((d) => d.id));
    await expect(mapItems(page).first().locator('.meta')).toHaveText(meta(up.datacenters[0]));

    await page.locator(`.map-pin[data-dc="${FIRST_DC}"] .pin-dot`).click();
    await reach(page, at());
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(up.datacenters[0].floors.map((f) => f.id));
    expect((await dc(page, () => window.__dc.visibleRackIds())).sort()).toEqual(up.datacenters[0].floors.flatMap((f) => f.racks.map((r) => r.id)).sort());

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, at()); // the hash still names the DC
    await expect(page.locator('#data-status')).toContainText('upload-example.json');
    await page.locator('#breadcrumb [data-level=root]').click();
    await reach(page, { dc: null });
    await expect(mapItems(page).first().locator('.meta')).toHaveText(meta(up.datacenters[0]));

    page.once('dialog', (d) => d.accept());
    await page.locator('#data-menu-btn').click();
    await page.locator('#data-menu [data-action=reset]').click();
    await expect(page.locator('#app')).toHaveAttribute('data-saved', 'cleared');
    await expect.poll(() => state(page)).toEqual(MAP);
    await expect(mapItems(page).first().locator('.meta')).toHaveText(meta(gs));
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await settled(page);
    await expect(mapItems(page).first().locator('.meta')).toHaveText(meta(gs));
  });

  test('upload an invalid file → dismissible error, current data kept', async ({ page }) => {
    await boot(page);
    const before = await dc(page, () => window.__dc.revision());
    await upload(page, 'bad.json', '{"datacenters": [');
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'error');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error h2')).toContainText('bad.json');
    await expect(page.locator('#error .path')).toHaveText('bad.json');
    await upload(page, 'empty.json', '[]');
    await expect(page.locator('#error .path').first()).toHaveText('empty.json records');
    await expect(page.locator('#error')).toContainText('레코드가 없습니다');
    await page.locator('#error .error-close').click();
    await expect(page.locator('#error')).toBeHidden();
    expect(await dc(page, () => window.__dc.revision())).toBe(before);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(data.datacenters.map((d) => d.id));
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  });

  test('drag-and-drop a file onto the page loads it', async ({ page }) => {
    await boot(page);
    const dt = await page.evaluateHandle((json) => {
      const t = new DataTransfer();
      t.items.add(new File([json], 'dropped.json', { type: 'application/json' }));
      return t;
    }, JSON.stringify(tiny('드롭IDC')));
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await expect(page.locator('#drop-overlay')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    await expect(page.locator('#drop-overlay')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual(MAP);
    await expect(mapItems(page)).toHaveCount(1);
    await expect(mapItems(page).first().locator('.name')).toHaveText('드롭IDC');
  });

  test('edit a device: name, company, position; breadcrumb, panel, search and 3D follow; persists across reload', async ({ page }) => {
    const newPos = `1U (${freeU}-${freeU})`;
    await boot(page, hashOf({ server: S.id }));
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await editOn(page);
    await expect(page.locator('#server-detail')).toBeHidden();
    const form = page.locator('#editor form[data-form=server]');
    await expect(form.locator('[name=device_name]')).toHaveValue(S.device_name);
    await expect(form.locator('[name=company]')).toHaveValue(S.company);
    await expect(form.locator('[name=device_position]')).toHaveValue(S.device_position);

    await form.locator('[name=device_name]').fill('edited-dev-01');
    await form.locator('[name=company]').fill('새회사');
    await form.locator('[name=device_position]').fill(newPos);
    await form.locator('button[type=submit]').click();
    await saved(page);

    await expect(page.locator('#editor .edit-flash')).toHaveText('저장됨');
    await expect(page.locator('#breadcrumb .crumb.current')).toHaveText('edited-dev-01');
    await expect(page.locator(`.elev-server[data-server-id="${S.id}"] .host`)).toHaveText('edited-dev-01');
    await expect(page.locator(`.elev-server[data-server-id="${S.id}"] .units`)).toHaveText(`U${freeU}`);
    expect(await state(page)).toEqual(at({ floor: F.id, rack: R.id, server: S.id }));
    expect((await dc(page, () => window.__dc.serverMeshes())).length).toBe(R.servers.length);

    // read-only panel (edit mode off) shows the new values
    await page.locator('#edit-toggle').click();
    const d = page.locator('#server-detail');
    await expect(d.locator('[data-k=device_name]')).toHaveText('edited-dev-01');
    await expect(d.locator('[data-k=company]')).toHaveText('새회사');
    await expect(d.locator('[data-k=device_position]')).toHaveText(newPos);
    await expect(d.locator('[data-k=location]')).toHaveText(`${F.id} · ${rackCellsLabel(R)}-U${freeU}`);

    await page.locator('#search').fill('edited-dev');
    await expect(page.locator('#search-results .result')).toHaveCount(1);
    await expect(page.locator('#search-results .result .label')).toHaveText('edited-dev-01');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await expect(page.locator('#server-detail [data-k=device_name]')).toHaveText('edited-dev-01');
    await expect(page.locator('#data-status')).toHaveText('수정됨 · 브라우저에 저장');
  });

  test('an unparsable or out-of-range position is refused with the reason and changes nothing', async ({ page }) => {
    await boot(page, hashOf({ server: S.id }));
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await editOn(page);
    const rev = await dc(page, () => window.__dc.revision());
    const form = page.locator('#editor form[data-form=server]');
    await form.locator('[name=device_position]').fill('abc');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('장착 위치 형식이 아닙니다');
    await form.locator('[name=device_position]').fill('3U (41-43)');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('랙 범위(1–42)를 벗어납니다');
    await form.locator('[name=device_position]').fill('2U (5-5)');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('높이 2U가 범위');
    expect(await dc(page, () => window.__dc.revision())).toBe(rev);
    // ESC inside the form does not navigate up
    await form.locator('[name=device_name]').press('Escape');
    expect(await state(page)).toEqual(at({ floor: F.id, rack: R.id, server: S.id }));
  });

  test('a mount overlap is saved and reported as a warning (both devices flagged)', async ({ page }) => {
    const other = R.servers[1];
    await boot(page, hashOf({ server: S.id }));
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await expect(page.locator('#warnings')).toBeHidden();
    await editOn(page);
    const rev = await dc(page, () => window.__dc.revision());
    const form = page.locator('#editor form[data-form=server]');
    await form.locator('[name=device_position]').fill(other.device_position);
    await form.locator('button[type=submit]').click();
    await saved(page);
    await expect(page.locator('#editor .edit-flash')).toHaveText('저장됨');
    expect(await dc(page, () => window.__dc.revision())).toBeGreaterThan(rev);
    await expect(page.locator('#warnings')).toBeVisible();
    await expect(page.locator('#warnings')).toHaveText('⚠ 1');
    await expect(page.locator('#elevation .elev-server.invalid')).toHaveCount(2);
    expect(await dc(page, () => window.__dc.violationRackIds())).toEqual([R.id]);
    await page.locator('#warnings').click();
    await expect(page.locator('#warnings-list [data-kind=mount-overlap]').first()).toBeVisible();
  });

  test('add a device from an empty U in the elevation, then delete it', async ({ page }) => {
    await boot(page, hashOf({ rack: R.id }));
    await reach(page, at({ floor: F.id, rack: R.id }));
    await editOn(page);
    await page.locator(`#elevation .elev-row.empty[data-u="${freeU}"]`).click();
    const form = page.locator('#editor form[data-form=add-server]');
    await expect(form.locator('[name=device_position]')).toHaveValue(`1U (${freeU}-${freeU})`);
    await form.locator('[name=device_name]').fill('brand-new-01');
    await form.locator('[name=company]').fill('신규회사');
    await form.locator('[name=device_position]').fill(`2U (${freeU}-${freeU + 1})`);
    await form.locator('button[type=submit]').click();
    await saved(page);

    await expect.poll(async () => (await state(page)).server).not.toBe(null);
    await settled(page);
    const st = await state(page);
    expect(st).toMatchObject({ floor: F.id, rack: R.id });
    await expect(page.locator('#editor form[data-form=server] [name=device_name]')).toHaveValue('brand-new-01');
    await expect(page.locator('#editor .edit-flash')).toHaveText('장비 추가됨');
    await expect(page.locator(`.elev-server[data-server-id="${st.server}"] .units`)).toHaveText(`U${freeU}–${freeU + 1}`);
    expect((await dc(page, () => window.__dc.serverMeshes())).length).toBe(R.servers.length + 1);

    page.once('dialog', (d) => d.accept());
    await page.locator('#editor [data-action=delete-server]').click();
    await reach(page, at({ floor: F.id, rack: R.id }));
    await expect(page.locator(`.elev-server[data-server-id="${st.server}"]`)).toHaveCount(0);
    expect((await dc(page, () => window.__dc.serverMeshes())).length).toBe(R.servers.length);
  });

  test('delete a rack (confirm) → floor view without it; cancel keeps it; its cells can be re-added', async ({ page }) => {
    await boot(page, hashOf({ rack: R.id }));
    await reach(page, at({ floor: F.id, rack: R.id }));
    await editOn(page);
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#editor [data-action=delete-rack]').click();
    expect(await state(page)).toEqual(at({ floor: F.id, rack: R.id }));

    page.once('dialog', (d) => d.accept());
    await page.locator('#editor [data-action=delete-rack]').click();
    await reach(page, at({ floor: F.id }));
    await saved(page);
    expect(await dc(page, () => window.__dc.visibleRackIds())).not.toContain(R.id);
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText(String(F.racks.length - 1));
    // the freed cells are offered again: enter them and the old name
    const form = page.locator('#editor form[data-form=add-rack]');
    await form.locator('[name=floorspaces]').fill(R.floorspaces.join(','));
    await form.locator('[name=rack-name]').fill(R.name);
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#editor .edit-flash')).toContainText(`랙 추가됨: ${R.name}`);
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText(String(F.racks.length));
  });

  test('a taken cell is refused when adding a rack', async ({ page }) => {
    await boot(page, hashOf({ floor: F.id }));
    await reach(page, at({ floor: F.id }));
    await editOn(page);
    const rev = await dc(page, () => window.__dc.revision());
    const form = page.locator('#editor form[data-form=add-rack]');
    await form.locator('[name=floorspaces]').fill(R.floorspaces[0]);
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText(`칸 ${R.floorspaces[0]}에 이미 랙 ${R.id}이(가) 있습니다`);
    await form.locator('[name=floorspaces]').fill('nonsense');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('floorspace 형식이 아닙니다');
    expect(await dc(page, () => window.__dc.revision())).toBe(rev);
  });

  test('floor edit mode: the form offers the first empty cell; clicking an empty cell fills it, adding creates the rack in 3D', async ({ page }) => {
    await boot(page, hashOf({ floor: F.id }));
    await reach(page, at({ floor: F.id }));
    await editOn(page);
    const free = emptySlots(F);
    expect(free.length).toBeGreaterThan(1);
    const form = page.locator('#editor form[data-form=add-rack]');
    await expect(form.locator('[name=floorspaces]')).toHaveValue(free[0].floorspace);

    const level = gs.floors.indexOf(F);
    const pts = await dc(
      page,
      (cells) => cells.map((c) => ({ ...c, p: window.__dc.toScreen(c.w) })),
      free.map((s) => ({ ...s, w: { ...gridToWorld(F, s.row, s.col), y: floorY(level) } })).map((s) => ({ row: s.row, col: s.col, floorspace: s.floorspace, w: { x: s.w.x, y: s.w.y, z: s.w.z } })),
    );
    const picks = await dc(page, (ps) => ps.map((c) => (c.p ? window.__dc.pickAt(c.p.x, c.p.y) : null)), pts);
    const i = pts.findIndex((c, k) => c.p && c.p.x > 20 && c.p.x < 900 && c.p.y > 60 && c.p.y < 700 && picks[k]?.kind === 'slab' && c.floorspace !== free[0].floorspace);
    expect(i, 'an empty cell visible on screen').toBeGreaterThanOrEqual(0);
    const hit = pts[i];
    await page.mouse.click(hit.p.x, hit.p.y);
    await expect(form.locator('[name=floorspaces]')).toHaveValue(hit.floorspace);
    expect(await state(page)).toEqual(at({ floor: F.id })); // the click did not go "up"
    await form.locator('button[type=submit]').click();
    await saved(page);
    const id = `RI-${hit.floorspace}`;
    await expect.poll(() => dc(page, () => window.__dc.visibleRackIds())).toContain(id);
    expect(await dc(page, (i2) => window.__dc.rackInstanceColor(i2), id)).toBe('#3fb950'); // empty → green
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText(String(F.racks.length + 1));
    // the new rack opens like any other, with an empty 42U elevation
    await page.locator('#edit-toggle').click();
    await dc(page, (i2) => window.__dc.navigate({ rack: i2 }), id);
    await reach(page, at({ floor: F.id, rack: id }));
    await expect(page.locator('#elevation .elev-row.empty')).toHaveCount(42);
    await expect(page.locator('#breadcrumb .crumb.current')).toHaveText(rackLabel({ name: id }));
  });

  test('rename a DC in overview edit mode; export downloads the edited JSON', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const form = page.locator('#editor form[data-form=dc]');
    await form.locator('[name=name]').fill('가산 본센터');
    await form.locator('[name=name]').press('Enter');
    await saved(page);
    await expect(page.locator('#breadcrumb')).toHaveText('지도>가산 본센터');
    expect(await state(page)).toEqual(at());

    await page.locator('#data-menu-btn').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#data-menu [data-action=export]').click()]);
    expect(download.suggestedFilename()).toBe('datacenter.json');
    const json = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(json.datacenters[0].name).toBe('가산 본센터');
    expect(json.datacenters[0].id).toBe(FIRST_DC);
    expect(json.datacenters.map((d) => d.id)).toEqual(data.datacenters.map((d) => d.id));
    expect(JSON.stringify(json)).not.toContain('"invalid"');
    expect(json).toEqual(await dc(page, () => window.__dc.data()));
  });

  test('add a floor on top of the stack → floor view of the new empty floor, label in overview', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const next = Math.max(...gs.floors.map((f) => f.level)) + 1;
    const nid = `${next}F`;
    const form = page.locator('#editor form[data-form=add-floor]');
    await expect(form.locator('[name=level]')).toHaveAttribute('placeholder', String(next));
    await form.locator('[name=level]').fill(String(next));
    await form.locator('button[type=submit]').click();
    await reach(page, at({ floor: nid }));
    await saved(page);
    await expect(page.locator('#editor .edit-flash')).toHaveText(`층 추가됨: ${nid}`);
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText('0');
    await expect(page.locator('#floor-summary [data-k=slots]')).toHaveText('0');
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual([...gs.floors.map((f) => f.id), nid]);
    expect(await dc(page, (id) => window.__dc.emptySlotCount(id), nid)).toBe(0);
    // a rack can be added right away: the form offers `${level}A0101` on a floor without cells
    const rackForm = page.locator('#editor form[data-form=add-rack]');
    await expect(rackForm.locator('[name=floorspaces]')).toHaveValue(`${next}A0101`);
    await rackForm.locator('button[type=submit]').click();
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText('1');
    const stored = normalize(await dc(page, () => window.__dc.data()));
    const s = floorStats(stored.datacenters.find((d) => d.id === FIRST_DC).floors.find((f) => f.id === nid));
    await page.locator('#breadcrumb [data-level=dc]').click();
    await reach(page, at());
    await expect(page.locator(`.floor-label[data-floor="${nid}"]`)).toHaveText(`${nid} · 랙 ${s.racks}/${s.slots} · 평균 0%`);
    // duplicate level is rejected
    const again = page.locator('#editor form[data-form=add-floor]');
    await again.locator('[name=level]').fill('1');
    await again.locator('button[type=submit]').click();
    await expect(again.locator('.edit-error')).toContainText('1층이 이미');
  });

  test('add a datacenter → switch to its overview, persists; duplicate name rejected', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const form = page.locator('#editor form[data-form=add-dc]');
    await form.locator('[name=dc-name]').fill('의왕IDC');
    await form.locator('[name=first-level]').fill('2');
    await form.locator('button[type=submit]').click();
    await expect.poll(() => state(page)).toEqual({ dc: '의왕IDC', floor: null, rack: null, server: null });
    await settled(page);
    await saved(page);
    await expect(page.locator('#editor .edit-flash')).toHaveText('데이터센터 추가됨');
    expect(await dc(page, () => window.__dc.dcIds())).toEqual([...data.datacenters.map((d) => d.id), '의왕IDC']);
    await expect(page.locator('#breadcrumb')).toHaveText('지도>의왕IDC');
    await expect(page.locator('.floor-label')).toHaveText(['2F · 랙 0/0 · 평균 0%']);
    expect(await dc(page, () => window.__dc.builtDc())).toBe('의왕IDC');

    const again = page.locator('#editor form[data-form=add-dc]');
    await again.locator('[name=dc-name]').fill(FIRST_DC);
    await again.locator('button[type=submit]').click();
    await expect(again.locator('.edit-error')).toContainText(`"${FIRST_DC}"이(가) 이미`);

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, { dc: '의왕IDC' });
    expect(await dc(page, () => window.__dc.dcIds())).toContain('의왕IDC');
    await dc(page, (id) => window.__dc.navigate({ dc: id }), FIRST_DC);
    await reach(page, at());
    await expect(page.locator('.floor-label')).toHaveCount(gs.floors.length);
  });

  test('delete a floor (confirm text has counts) → DC overview without it; cancel keeps it', async ({ page }) => {
    await boot(page, hashOf({ floor: F.id }));
    await reach(page, at({ floor: F.id }));
    await editOn(page);
    const c = { racks: F.racks.length, devices: F.racks.reduce((a, r) => a + r.servers.length, 0) };
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('#editor [data-action=delete-floor]').click();
    expect(msg).toBe(`층 ${F.id}과 랙 ${c.racks}개 · 장비 ${c.devices}대를 삭제할까요?`);
    expect(await state(page)).toEqual(at({ floor: F.id }));

    page.once('dialog', (d) => d.accept());
    await page.locator('#editor [data-action=delete-floor]').click();
    await reach(page, at());
    await saved(page);
    const rest = gs.floors.filter((f) => f !== F).map((f) => f.id);
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(rest);
    await expect(page.locator('.floor-label')).toHaveCount(rest.length);
    await expect(page.locator(`.floor-label[data-floor="${F.id}"]`)).toHaveCount(0);
    // a link to the deleted floor falls back to the overview
    await dc(page, (f) => window.__dc.navigate({ floor: f }), F.id);
    await reach(page, at());
  });

  test('last floor and last DC cannot be deleted (buttons disabled with the reason)', async ({ page }) => {
    await boot(page);
    await upload(page, 'one.json', [rec(FIRST_DC, '1A0101', 'R-A', '2U (1-2)', 'one-01')]);
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual(MAP);
    await page.locator(`.map-item[data-dc="${FIRST_DC}"]`).click();
    await reach(page, at());
    await editOn(page);
    await expect(page.locator('#editor [data-action=delete-dc]')).toBeDisabled();
    await expect(page.locator('#editor .edit-danger')).toContainText('하나뿐');
    await dc(page, () => window.__dc.navigate({ floor: '1F' }));
    await reach(page, at({ floor: '1F' }));
    await expect(page.locator('#editor [data-action=delete-floor]')).toBeDisabled();
    await expect(page.locator('#editor .edit-danger')).toContainText('마지막 층');
  });

  test('delete a datacenter → back to the map without it, persists; its devices are gone from search', async ({ page }) => {
    const target = data.datacenters[1];
    await boot(page, `#dc=${encodeURIComponent(target.id)}`);
    await reach(page, { dc: target.id });
    await editOn(page);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.accept(); });
    await page.locator('#editor [data-action=delete-dc]').click();
    const c = counts(target);
    expect(msg).toBe(`데이터센터 "${target.name}"와 층 ${c.floors}개 · 랙 ${c.racks}개 · 장비 ${c.devices}대를 모두 삭제할까요?`);
    await expect.poll(() => state(page)).toEqual(MAP);
    await saved(page);
    const left = data.datacenters.filter((d) => d !== target).map((d) => d.id);
    await expect(mapItems(page)).toHaveCount(left.length);
    await expect(page.locator(`.map-item[data-dc="${target.id}"]`)).toHaveCount(0);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(left);
    const dev = target.floors[0].racks.find((r) => r.servers.length).servers[0].device_name;
    await page.locator('#search').fill(dev);
    await expect(page.locator('#search-results .no-result')).toBeVisible();
    await page.keyboard.press('Escape');
    // old link → the map; reload keeps the deletion
    await page.goto(`/?debug=1#dc=${encodeURIComponent(target.id)}&floor=1F`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, { dc: null });
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(left);
  });

  test('CSV upload (Excel, CP949 too) → loads; row errors point at the CSV row; CSV export round-trips', async ({ page }) => {
    await boot(page);
    await page.locator('#file-input').setInputFiles('examples/upload-example.csv');
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual(MAP);
    await settled(page);
    const example = parseDataset(readFileSync('examples/upload-example.json', 'utf8'), 'x').data;
    await expect(mapItems(page).locator('.name')).toHaveText(example.datacenters.map((d) => d.name));
    await expect(page.locator('#data-status')).toContainText('upload-example.csv');
    await expect(page.locator('#warnings')).toBeHidden();

    // Korean Excel "CSV" = CP949 bytes: build_name "서울IDC" (서울 = BC AD BF EF)
    const cp949 = Buffer.concat([Buffer.from('build_name,floorspace_name,rack_name\n'), Buffer.from([0xbc, 0xad, 0xbf, 0xef]), Buffer.from('IDC,1A0101,R1\n')]);
    await page.locator('#file-input').setInputFiles({ name: 'excel.csv', mimeType: 'text/csv', buffer: cp949 });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect(mapItems(page).locator('.name')).toHaveText(['서울IDC']);

    await page.locator('#file-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('build_name,foo\nx,y\n') });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'error');
    await expect(page.locator('#error .path')).toHaveText('bad.csv 1행 (헤더)');
    await expect(page.locator('#error')).toContainText('필수 열이 없습니다');
    await page.locator('#error .error-close').click();
    await expect(mapItems(page).locator('.name')).toHaveText(['서울IDC']); // previous upload kept

    await page.locator('#file-input').setInputFiles('examples/upload-example.csv');
    await expect(mapItems(page).locator('.name')).toHaveText(example.datacenters.map((d) => d.name));
    await page.locator('#data-menu-btn').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#data-menu [data-action=export-csv]').click()]);
    expect(download.suggestedFilename()).toBe('upload-example.csv');
    expect(readFileSync(await download.path(), 'utf8')).toBe(datasetToCsv(example));
    expect(readFileSync(await download.path(), 'utf8').split('\r\n')[0]).toBe('﻿build_name,floorspace_name,company,rack_name,device_position,device_name');
  });

  test('violations.csv → 8 grouped warnings (boundary share is not one); picking one opens its rack', async ({ page }) => {
    await boot(page);
    await page.locator('#file-input').setInputFiles('examples/violations.csv');
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect(page.locator('#warnings')).toHaveText('⚠ 8');
    await page.locator('#warnings').click();
    const group = (k) => page.locator(`#warnings-list .warn-group[data-kind=${k}]`);
    await expect(group('mount-overlap')).toContainText('(3)');
    await expect(group('rack-cell-conflict')).toContainText('(1)');
    await expect(group('rack-noncontiguous')).toContainText('(1)');
    await expect(group('position-invalid')).toContainText('(2)');
    await expect(group('unknown-build')).toContainText('(1)');
    await expect(page.locator('#warnings-list')).not.toContainText('boundary-ok');
    await expect(page.locator('#info')).toContainText('장착 위치 오류 장비 2대');
    await page.locator('#warnings-list li.pickable[data-kind=mount-overlap]').first().click();
    await expect.poll(async () => (await state(page)).rack).not.toBe(null);
    await settled(page);
    expect(await dc(page, () => window.__dc.violationRackIds())).toContain((await state(page)).rack);
  });
});
