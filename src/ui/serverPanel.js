import { el } from './dom.js';
import { locationLabel } from '../domain/layout.js';

export const STATUS_TEXT = { ok: '정상', warn: '경고', down: '중단', unknown: '알수없음' };

/**
 * Server details inside #panel, below the elevation (server mode only). textContent only.
 * Adds `.with-server` to the panel so the elevation compacts and both stay visible.
 */
export function createServerPanel(panel, store) {
  const root = el('section', { id: 'server-detail' });
  panel.append(root);
  let serverId = null;

  function field(k, label, value) {
    const row = el('div', { class: 'row' });
    row.append(el('span', { class: 'k' }, label), el('span', { class: 'v', 'data-k': k }, value ?? '—'));
    return row;
  }

  function build({ server, rack, floor }, dc) {
    const list = el('ul', { class: 'services' });
    for (const svc of server.services) {
      const status = STATUS_TEXT[svc.status] ? svc.status : 'unknown';
      const li = el('li', { class: 'service', 'data-status': status });
      li.append(
        el('span', { class: 'name', 'data-k': 'name' }, svc.name),
        el('span', { class: 'team', 'data-k': 'team' }, svc.team ?? '—'),
        el('span', { class: `badge status-${status}`, 'data-k': 'status' }, STATUS_TEXT[status]),
      );
      list.append(li);
    }
    root.replaceChildren(
      el('h2', { 'data-k': 'hostname' }, server.hostname),
      field('dc', '데이터센터', dc?.name),
      field('ip', 'IP', server.ip),
      field('location', '위치', locationLabel(floor, rack, server)),
      field('height', '높이', `${server.height_u || 1}U`),
      el('h3', {}, `서비스 (${server.services.length})`),
      server.services.length ? list : el('div', { class: 'none' }, '서비스 없음'),
    );
  }

  function render(state) {
    const s = store.modeOf(state) === 'server' ? store.getServer(state.server) : null;
    root.hidden = !s;
    panel.classList.toggle('with-server', Boolean(s));
    if (!s) {
      serverId = null;
      root.replaceChildren();
      return;
    }
    // Server ids may repeat across DCs, so the cache key carries the DC.
    const key = `${store.revision}\u0000${state.dc}\u0000${state.server}`;
    if (serverId !== key) {
      build(s, store.getDc(state.dc));
      serverId = key;
    }
  }
  return { render, root };
}
