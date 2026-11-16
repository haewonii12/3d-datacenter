import { el } from './dom.js';
import { BAND_COLORS, floorStats } from '../domain/occupancy.js';

/** #floor-summary: visible only in floor mode; numbers from floorStats of the current DC's floor. */
export function createFloorSummary(root, store) {
  function render(state) {
    if (store.modeOf(state) !== 'floor') {
      root.hidden = true;
      return;
    }
    const s = floorStats(store.getFloor(state.floor, state.dc));
    const row = (label, k, v) => {
      const r = el('div', { class: 'row' });
      r.append(el('span', { class: 'k' }, label), el('span', { 'data-k': k }, v));
      return r;
    };
    const slots = el('div', { class: 'row' });
    const counts = el('span');
    counts.append(el('span', { 'data-k': 'racks' }, s.racks), ' / ', el('span', { 'data-k': 'slots' }, s.slots));
    slots.append(el('span', { class: 'k' }, '랙 / 슬롯'), counts);
    const bands = el('div', { class: 'row bands' });
    for (const b of ['green', 'yellow', 'red']) {
      const span = el('span', { class: 'band' });
      const dot = el('span', { class: 'dot' });
      dot.style.background = BAND_COLORS[b];
      span.append(dot, el('span', { 'data-k': b }, s.bands[b]));
      bands.append(span);
    }
    root.replaceChildren(
      el('h2', {}, state.floor),
      slots,
      row('평균 점유율', 'avg', `${Math.round(s.avg * 100)}%`),
      bands,
    );
    root.hidden = false;
  }
  return { render };
}
