import { el } from './dom.js';
import { rackLabel } from '../domain/layout.js';

/** `{DC name} > 2F > R03-C12 > {hostname}`; each item is a `[data-level]` button → store.goLevel (root = DC overview). */
export function createBreadcrumb(root, store) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) store.goLevel(b.dataset.level);
  });

  function render(state) {
    const parts = [['root', store.getDc(state.dc)?.name ?? '데이터센터']];
    if (state.floor) parts.push(['floor', state.floor]);
    const r = state.rack && store.getRack(state.rack);
    if (r) parts.push(['rack', rackLabel(r.rack)]);
    const s = state.server && store.getServer(state.server);
    if (s) parts.push(['server', s.server.hostname]);
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
