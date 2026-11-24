import { el } from './dom.js';
import { locationLabel, deviceLabel } from '../domain/layout.js';

/**
 * Device details inside #panel, below the elevation (server mode only). textContent only.
 * Adds `.with-server` to the panel so the elevation compacts and both stay visible.
 */
export function createServerPanel(panel, store) {
  const root = el('section', { id: 'server-detail' });
  panel.append(root);
  let serverId = null;

  function field(k, label, value) {
    const row = el('div', { class: 'row' });
    row.append(el('span', { class: 'k' }, label), el('span', { class: 'v', 'data-k': k }, value || '—'));
    return row;
  }

  function build({ server, rack, floor }, dc) {
    const parts = [
      el('h2', { 'data-k': 'device_name' }, deviceLabel(server)),
      field('company', '회사', server.company),
      field('build_name', '데이터센터', dc?.name),
      field('rack_name', '랙', rack.name || rack.id),
      field('floorspace_name', '상면', rack.floorspaces.join(',')),
      field('device_position', '장착 위치', server.device_position),
      field('location', '위치', `${floor.id} · ${locationLabel(floor, rack, server)}`),
    ];
    const reasons = [...(server.invalid ? ['장착 위치를 해석할 수 없어 랙에 그리지 않습니다'] : []), ...(server.violation || [])];
    if (reasons.length) {
      const list = el('ul', { class: 'violations', 'data-k': 'violations' });
      for (const r of reasons) list.append(el('li', {}, r));
      parts.push(el('h3', { class: 'violation-title' }, '⚠ 규칙 위반'), list);
    }
    root.replaceChildren(...parts);
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
    // Device ids may repeat across DCs, so the cache key carries the DC.
    const key = `${store.revision}\u0000${state.dc}\u0000${state.server}`;
    if (serverId !== key) {
      build(s, store.getDc(state.dc));
      serverId = key;
    }
  }
  return { render, root };
}
