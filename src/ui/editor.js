import { el } from './dom.js';
import { rackLabel, worldToGrid } from '../domain/layout.js';
import { STATUS_TEXT } from './serverPanel.js';
import {
  EditError,
  addDc,
  addFloor,
  countUnder,
  deleteDc,
  deleteFloor,
  defaultDcId,
  nextFloorDefaults,
  addRack,
  addServer,
  deleteRack,
  deleteServer,
  defaultRackId,
  firstEmptySlot,
  renameDc,
  updateServer,
} from '../data/edit.js';

/** Lowest free U where a server of `height` fits, or null. */
function firstFreeUnit(rack, height = 1) {
  const used = new Set();
  for (const s of rack.servers) for (let u = s.unit; u < s.unit + (s.height_u || 1); u++) used.add(u);
  for (let u = 1; u + height - 1 <= rack.total_u; u++) {
    let ok = true;
    for (let k = u; k < u + height; k++) if (used.has(k)) ok = false;
    if (ok) return u;
  }
  return null;
}

function input(name, value, attrs = {}) {
  return el('input', { ...attrs, name, value: value ?? '', autocomplete: 'off', spellcheck: false }); // type before value
}

function field(label, control) {
  const l = el('label', { class: 'edit-field' });
  l.append(el('span', { class: 'k' }, label), control);
  return l;
}

/**
 * Edit mode inside #panel (section#editor): one form per mode, all changes go through the pure ops
 * in data/edit.js and then `commit(newData)` (re-normalize + store.setData + persist, owned by main).
 * @param {HTMLElement} panel
 * @param {{commit:(data:any)=>void}} deps
 */
