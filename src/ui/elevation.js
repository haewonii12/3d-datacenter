import { el } from './dom.js';
import { rackLabel, rackCellsLabel, unitRangeLabel, deviceLabel } from '../domain/layout.js';
import { usedU } from '../domain/occupancy.js';
import { sharedUnits } from '../domain/mount.js';

/**
 * Rack elevation inside #panel (rack/server modes): U42→U1 `[data-u]` rows on a CSS grid with two grid
 * lines per U, so a boundary-shared U shows the lower device in its bottom half and the upper device in
 * its top half. Each device is one `[data-server-id]` block. Devices with an unparsable position are
 * listed under the grid ("위치 오류"). Click → selectServer.
 */
/**
 * Lane per device: legal layouts (including boundary-shared halves) all fit lane 0; devices that
 * overlap in violation of the mount rules get further lanes. Works in half-U steps.
 * @returns {Map<string, number>}
 */
export function laneOf(devices, shares) {
  const span = (s) => {
    const sh = shares.get(s.id) ?? {};
    return [2 * (s.unit - 1) + (sh.trimBottom ? 1 : 0), 2 * (s.unit - 1 + s.height_u) - (sh.trimTop ? 1 : 0)]; // half-U [lo, hi)
  };
  const ends = []; // per lane: end (exclusive) of its last device
  const out = new Map();
  for (const s of [...devices].sort((a, b) => a.unit - b.unit || a.height_u - b.height_u)) {
    const [lo, hi] = span(s);
    let lane = ends.findIndex((e) => e <= lo);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = hi;
    out.set(s.id, lane);
  }
  return out;
}

export function createElevation(panel, store, { onEmptyUnit } = {}) {
  const root = el('section', { id: 'elevation' });
  panel.append(root);
  let rackId = null;
  // Edit mode: clicking an empty U row proposes a new server there (rows are rebuilt, so delegate).
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.elev-row.empty');
    if (row && onEmptyUnit) onEmptyUnit(Number(row.dataset.u));
  });

  function build(rack, floorId) {
    const total = rack.total_u;
    const used = usedU(rack);
    const mounted = rack.servers.filter((s) => !s.invalid);
    const occupied = new Set();
    for (const s of mounted) for (let u = s.unit; u < s.unit + s.height_u; u++) occupied.add(u);
    const shares = sharedUnits(mounted.map((s) => ({ id: s.id, s: s.unit, e: s.unit + s.height_u - 1 })));
    const lanes = laneOf(mounted, shares);
    const laneCount = Math.max(0, ...lanes.values()) + 1;

    const head = el('header', { class: 'elev-head' });
    head.append(
      el('h2', {}, `${rackLabel(rack)} · ${floorId}`),
      el('div', { class: 'elev-cells', 'data-k': 'cells' }, rackCellsLabel(rack)),
      el('div', { class: 'elev-usage', 'data-k': 'usage' }, `${used}/${total}U (${Math.round((used / total) * 100)}%)`),
    );
    const grid = el('div', { class: 'elev-grid' });
    grid.style.gridTemplateRows = `repeat(${2 * total}, calc(var(--u-h) / 2))`;
    // Grid line of the top edge of U u's upper half: U total is lines 1–3, U1 is lines 2·total−1 … 2·total+1.
    const top = (u) => 2 * (total - u) + 1;
    for (let u = total; u >= 1; u--) {
      const row = el('div', { class: occupied.has(u) ? 'elev-row used' : 'elev-row empty', 'data-u': String(u) });
      row.style.gridRow = `${top(u)} / span 2`;
      row.append(el('span', { class: 'u-label' }, `U${u}`));
      grid.append(row);
    }
    for (const s of mounted) {
      const lo = s.unit;
      const hi = s.unit + s.height_u - 1;
      const sh = shares.get(s.id) ?? {};
      const start = top(hi) + (sh.trimTop ? 1 : 0);
      const end = top(lo) + 2 - (sh.trimBottom ? 1 : 0);
      const cls = ['elev-server'];
      if (s.violation) cls.push('invalid');
      if (sh.trimTop || sh.trimBottom) cls.push('shared');
      const block = el('button', {
        type: 'button',
        class: cls.join(' '),
        'data-server-id': s.id,
        title: `${deviceLabel(s)} · ${s.company || '—'} · ${unitRangeLabel(s)}${s.violation ? ` · ${s.violation.join(' / ')}` : ''}`,
      });
      block.style.gridRow = `${start} / ${end}`;
      if (laneCount > 1) {
        // Overlapping (violating) devices sit side by side so each stays visible and clickable.
        block.style.width = `calc(${100 / laneCount}% - 4px)`;
        block.style.marginLeft = `calc(${(100 * lanes.get(s.id)) / laneCount}%)`;
        block.style.justifySelf = 'start';
        block.dataset.lane = String(lanes.get(s.id));
      }
      block.append(el('span', { class: 'host' }, deviceLabel(s)), el('span', { class: 'units' }, unitRangeLabel(s)));
      block.addEventListener('click', () => store.selectServer(s.id));
      grid.append(block);
    }
    const bad = rack.servers.filter((s) => s.invalid);
    const parts = [head, grid];
    if (bad.length) {
      const list = el('ul', { class: 'elev-bad' });
      for (const s of bad) {
        const li = el('li', { 'data-server-id': s.id });
        const btn = el('button', { type: 'button', class: 'elev-bad-item' }, `${s.device_name || '(이름 없음)'} · ${s.device_position || '(비어 있음)'}`);
        btn.addEventListener('click', () => store.selectServer(s.id));
        li.append(btn);
        list.append(li);
      }
      parts.push(el('h3', { class: 'elev-bad-title' }, `위치 오류 (${bad.length})`), list);
    }
    root.replaceChildren(...parts);
  }

  function render(state) {
    const mode = store.modeOf(state);
    const show = mode === 'rack' || mode === 'server';
    root.hidden = !show;
    if (!show) {
      rackId = null;
      root.replaceChildren();
      return;
    }
    // Rack names may repeat across DCs, so the cache key carries the DC.
    const key = `${store.revision}\u0000${state.dc}\u0000${state.rack}`;
    if (rackId !== key) {
      const r = store.getRack(state.rack);
      build(r.rack, r.floor.id);
      rackId = key;
    }
    for (const b of root.querySelectorAll('.elev-server')) b.classList.toggle('selected', b.dataset.serverId === state.server);
  }
  return { render, root };
}
