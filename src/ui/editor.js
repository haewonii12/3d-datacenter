import { el } from './dom.js';
import { rackLabel, rackCellsLabel, floorspaceAt } from '../domain/layout.js';
import { formatPosition } from '../data/records.js';
import { emptySlots } from '../domain/slots.js';
import {
  EditError,
  addDc,
  addFloor,
  countUnder,
  deleteDc,
  deleteFloor,
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

/** Lowest free U where a device of `height` fits, or null. */
function firstFreeUnit(rack, height = 1) {
  const used = new Set();
  for (const s of rack.servers) if (!s.invalid) for (let u = s.unit; u < s.unit + s.height_u; u++) used.add(u);
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
      el('p', { class: 'edit-hint' }, '층을 선택하면 랙을, 랙을 선택하면 장비를 추가할 수 있습니다.'),
      dangerZone('delete-dc', '데이터센터 삭제', () => {
        const c = countUnder(dc);
        return `데이터센터 "${dc.name}"와 층 ${c.floors}개 · 랙 ${c.racks}개 · 장비 ${c.servers}대를 모두 삭제할까요?`;
      }, () => deleteDc(store.data, dc.id), store.datacenters.length === 1 ? '데이터센터가 하나뿐이라 삭제할 수 없습니다.' : null),
    ];
  }

  /** Overview: new floor (level = the floorspace's first digit). */
  function addFloorForm(dc) {
    const def = nextFloorDefaults(dc);
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const level = input('level', '', { type: 'number', step: 1, min: 1, max: 9, placeholder: String(def.level) });
    const form = el('form', { class: 'edit-form edit-section', 'data-form': 'add-floor' });
    form.append(el('h3', {}, '층 추가'), field('층 (1–9)', level), errBox, buttons(el('button', { type: 'submit', class: 'primary' }, '층 추가')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addFloor(store.data, dc.id, { level: level.value });
        commit(out.data);
        flash = `층 추가됨: ${out.floorId}`; // shown by the floor's add-rack form
        store.enterFloor(out.floorId);
      }, errBox);
    });
    return form;
  }

  /** Overview: new DC (build) with its first floor; switches to it. */
  function addDcForm() {
    const errBox = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const name = input('dc-name', '', { required: true, placeholder: '예: 의왕IDC' });
    const level = input('first-level', '', { type: 'number', min: 1, max: 9, placeholder: '1' });
    const form = el('form', { class: 'edit-form edit-section', 'data-form': 'add-dc' });
    form.append(
      el('h3', {}, '데이터센터 추가'),
      field('이름 (build_name)', name),
      field('첫 층 (1–9)', level),
      errBox,
      buttons(el('button', { type: 'submit', class: 'primary' }, '데이터센터 추가')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addDc(store.data, { name: name.value, level: level.value });
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
    const zones = (floor.zones || []).map((z) => z.id).join('·') || '없음';
    const { head, errBox, msg } = shell('랙 추가', `${floor.id} · 구역 ${zones}`);
    const delFloor = dangerZone('delete-floor', '층 삭제', () => {
      const c = countUnder(floor);
      return `층 ${floor.id}${c.racks ? `과 랙 ${c.racks}개 · 장비 ${c.servers}대` : ''}를 삭제할까요?`;
    }, () => deleteFloor(store.data, dc.id, floor.id), dc.floors.length === 1 ? '마지막 층은 삭제할 수 없습니다. 데이터센터를 삭제하세요.' : null);
    const code = slot?.floorspace ?? `${floor.level}A0101`;
    const cells = input('floorspaces', code, { required: true, placeholder: `${floor.level}A0101,${floor.level}A0102` });
    const name = input('rack-name', '', { placeholder: defaultRackId(dc, code) });
    cells.addEventListener('input', () => {
      name.placeholder = defaultRackId(dc, cells.value.split(',')[0].trim().toUpperCase());
    });
    const form = el('form', { class: 'edit-form', 'data-form': 'add-rack' });
    form.append(field('floorspace (여러 칸은 쉼표)', cells), field('랙 이름 (rack_name)', name), errBox, msg, buttons(el('button', { type: 'submit', class: 'primary' }, '랙 추가')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addRack(store.data, dc.id, floor.id, { floorspaces: cells.value, name: name.value });
        draft = {};
        flash = `랙 추가됨: ${out.rackId}`;
        commit(out.data);
      }, errBox);
    });
    const hint = floor.zones?.length
      ? '바닥의 빈 상면(점선)을 클릭하면 floorspace가 채워집니다. 새 구역/줄은 코드를 직접 입력하세요.'
      : '이 층에는 아직 상면이 없습니다. floorspace 코드를 입력하세요 (예: 1A0101).';
    return [head, form, el('p', { class: 'edit-hint' }, hint), delFloor];
  }

  // ── rack: add device, delete rack ────────────────────────────────────────────────────────────
  function rackForm(state) {
    const { rack, floor } = store.getRack(state.rack);
    const dc = store.getDc(state.dc);
    const { head, errBox, msg } = shell(`랙 ${rackLabel(rack)} 편집`, `${floor.id} · ${rackCellsLabel(rack)}`);
    const u = prefill(state).unit ?? firstFreeUnit(rack);
    const form = el('form', { class: 'edit-form', 'data-form': 'add-server' });
    const name = input('device_name', '', { required: true, placeholder: 'web-01' });
    const company = input('company', '', { placeholder: '해원회사' });
    const pos = input('device_position', u ? formatPosition(u, u) : '', { required: true, placeholder: '1U (39-39)' });
    form.append(
      el('h3', {}, '장비 추가'),
      field('장비 이름', name),
      field('회사', company),
      field('장착 위치 (예: 3U (29-31))', pos),
      errBox,
      msg,
      buttons(el('button', { type: 'submit', class: 'primary' }, '장비 추가')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const out = addServer(store.data, dc.id, rack.id, { device_name: name.value, company: company.value, device_position: pos.value });
        draft = {};
        commit(out.data);
        flash = '장비 추가됨'; // shown by the device form that selectServer opens
        store.selectServer(out.serverId);
      }, errBox);
    });
    const delErr = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const del = el('button', { type: 'button', class: 'danger', 'data-action': 'delete-rack' }, '랙 삭제');
    del.addEventListener('click', () => {
      const n = rack.servers.length;
      if (!window.confirm(`랙 ${rackLabel(rack)}${n ? `과 장비 ${n}대` : ''}를 삭제할까요?`)) return;
      attempt(() => commit(deleteRack(store.data, dc.id, rack.id)), delErr);
    });
    const danger = el('div', { class: 'edit-danger' });
    danger.append(delErr, del);
    return [head, form, el('p', { class: 'edit-hint' }, '배치도의 빈 U를 클릭하면 장착 위치가 채워집니다. 경계 U 하나는 두 장비가 함께 쓸 수 있습니다.'), danger];
  }

  // ── device: fields, delete ───────────────────────────────────────────────────────────────────
  function serverForm(state) {
    const { server } = store.getServer(state.server);
    const dc = store.getDc(state.dc);
    const { head, errBox, msg } = shell('장비 편집', server.id);
    const name = input('device_name', server.device_name, { required: true });
    const company = input('company', server.company ?? '');
    const pos = input('device_position', server.device_position, { required: true });
    const form = el('form', { class: 'edit-form', 'data-form': 'server' });
    form.append(field('장비 이름', name), field('회사', company), field('장착 위치', pos), errBox, msg, buttons(el('button', { type: 'submit', class: 'primary' }, '저장')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(() => {
        const next = updateServer(store.data, dc.id, server.id, { device_name: name.value, company: company.value, device_position: pos.value });
        flash = '저장됨';
        commit(next);
      }, errBox);
    });
    const delErr = el('div', { class: 'edit-error', role: 'alert', hidden: true });
    const del = el('button', { type: 'button', class: 'danger', 'data-action': 'delete-server' }, '장비 삭제');
    del.addEventListener('click', () => {
      if (!window.confirm(`장비 ${server.device_name || server.device_position}를 삭제할까요?`)) return;
      attempt(() => commit(deleteServer(store.data, dc.id, server.id)), delErr);
    });
    const danger = el('div', { class: 'edit-danger' });
    danger.append(delErr, del);
    return [head, form, danger];
  }

  const FORMS = { overview: dcForm, floor: floorForm, rack: rackForm, server: serverForm };

  function render(state, force = false) {
    const mode = store.modeOf(state);
    root.hidden = !editing || mode === 'map';
    document.body.classList.toggle('editing', editing);
    if (!editing || mode === 'map') {
      key = null;
      root.replaceChildren();
      return;
    }
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
      const cell = hit.point && floorspaceAt(floor, hit.point.x, hit.point.z);
      if (!cell) return false;
      if (!emptySlots(floor).some((x) => x.floorspace === cell.code)) return false; // occupied cell
      draft = { at: targetOf(store.state), slot: { floorspace: cell.code } };
      render(store.state);
      return true;
    },
  };
}
