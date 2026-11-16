import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, settled, dc, state, reach, FIRST_DC } from './helpers.js';
import { normalize } from '../../src/data/schema.js';
import { gridToWorld, floorY, rackLabel } from '../../src/domain/layout.js';
import { datasetToCsv } from '../../src/data/csv.js';

const data = normalize(JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8')));
const seoul = data.datacenters[0];
const at = (o = {}) => ({ dc: FIRST_DC, floor: null, rack: null, server: null, ...o });

/** A rack of seoul-1 with ≥2 servers and a free U above its last server; its first server has services. */
function pickRack() {
  for (const floor of seoul.floors)
    for (const rack of floor.racks) {
      const top = Math.max(...rack.servers.map((s) => s.unit + s.height_u - 1));
      if (rack.servers.length >= 2 && top <= 38 && rack.servers[0].services.length && !rack.servers.some((s) => s.invalid))
        return { floor, rack, server: rack.servers[0], freeU: top + 2 };
    }
  throw new Error('no suitable rack');
}
const { floor: F, rack: R, server: S, freeU } = pickRack();

const tiny = (name = '업로드 DC') => ({
  version: 2,
  datacenters: [{ id: 'up-1', name, floors: [{ id: '1F', rows: 2, cols: 3, racks: [
    { id: 'R-A', row: 1, col: 1, total_u: 42, servers: [{ id: 's1', hostname: 'up-web-01', ip: '10.9.0.1', unit: 1, height_u: 2, services: [{ name: 'nginx', team: 'web', status: 'ok' }] }] },
  ] }] }],
});

const editOn = async (page) => {
  await page.locator('#edit-toggle').click();
  await expect(page.locator('#editor')).toBeVisible();
};
const saved = (page) => expect(page.locator('#app')).toHaveAttribute('data-saved', 'ok');

test.describe('upload + edit', () => {
  let consoleErrors;
  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
  });
  test.afterEach(() => expect(consoleErrors).toEqual([]));

  test('upload a valid file → replaces every DC, resets to its overview, survives reload; reset restores the original', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&floor=${F.id}`);
    await page.locator('#file-input').setInputFiles({ name: 'my-dc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tiny())) });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual({ dc: 'up-1', floor: null, rack: null, server: null });
    await settled(page);
    await expect(page.locator('#dc-select option')).toHaveText(['업로드 DC']);
    await expect(page.locator('#breadcrumb')).toHaveText('업로드 DC');
    await expect(page.locator('#data-status')).toContainText('my-dc.json');
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(['1F']);
    expect(await dc(page, () => window.__dc.visibleRackIds())).toEqual(['R-A']);

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect(page.locator('#dc-select option')).toHaveText(['업로드 DC']);

    page.once('dialog', (d) => d.accept());
    await page.locator('#data-menu-btn').click();
    await page.locator('#data-menu [data-action=reset]').click();
    await expect(page.locator('#app')).toHaveAttribute('data-saved', 'cleared');
    await reach(page, at());
    await expect(page.locator('#dc-select option')).toHaveCount(data.datacenters.length);
    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect(page.locator('#dc-select option')).toHaveCount(data.datacenters.length);
  });

  test('upload an invalid file → dismissible error, current data kept', async ({ page }) => {
    await boot(page);
    const before = await dc(page, () => window.__dc.revision());
    await page.locator('#file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"datacenters": [') });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'error');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error h2')).toContainText('bad.json');
    await expect(page.locator('#error .path')).toHaveText('bad.json');
    await page.locator('#file-input').setInputFiles({ name: 'dup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ datacenters: [{ id: 'a', floors: [] }] })) });
    await expect(page.locator('#error .path').first()).toHaveText('datacenters[0].floors');
    await page.locator('#error .error-close').click();
    await expect(page.locator('#error')).toBeHidden();
    expect(await dc(page, () => window.__dc.revision())).toBe(before);
    await expect(page.locator('#dc-select option')).toHaveCount(data.datacenters.length);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  });

  test('drag-and-drop a file onto the page loads it', async ({ page }) => {
    await boot(page);
    const dt = await page.evaluateHandle((json) => {
      const t = new DataTransfer();
      t.items.add(new File([json], 'dropped.json', { type: 'application/json' }));
      return t;
    }, JSON.stringify(tiny('드롭 DC')));
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await expect(page.locator('#drop-overlay')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    await expect(page.locator('#drop-overlay')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect(page.locator('#breadcrumb')).toHaveText('드롭 DC');
  });

  test('edit a server: fields + services; breadcrumb, panel, search and 3D follow; persists across reload', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&server=${S.id}`);
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await editOn(page);
    await expect(page.locator('#server-detail')).toBeHidden();
    const form = page.locator('#editor form[data-form=server]');
    await expect(form.locator('[name=hostname]')).toHaveValue(S.hostname);
    await expect(form.locator('.edit-service')).toHaveCount(S.services.length);

    await form.locator('[name=hostname]').fill('edited-host-01');
    await form.locator('[name=ip]').fill('192.168.7.7');
    await form.locator('[data-action=add-service]').click();
    const last = form.locator('.edit-service').last();
    await last.locator('[name=svc-name]').fill('new-svc');
    await last.locator('[name=svc-team]').fill('ops');
    await last.locator('[name=status]').selectOption('down');
    await form.locator('.edit-service').first().locator('[data-action=remove-service]').click();
    await form.locator('button[type=submit]').click();
    await saved(page);

    await expect(page.locator('#editor .edit-flash')).toHaveText('저장됨');
    await expect(page.locator('#breadcrumb .crumb.current')).toHaveText('edited-host-01');
    await expect(page.locator(`.elev-server[data-server-id="${S.id}"] .host`)).toHaveText('edited-host-01');
    expect(await state(page)).toEqual(at({ floor: F.id, rack: R.id, server: S.id }));
    const meshes = await dc(page, () => window.__dc.serverMeshes());
    expect(meshes.length).toBe(R.servers.length);

    // read-only panel (edit mode off) shows the new values
    await page.locator('#edit-toggle').click();
    await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText('edited-host-01');
    await expect(page.locator('#server-detail [data-k=ip]')).toHaveText('192.168.7.7');
    const names = page.locator('#server-detail .service [data-k=name]');
    await expect(names).toHaveText([...S.services.slice(1).map((s) => s.name), 'new-svc']);
    await expect(page.locator('#server-detail .service').last().locator('.badge')).toHaveClass(/status-down/);

    await page.locator('#search').fill('edited-host');
    await expect(page.locator('#search-results .result')).toHaveCount(1);
    await expect(page.locator('#search-results .result .label')).toHaveText('edited-host-01');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await expect(page.locator('#server-detail [data-k=hostname]')).toHaveText('edited-host-01');
    await expect(page.locator('#data-status')).toHaveText('수정됨 · 브라우저에 저장');
  });

  test('invalid server edit shows the reason and changes nothing', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&server=${S.id}`);
    await reach(page, at({ floor: F.id, rack: R.id, server: S.id }));
    await editOn(page);
    const rev = await dc(page, () => window.__dc.revision());
    const other = R.servers[1];
    const form = page.locator('#editor form[data-form=server]');
    await form.locator('[name=unit]').fill(String(other.unit));
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('겹칩니다');
    await form.locator('[name=unit]').fill(String(S.unit));
    await form.locator('[name=hostname]').fill(other.hostname);
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.edit-error')).toContainText('이미 있습니다');
    expect(await dc(page, () => window.__dc.revision())).toBe(rev);
    // ESC inside the form does not navigate up
    await form.locator('[name=hostname]').press('Escape');
    expect(await state(page)).toEqual(at({ floor: F.id, rack: R.id, server: S.id }));
  });

  test('add a server from an empty U in the elevation, then delete it', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&rack=${R.id}`);
    await reach(page, at({ floor: F.id, rack: R.id }));
    await editOn(page);
    await page.locator(`#elevation .elev-row.empty[data-u="${freeU}"]`).click();
    const form = page.locator('#editor form[data-form=add-server]');
    await expect(form.locator('[name=unit]')).toHaveValue(String(freeU));
    await form.locator('[name=hostname]').fill('brand-new-01');
    await form.locator('[name=height_u]').fill('2');
    await form.locator('button[type=submit]').click();
    await saved(page);

    await expect.poll(async () => (await state(page)).server).not.toBe(null);
    await settled(page);
    const st = await state(page);
    expect(st).toMatchObject({ floor: F.id, rack: R.id });
    await expect(page.locator('#editor form[data-form=server] [name=hostname]')).toHaveValue('brand-new-01');
    await expect(page.locator('#editor .edit-flash')).toHaveText('서버 추가됨');
    await expect(page.locator(`.elev-server[data-server-id="${st.server}"] .units`)).toHaveText(`U${freeU}–${freeU + 1}`);
    const meshes = await dc(page, () => window.__dc.serverMeshes());
    expect(meshes.length).toBe(R.servers.length + 1);

    page.once('dialog', (d) => d.accept());
    await page.locator('#editor [data-action=delete-server]').click();
    await reach(page, at({ floor: F.id, rack: R.id }));
    await expect(page.locator(`.elev-server[data-server-id="${st.server}"]`)).toHaveCount(0);
    expect((await dc(page, () => window.__dc.serverMeshes())).length).toBe(R.servers.length);
  });

  test('delete a rack (confirm) → floor view without it; cancel keeps it', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&rack=${R.id}`);
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
    // the freed slot is now the add-rack form's... any empty slot; the rack's slot can be re-added
    const form = page.locator('#editor form[data-form=add-rack]');
    await form.locator('[name=row]').fill(String(R.row));
    await form.locator('[name=col]').fill(String(R.col));
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#editor .edit-flash')).toContainText('랙 추가됨');
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText(String(F.racks.length));
  });

  test('floor edit mode: clicking an empty slot fills row/col, adding creates the rack in 3D', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&floor=${F.id}`);
    await reach(page, at({ floor: F.id }));
    await editOn(page);
    const level = seoul.floors.indexOf(F);
    const taken = new Set(F.racks.map((r) => `${r.row},${r.col}`));
    let hit = null;
    for (let row = 1; row <= F.rows && !hit; row++)
      for (let col = 1; col <= F.cols && !hit; col++) {
        if (taken.has(`${row},${col}`)) continue;
        const w = gridToWorld(F, row, col);
        const p = await dc(page, (q) => window.__dc.toScreen(q), { x: w.x, y: floorY(level), z: w.z });
        if (!p || p.x < 20 || p.x > 900 || p.y < 60 || p.y > 700) continue; // panel sits on the right
        const pk = await dc(page, ([x, y]) => window.__dc.pickAt(x, y), [p.x, p.y]);
        if (pk?.kind === 'slab') hit = { row, col, p };
      }
    expect(hit, 'an empty slot visible on screen').not.toBe(null);
    await page.mouse.click(hit.p.x, hit.p.y);
    const form = page.locator('#editor form[data-form=add-rack]');
    await expect(form.locator('[name=row]')).toHaveValue(String(hit.row));
    await expect(form.locator('[name=col]')).toHaveValue(String(hit.col));
    expect(await state(page)).toEqual(at({ floor: F.id })); // the click did not go "up"
    await form.locator('button[type=submit]').click();
    await saved(page);
    const id = `R-${F.id}-${String(hit.row).padStart(2, '0')}-${String(hit.col).padStart(2, '0')}`;
    await expect.poll(() => dc(page, () => window.__dc.visibleRackIds())).toContain(id);
    expect(await dc(page, (i) => window.__dc.rackInstanceColor(i), id)).toBe('#3fb950'); // empty → green
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText(String(F.racks.length + 1));
    // the new rack opens like any other, with an empty 42U elevation
    await page.locator('#edit-toggle').click();
    await dc(page, (i) => window.__dc.navigate({ rack: i }), id);
    await reach(page, at({ floor: F.id, rack: id }));
    await expect(page.locator('#elevation .elev-row.empty')).toHaveCount(42);
    await expect(page.locator('#breadcrumb .crumb.current')).toHaveText(rackLabel({ row: hit.row, col: hit.col }));
  });

  test('rename a DC in overview edit mode; export downloads the edited JSON', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const form = page.locator('#editor form[data-form=dc]');
    await form.locator('[name=name]').fill('서울 본센터');
    await form.locator('[name=name]').press('Enter');
    await saved(page);
    await expect(page.locator('#breadcrumb')).toHaveText('서울 본센터');
    await expect(page.locator('#dc-select option[data-dc=seoul-1]')).toHaveText('서울 본센터');
    expect(await state(page)).toEqual(at());

    await page.locator('#data-menu-btn').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#data-menu [data-action=export]').click()]);
    expect(download.suggestedFilename()).toBe('datacenter.json');
    const json = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(json.datacenters[0].name).toBe('서울 본센터');
    expect(json.datacenters.map((d) => d.id)).toEqual(data.datacenters.map((d) => d.id));
    expect(JSON.stringify(json)).not.toContain('"invalid"');
    expect(json).toEqual(await dc(page, () => window.__dc.data()));
  });

  test('add a floor on top of the stack → floor view of the new empty floor, label in overview', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const n = seoul.floors.length;
    const form = page.locator('#editor form[data-form=add-floor]');
    await expect(form.locator('[name=floor-id]')).toHaveAttribute('placeholder', `${n + 1}F`);
    await form.locator('[name=rows]').fill('6');
    await form.locator('[name=cols]').fill('9');
    await form.locator('button[type=submit]').click();
    await reach(page, at({ floor: `${n + 1}F` }));
    await saved(page);
    await expect(page.locator('#editor .edit-flash')).toHaveText(`층 추가됨: ${n + 1}F`);
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText('0');
    await expect(page.locator('#floor-summary [data-k=slots]')).toHaveText('54');
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual([...seoul.floors.map((f) => f.id), `${n + 1}F`]);
    expect(await dc(page, (id) => window.__dc.emptySlotCount(id), `${n + 1}F`)).toBe(54);
    // a rack can be added right away (the add-rack form is the floor's edit form)
    await page.locator('#editor form[data-form=add-rack] button[type=submit]').click();
    await expect(page.locator('#floor-summary [data-k=racks]')).toHaveText('1');
    await page.keyboard.press('Escape');
    await reach(page, at());
    await expect(page.locator(`.floor-label[data-floor="${n + 1}F"]`)).toHaveText(`${n + 1}F · 랙 1/54 · 평균 0%`);
    // duplicate level is rejected
    const again = page.locator('#editor form[data-form=add-floor]');
    await again.locator('[name=level]').fill('1');
    await again.locator('button[type=submit]').click();
    await expect(again.locator('.edit-error')).toContainText('레벨 1 층이 이미');
  });

  test('add a datacenter → selector, switch to its overview, persists; duplicate id rejected', async ({ page }) => {
    await boot(page);
    await editOn(page);
    const form = page.locator('#editor form[data-form=add-dc]');
    await form.locator('[name=dc-name]').fill('광주 DC4');
    await form.locator('[name=dc-id]').fill('gwangju-1');
    await form.locator('[name=dc-rows]').fill('8');
    await form.locator('[name=dc-cols]').fill('12');
    await form.locator('button[type=submit]').click();
    await expect.poll(() => state(page)).toEqual({ dc: 'gwangju-1', floor: null, rack: null, server: null });
    await settled(page);
    await saved(page);
    await expect(page.locator('#editor .edit-flash')).toHaveText('데이터센터 추가됨');
    await expect(page.locator('#dc-select option')).toHaveCount(data.datacenters.length + 1);
    await expect(page.locator('#dc-select')).toHaveValue('gwangju-1');
    await expect(page.locator('#breadcrumb')).toHaveText('광주 DC4');
    await expect(page.locator('.floor-label')).toHaveText(['1F · 랙 0/96 · 평균 0%']);
    expect(await dc(page, () => window.__dc.builtDc())).toBe('gwangju-1');

    const again = page.locator('#editor form[data-form=add-dc]');
    await again.locator('[name=dc-name]').fill('x');
    await again.locator('[name=dc-id]').fill('seoul-1');
    await again.locator('button[type=submit]').click();
    await expect(again.locator('.edit-error')).toContainText('"seoul-1"이(가) 이미');

    await page.reload();
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await expect(page.locator('#dc-select option[data-dc=gwangju-1]')).toHaveText('광주 DC4');
    await page.locator('#dc-select').selectOption('seoul-1');
    await reach(page, at());
    await expect(page.locator('.floor-label')).toHaveCount(seoul.floors.length);
  });

  test('delete a floor (confirm text has counts) → DC overview without it; cancel keeps it', async ({ page }) => {
    await boot(page, `#dc=${FIRST_DC}&floor=${F.id}`);
    await reach(page, at({ floor: F.id }));
    await editOn(page);
    const servers = F.racks.reduce((a, r) => a + r.servers.length, 0);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.locator('#editor [data-action=delete-floor]').click();
    expect(msg).toBe(`층 ${F.id}과 랙 ${F.racks.length}개 · 서버 ${servers}대를 삭제할까요?`);
    expect(await state(page)).toEqual(at({ floor: F.id }));

    page.once('dialog', (d) => d.accept());
    await page.locator('#editor [data-action=delete-floor]').click();
    await reach(page, at());
    await saved(page);
    const rest = seoul.floors.filter((f) => f !== F).map((f) => f.id);
    expect(await dc(page, () => window.__dc.builtFloorIds())).toEqual(rest);
    await expect(page.locator('.floor-label')).toHaveCount(rest.length);
    await expect(page.locator(`.floor-label[data-floor="${F.id}"]`)).toHaveCount(0);
    // a link to the deleted floor falls back to the overview
    await dc(page, (f) => window.__dc.navigate({ floor: f }), F.id);
    await reach(page, at());
  });

  test('last floor and last DC cannot be deleted (buttons disabled with the reason)', async ({ page }) => {
    await boot(page);
    await page.locator('#file-input').setInputFiles({ name: 'one.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tiny())) });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await editOn(page);
    await expect(page.locator('#editor [data-action=delete-dc]')).toBeDisabled();
    await expect(page.locator('#editor .edit-danger')).toContainText('하나뿐');
    await dc(page, () => window.__dc.navigate({ floor: '1F' }));
    await expect.poll(() => state(page)).toEqual({ dc: 'up-1', floor: '1F', rack: null, server: null });
    await expect(page.locator('#editor [data-action=delete-floor]')).toBeDisabled();
    await expect(page.locator('#editor .edit-danger')).toContainText('마지막 층');
  });

  test('delete a datacenter → first remaining DC overview, selector updated, persists', async ({ page }) => {
    const target = data.datacenters[1];
    await boot(page, `#dc=${target.id}`);
    await reach(page, { dc: target.id });
    await editOn(page);
    let msg = '';
    page.once('dialog', (d) => { msg = d.message(); d.accept(); });
    await page.locator('#editor [data-action=delete-dc]').click();
    const c = { floors: target.floors.length, racks: target.floors.reduce((a, f) => a + f.racks.length, 0) };
    expect(msg).toContain(`데이터센터 "${target.name}"와 층 ${c.floors}개 · 랙 ${c.racks}개`);
    await reach(page, at());
    await saved(page);
    const left = data.datacenters.filter((d) => d !== target).map((d) => d.id);
    await expect(page.locator('#dc-select option')).toHaveCount(left.length);
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(left);
    expect(await dc(page, () => window.__dc.builtDc())).toBe(FIRST_DC);
    // its servers are gone from search
    const host = target.floors[0].racks.find((r) => r.servers.length).servers[0].hostname;
    await page.locator('#search').fill(host);
    await expect(page.locator('#search-results .no-result')).toBeVisible();
    await page.keyboard.press('Escape');
    // old link → first DC overview; reload keeps the deletion
    await page.goto(`/?debug=1#dc=${target.id}&floor=1F`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
    await reach(page, at());
    expect(await dc(page, () => window.__dc.dcIds())).toEqual(left);
  });

  test('CSV upload (Excel, CP949 too) → loads; row errors point at the CSV row; CSV export round-trips', async ({ page }) => {
    await boot(page);
    await page.locator('#file-input').setInputFiles('examples/upload-example.csv');
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect.poll(() => state(page)).toEqual({ dc: 'seoul-1', floor: null, rack: null, server: null });
    await settled(page);
    await expect(page.locator('#dc-select option')).toHaveText(['서울 DC1', '부산 DC2']);
    await expect(page.locator('.floor-label')).toHaveCount(2);
    await expect(page.locator('#data-status')).toContainText('upload-example.csv');
    await expect(page.locator('#warnings')).toBeHidden();

    // Korean Excel "CSV" = CP949 bytes: 데이터센터 이름 "서울"
    const cp949 = Buffer.from([100, 99, 95, 105, 100, 44, 102, 108, 111, 111, 114, 95, 105, 100, 44, 100, 99, 95, 110, 97, 109, 101, 10, 100, 49, 44, 49, 70, 44, 188, 173, 191, 239, 10]);
    await page.locator('#file-input').setInputFiles({ name: 'excel.csv', mimeType: 'text/csv', buffer: cp949 });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'ok');
    await expect(page.locator('#dc-select option')).toHaveText(['서울']);

    await page.locator('#file-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv',
      buffer: Buffer.from('dc_id,floor_id,rack_row,rack_col,hostname,unit\nd,1F,1,1,h1,abc\n') });
    await expect(page.locator('#app')).toHaveAttribute('data-upload', 'error');
    await expect(page.locator('#error .path')).toHaveText('2행 unit');
    await expect(page.locator('#error')).toContainText('정수가 아닙니다');
    await page.locator('#error .error-close').click();
    await expect(page.locator('#dc-select option')).toHaveText(['서울']); // previous upload kept

    await page.locator('#file-input').setInputFiles('examples/upload-example.csv');
    await expect(page.locator('#dc-select option')).toHaveText(['서울 DC1', '부산 DC2']);
    await page.locator('#data-menu-btn').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#data-menu [data-action=export-csv]').click()]);
    expect(download.suggestedFilename()).toBe('upload-example.csv');
    // export = normalized data (a missing height_u comes back as 1), same as the JSON export
    const example = normalize(JSON.parse(readFileSync('examples/upload-example.json', 'utf8')));
    expect(readFileSync(await download.path(), 'utf8')).toBe(datasetToCsv(example));
  });
});
