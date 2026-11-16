import { el } from './dom.js';
import { rackLabel, unitRangeLabel } from '../domain/layout.js';
import { usedU } from '../domain/occupancy.js';

/**
 * Rack elevation inside #panel (rack/server modes): 42 `[data-u]` rows U42→U1 on a CSS grid,
 * each server one `[data-server-id]` block spanning height_u rows. Click → selectServer.
 */
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
    const occupied = new Set();
    for (const s of rack.servers) for (let u = s.unit; u < s.unit + (s.height_u || 1); u++) occupied.add(u);

    const head = el('header', { class: 'elev-head' });
    head.append(
      el('h2', {}, `${rackLabel(rack)} · ${floorId}`),
      el('div', { class: 'elev-usage', 'data-k': 'usage' }, `${used}/${total}U (${Math.round((used / total) * 100)}%)`),
    );
    const grid = el('div', { class: 'elev-grid' });
    grid.style.gridTemplateRows = `repeat(${total}, var(--u-h))`;
    for (let u = total; u >= 1; u--) {
      const row = el('div', { class: occupied.has(u) ? 'elev-row used' : 'elev-row empty', 'data-u': String(u) });
      row.style.gridRow = String(total - u + 1);
      row.append(el('span', { class: 'u-label' }, `U${u}`));
      grid.append(row);
    }
    for (const s of rack.servers) {
      const lo = Math.max(1, s.unit);
      const hi = Math.min(total, s.unit + (s.height_u || 1) - 1);
      if (hi < lo) continue; // entirely outside the rack: listed in warnings only
      const block = el('button', {
        type: 'button',
        class: s.invalid ? 'elev-server invalid' : 'elev-server',
        'data-server-id': s.id,
        title: `${s.hostname} · ${unitRangeLabel(s)}`,
      });
      block.style.gridRow = `${total - hi + 1} / span ${hi - lo + 1}`;
      block.append(el('span', { class: 'host' }, s.hostname), el('span', { class: 'units' }, unitRangeLabel(s)));
      block.addEventListener('click', () => store.selectServer(s.id));
      grid.append(block);
    }
    root.replaceChildren(head, grid);
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
    // Rack ids repeat across DCs (every DC has R-1F-01-01), so the cache key carries the DC.
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
