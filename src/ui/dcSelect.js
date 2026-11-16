import { el } from './dom.js';

/** `4개 층 · 랙 804 · 서버 5205` */
export function dcCountsText(dc) {
  const racks = dc.floors.reduce((a, f) => a + f.racks.length, 0);
  const servers = dc.floors.reduce((a, f) => a + f.racks.reduce((b, r) => b + r.servers.length, 0), 0);
  return `${dc.floors.length}개 층 · 랙 ${racks} · 서버 ${servers}`;
}

/**
 * <select id="dc-select">: one option per DC (text = name, title = counts). Change → store.selectDc;
 * render(state) keeps it on state.dc (back/forward, hash edits, search jumps).
 */
export function createDcSelect(select, store) {
  let rev = null;
  select.addEventListener('change', () => store.selectDc(select.value));

  function render(state) {
    if (rev !== store.revision) {
      // Names / counts / the DC list itself change with uploads and edits.
      select.replaceChildren(
        ...store.datacenters.map((dc) => el('option', { value: dc.id, title: dcCountsText(dc), 'data-dc': dc.id }, dc.name)),
      );
      rev = store.revision;
    }
    if (select.value !== state.dc) select.value = state.dc;
    select.title = select.selectedOptions[0]?.title ?? '';
  }
  return { render };
}