export function createEditor(panel, store, { commit }) {
  const root = el('section', { id: 'editor' });
  panel.append(root);
  let editing = false;
  let key = null;
  /** Prefills chosen by clicking the scene / elevation: {at, slot:{row,col}} (floor) or {at, unit} (rack). */
  let draft = {};
  /** The floor or rack a prefill belongs to; a prefill never leaks into another floor/rack. */
  const targetOf = (s) => (s.rack ? `r:${s.dc}/${s.rack}` : `f:${s.dc}/${s.floor}`);
  const prefill = (s) => (draft.at === targetOf(s) ? draft : {});
  /** One-shot message shown in the next rendered form ("저장됨", errors after re-render). */
  let flash = null;

  /** Runs an edit op; shows EditError messages in the form, rethrows anything else. */
  function attempt(fn, errBox) {
    try {
      fn();
      return true;
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      errBox.textContent = e.message;
      errBox.hidden = false;
      return false;
    }
  }

  function shell(title, sub) {
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const msg = el('div', { class: 'edit-flash' }, flash ?? '');
    msg.hidden = !flash;
    flash = null;
    const head = el('header', { class: 'edit-head' });
    head.append(el('h2', {}, title));
    if (sub) head.append(el('span', { class: 'edit-sub' }, sub));
    return { head, errBox, msg };
  }

  function buttons(...list) {
    const row = el('div', { class: 'edit-actions' });
    row.append(...list);
    return row;
  }

  /**
   * Delete button with a confirm; `blocked` (a reason) disables it up front. The op's EditError still
   * shows in place if the data changed underneath.
   */
  function dangerZone(action, label, question, op, blocked) {
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const del = el('button', { type: 'button', class: 'danger', 'data-action': action, disabled: Boolean(blocked), title: blocked ?? '' }, label);
    del.addEventListener('click', () => {
      if (!window.confirm(question())) return;
      attempt(() => commit(op()), errBox);
    });
    const zone = el('div', { class: 'edit-danger' });
    if (blocked) zone.append(el('div', { class: 'edit-hint' }, blocked));
    zone.append(errBox, del);
    return zone;
  }

  // ── overview: DC name ────────────────────────────────────────────────────────────────────────
  function dcForm(state) {
    const dc = store.getDc(state.dc);
    const { head, errBox, msg } = shell('데이터센터 편집', dc.id);
    const name = input('name', dc.name, { required: true });
    const form = el('form', { class: 'edit-form', 'data-form': 'dc' });
    form.append(field('이름', name), errBox, msg, buttons(el('button', { type: 'submit', class: 'primary' }, '저장')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const next = renameDc(store.data, dc.id, name.value);
        flash = '저장됨';
        commit(next);
      }, errBox);
    });
    return [
      head,
      form,
      addFloorForm(dc),
      addDcForm(),
      el('p', { class: 'edit-hint' }, '층을 선택하면 랙을, 랙을 선택하면 서버를 추가할 수 있습니다.'),
      dangerZone('delete-dc', '데이터센터 삭제', () => {
        const c = countUnder(dc);
        return `데이터센터 "${dc.name}"와 층 ${c.floors}개 · 랙 ${c.racks}개 · 서버 ${c.servers}대를 모두 삭제할까요?`;
      }, () => deleteDc(store.data, dc.id), store.datacenters.length === 1 ? '데이터센터가 하나뿐이라 삭제할 수 없습니다.' : null),
    ];
  }

  /** Overview: new floor on top of the stack (prefilled from the top floor). */
  function addFloorForm(dc) {
    const def = nextFloorDefaults(dc);
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const id = input('floor-id', '', { placeholder: def.id });
    const level = input('level', '', { type: 'number', step: 1, placeholder: String(def.level) });
    const rows = input('rows', def.rows, { type: 'number', min: 1, max: 60, required: true });
    const cols = input('cols', def.cols, { type: 'number', min: 1, max: 60, required: true });
    const g1 = el('div', { class: 'edit-grid2' });
    g1.append(field('층 ID', id), field('레벨 (아래→위)', level));
    const g2 = el('div', { class: 'edit-grid2' });
    g2.append(field('Row 수', rows), field('Col 수', cols));
    const form = el('form', { class: 'edit-form edit-section', 'data-form': 'add-floor' });
    form.append(el('h3', {}, '층 추가'), g1, g2, errBox, buttons(el('button', { type: 'submit', class: 'primary' }, '층 추가')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addFloor(store.data, dc.id, { id: id.value, level: level.value, rows: rows.value, cols: cols.value });
        commit(out.data);
        flash = `층 추가됨: ${out.floorId}`; // shown by the floor's add-rack form
        store.enterFloor(out.floorId);
      }, errBox);
    });
    return form;
  }

  /** Overview: new DC with its first floor; switches to it. */
  function addDcForm() {
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const id = input('dc-id', '', { placeholder: defaultDcId(store.data) });
    const name = input('dc-name', '', { required: true, placeholder: '예: 광주 DC4' });
    const floorId = input('first-floor', '', { placeholder: '1F' });
    const rows = input('dc-rows', 10, { type: 'number', min: 1, max: 60, required: true });
    const cols = input('dc-cols', 16, { type: 'number', min: 1, max: 60, required: true });
    const g1 = el('div', { class: 'edit-grid2' });
    g1.append(field('ID', id), field('첫 층 ID', floorId));
    const g2 = el('div', { class: 'edit-grid2' });
    g2.append(field('Row 수', rows), field('Col 수', cols));
    const form = el('form', { class: 'edit-form edit-section', 'data-form': 'add-dc' });
    form.append(
      el('h3', {}, '데이터센터 추가'),
      field('이름', name),
      g1,
      g2,
      errBox,
      buttons(el('button', { type: 'submit', class: 'primary' }, '데이터센터 추가')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addDc(store.data, { id: id.value, name: name.value, floorId: floorId.value, rows: rows.value, cols: cols.value });
        commit(out.data);
        flash = '데이터센터 추가됨';
        store.selectDc(out.dcId);
      }, errBox);
    });
    return form;
  }

  // ── floor: add rack ──────────────────────────────────────────────────────────────────────────
  function floorForm(state) {
    const floor = store.getFloor(state.floor);
    const dc = store.getDc(state.dc);
    const slot = prefill(state).slot ?? firstEmptySlot(floor);
    const { head, errBox, msg } = shell('랙 추가', `${floor.id} · ${floor.rows}×${floor.cols} 슬롯`);
    const delFloor = dangerZone('delete-floor', '층 삭제', () => {
      const c = countUnder(floor);
      return `층 ${floor.id}${c.racks ? `과 랙 ${c.racks}개 · 서버 ${c.servers}대` : ''}를 삭제할까요?`;
    }, () => deleteFloor(store.data, dc.id, floor.id), dc.floors.length === 1 ? '마지막 층은 삭제할 수 없습니다. 데이터센터를 삭제하세요.' : null);
    if (!slot) return [head, msg, el('p', { class: 'edit-hint' }, '빈 슬롯이 없습니다.'), delFloor];
    const row = input('row', slot.row, { type: 'number', min: 1, max: floor.rows, required: true });
    const col = input('col', slot.col, { type: 'number', min: 1, max: floor.cols, required: true });
    const id = input('id', '', { placeholder: defaultRackId(dc, floor.id, slot.row, slot.col) });
    const syncPlaceholder = () => {
      const r = Number(row.value);
      const c = Number(col.value);
      if (Number.isInteger(r) && Number.isInteger(c)) id.placeholder = defaultRackId(dc, floor.id, r, c);
    };
    row.addEventListener('input', syncPlaceholder);
    col.addEventListener('input', syncPlaceholder);
    const form = el('form', { class: 'edit-form', 'data-form': 'add-rack' });
    const grid = el('div', { class: 'edit-grid2' });
    grid.append(field('Row', row), field('Col', col));
    form.append(grid, field('랙 ID', id), errBox, msg, buttons(el('button', { type: 'submit', class: 'primary' }, '랙 추가')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addRack(store.data, dc.id, floor.id, { row: row.value, col: col.value, id: id.value });
        draft = {};
        flash = `랙 추가됨: ${out.rackId}`;
        commit(out.data);
      }, errBox);
    });
    return [head, form, el('p', { class: 'edit-hint' }, '바닥의 빈 슬롯(점선)을 클릭하면 위치가 채워집니다.'), delFloor];
  }

  // ── rack: add server, delete rack ────────────────────────────────────────────────────────────
  function rackForm(state) {
    const { rack, floor } = store.getRack(state.rack);
    const dc = store.getDc(state.dc);
    const { head, errBox, msg } = shell(`랙 ${rackLabel(rack)} 편집`, `${floor.id} · ${rack.id}`);
    const unitValue = prefill(state).unit ?? firstFreeUnit(rack);
    const form = el('form', { class: 'edit-form', 'data-form': 'add-server' });
    const hostname = input('hostname', '', { required: true, placeholder: 'web-01' });
    const ip = input('ip', '', { placeholder: '10.0.0.1' });
    const unit = input('unit', unitValue ?? '', { type: 'number', min: 1, max: rack.total_u, required: true });
    const height = input('height_u', 1, { type: 'number', min: 1, max: rack.total_u, required: true });
    const grid = el('div', { class: 'edit-grid2' });
    grid.append(field('시작 U', unit), field('높이 (U)', height));
    form.append(
      el('h3', {}, '서버 추가'),
      field('호스트명', hostname),
      field('IP', ip),
      grid,
      errBox,
      msg,
      buttons(el('button', { type: 'submit', class: 'primary' }, '서버 추가')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addServer(store.data, dc.id, rack.id, { hostname: hostname.value, ip: ip.value, unit: unit.value, height_u: height.value });
        draft = {};
        commit(out.data);
        flash = '서버 추가됨'; // shown by the server form that selectServer opens
        store.selectServer(out.serverId);
      }, errBox);
    });
    const delErr = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const del = el('button', { type: 'button', class: 'danger', 'data-action': 'delete-rack' }, '랙 삭제');
    del.addEventListener('click', () => {
      const n = rack.servers.length;
      if (!window.confirm(`랙 ${rackLabel(rack)}${n ? `과 서버 ${n}대` : ''}를 삭제할까요?`)) return;
      attempt(() => commit(deleteRack(store.data, dc.id, rack.id)), delErr);
    });
    const danger = el('div', { class: 'edit-danger' });
    danger.append(delErr, del);
    return [head, form, el('p', { class: 'edit-hint' }, '배치도의 빈 U를 클릭하면 시작 U가 채워집니다.'), danger];
  }

  // ── server: fields + services, delete ────────────────────────────────────────────────────────
  function serviceRow(svc = { name: '', team: '', status: 'ok' }) {
    const li = el('li', { class: 'edit-service' });
    const status = el('select', { name: 'status' });
    for (const [v, label] of Object.entries(STATUS_TEXT)) status.append(el('option', { value: v }, label));
    status.value = STATUS_TEXT[svc.status] ? svc.status : 'unknown';
    const remove = el('button', { type: 'button', class: 'icon', title: '서비스 삭제', 'data-action': 'remove-service' }, '×');
    remove.addEventListener('click', () => li.remove());
    li.append(input('svc-name', svc.name, { placeholder: '서비스명' }), input('svc-team', svc.team ?? '', { placeholder: '팀' }), status, remove);
    return li;
  }

  function serverForm(state) {
    const { server } = store.getServer(state.server);
    const dc = store.getDc(state.dc);
    const { head, errBox, msg } = shell('서버 편집', server.id);
    const hostname = input('hostname', server.hostname, { required: true });
    const ip = input('ip', server.ip ?? '');
    const unit = input('unit', server.unit, { type: 'number', min: 1, required: true });
    const height = input('height_u', server.height_u || 1, { type: 'number', min: 1, required: true });
    const services = el('ul', { class: 'edit-services' });
    services.append(...server.services.map((s) => serviceRow(s)));
    const add = el('button', { type: 'button', 'data-action': 'add-service' }, '+ 서비스 추가');
    add.addEventListener('click', () => {
      const li = serviceRow();
      services.append(li);
      li.querySelector('input').focus();
    });
    const grid = el('div', { class: 'edit-grid2' });
    grid.append(field('시작 U', unit), field('높이 (U)', height));
    const form = el('form', { class: 'edit-form', 'data-form': 'server' });
    form.append(
      field('호스트명', hostname),
      field('IP', ip),
      grid,
      el('h3', {}, '서비스'),
      services,
      add,
      errBox,
      msg,
      buttons(el('button', { type: 'submit', class: 'primary' }, '저장')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const svcs = [...services.children].map((li) => ({
        name: li.querySelector('[name=svc-name]').value,
        team: li.querySelector('[name=svc-team]').value,
        status: li.querySelector('[name=status]').value,
      }));
      attempt(() => {
        const next = updateServer(store.data, dc.id, server.id, {
          hostname: hostname.value,
          ip: ip.value,
          unit: unit.value,
          height_u: height.value,
          services: svcs.filter((s) => s.name.trim() || s.team.trim()), // fully blank rows are ignored
        });
        flash = '저장됨';
        commit(next);
      }, errBox);
    });
    const delErr = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const del = el('button', { type: 'button', class: 'danger', 'data-action': 'delete-server' }, '서버 삭제');
    del.addEventListener('click', () => {
      if (!window.confirm(`서버 ${server.hostname}를 삭제할까요?`)) return;
      attempt(() => commit(deleteServer(store.data, dc.id, server.id)), delErr);
    });
    const danger = el('div', { class: 'edit-danger' });
    danger.append(delErr, del);
    return [head, form, danger];
  }

  const FORMS = { overview: dcForm, floor: floorForm, rack: rackForm, server: serverForm };

  function render(state, force = false) {
    root.hidden = !editing;
    document.body.classList.toggle('editing', editing);
    if (!editing) {
      key = null;
      root.replaceChildren();
      return;
    }
    const mode = store.modeOf(state);
    const k = JSON.stringify([store.revision, state, prefill(state)]);
    if (k === key && !force) return;
    key = k;
    root.dataset.mode = mode;
    root.replaceChildren(...FORMS[mode](state));
  }

  return {
    root,
    render,
    get editing() {
      return editing;
    },
    setEditing(on) {
      editing = Boolean(on);
      draft = {};
      render(store.state, true);
    },
    /** Elevation: an empty U was clicked (rack or server mode). */
    pickUnit(u) {
      if (!editing) return;
      draft = { at: targetOf(store.state), unit: u };
      if (store.mode() === 'server') store.goLevel('rack');
      else render(store.state);
    },
    /** Picking interceptor: in floor edit mode an empty-slot click fills the add-rack form. */
    interceptClick(hit, mode) {
      if (!editing || mode !== 'floor' || hit?.kind !== 'slab' || hit.id !== store.state.floor) return false;
      const floor = store.getFloor(hit.id);
      const slot = hit.point && worldToGrid(floor, hit.point.x, hit.point.z);
      if (!slot || floor.racks.some((r) => r.row === slot.row && r.col === slot.col)) return false;
      draft = { at: targetOf(store.state), slot };
      render(store.state);
      return true;
    },
  };
}
