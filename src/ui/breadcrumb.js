import { el } from './dom.js';
import { rackLabel, deviceLabel } from '../domain/layout.js';

/**
 * `지도 > {DC name} > 2F > {rack name} > {device name}`; each item is a `[data-level]` button → store.goLevel
 * (root = the map, dc = the DC overview).
 */
export function createBreadcrumb(root, store) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) store.goLevel(b.dataset.level);
  });

  function render(state) {
    const parts = [['root', '지도']];
    const dc = state.dc != null ? store.getDc(state.dc) : null;
    if (dc) parts.push(['dc', dc.name]);
    if (state.floor) parts.push(['floor', state.floor]);
    const r = state.rack && store.getRack(state.rack);
    if (r) parts.push(['rack', rackLabel(r.rack)]);
    const s = state.server && store.getServer(state.server);
    if (s) parts.push(['server', deviceLabel(s.server)]);
    const nodes = [];
    parts.forEach(([level, text], i) => {
      if (i) nodes.push(el('span', { class: 'sep' }, '>'));
      const current = i === parts.length - 1;
      nodes.push(el('button', { type: 'button', class: current ? 'crumb current' : 'crumb', 'data-level': level }, text));
    });
    root.replaceChildren(...nodes);
  }
  return { render };
}
