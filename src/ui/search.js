import { el } from './dom.js';
import { buildIndex, search } from '../domain/search.js';

const TYPE_TAG = { hostname: '호스트', service: '서비스' };
const DEBOUNCE_MS = 150;

/**
 * Search box over every DC: debounced dropdown of ≤20 results, ↑/↓ + Enter or click → navigate to
 * {dc, floor, rack, server} (switches DC when needed).
 * ESC clears + blurs without touching the view state.
 * @param {{input:HTMLInputElement, list:HTMLElement, wrap:HTMLElement}} els
 */
export function createSearch({ input, list, wrap }, store) {
  let index = null;
  let indexRev = null;
  let results = [];
  let active = -1;
  let timer = null;

  function close() {
    results = [];
    active = -1;
    list.replaceChildren();
    list.hidden = true;
  }

  function setActive(i) {
    active = i;
    list.querySelectorAll('.result').forEach((li, k) => li.classList.toggle('active', k === i));
    list.querySelector('.result.active')?.scrollIntoView({ block: 'nearest' });
  }

  function run() {
    clearTimeout(timer);
    timer = null;
    const q = input.value.trim();
    if (!q) return close();
    if (indexRev !== store.revision) {
      index = buildIndex(store.data); // rebuilt lazily after uploads/edits
      indexRev = store.revision;
    }
    results = search(index, q, 20, store.state.dc);
    if (!results.length) {
      list.replaceChildren(el('li', { class: 'no-result' }, '결과 없음'));
      list.hidden = false;
      active = -1;
      return;
    }
    list.replaceChildren(
      ...results.map((r, i) => {
        const li = el('li', { class: 'result', 'data-type': r.type, 'data-server-id': r.serverId, 'data-dc-id': r.dcId, 'data-i': String(i) });
        li.append(el('span', { class: 'label' }, r.label), el('span', { class: 'sub' }, r.sub), el('span', { class: 'tag' }, TYPE_TAG[r.type]));
        return li;
      }),
    );
    list.hidden = false;
    setActive(0);
  }

  function choose(i) {
    const r = results[i];
    if (!r) return;
    input.value = '';
    close();
    input.blur();
    store.navigate({ dc: r.dcId, floor: r.floorId, rack: r.rackId, server: r.serverId });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Stop here: the global ESC handler (view "up") must not see this key.
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(timer);
      input.value = '';
      close();
      input.blur();
      return;
    }
    const pending = timer !== null;
    if (pending && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) run();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pending || !results.length) return; // just-flushed list starts at the first item
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim() && list.hidden) run();
  });

  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input while clicking
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.result');
    if (li) choose(Number(li.dataset.i));
  });

  document.addEventListener('pointerdown', (e) => {
    if (!list.hidden && !wrap.contains(e.target)) close();
  });

  close();
  return { close };
}
