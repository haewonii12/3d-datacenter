import { el, issueItem } from './dom.js';

/** Group titles, in display order (unknown kinds go last under "기타"). */
export const KIND_TITLE = {
  'mount-overlap': '장비 겹침',
  'mount-crowded': '한 U에 3대 이상',
  'rack-cell-conflict': '상면 중복',
  'rack-noncontiguous': '연속되지 않은 상면',
  'position-invalid': '장착 위치 오류',
  'floorspace-invalid': 'floorspace 오류',
  'floorspace-floor-mismatch': '층 불일치',
  'rack-floorspace-mismatch': '랙 floorspace 불일치',
  'unknown-build': '미등록 데이터센터',
  'record-invalid': '레코드 오류',
};

/**
 * `⚠ N` badge toggling the warning list, grouped by kind. An item with a `target` is a button that
 * navigates there (`onPick(target)`); the footer shows a short summary.
 */
export function renderWarnings({ badge, list, info, onPick }, warnings, infoData) {
  const bad = infoData?.invalidPositions ?? 0;
  info.textContent = bad > 0 ? `장착 위치 오류 장비 ${bad}대 (화면에 그리지 않음)` : '';
  badge.title = info.textContent;
  badge.onclick = () => {
    list.hidden = !list.hidden;
  };
  if (!warnings.length) {
    badge.hidden = true;
    list.hidden = true;
    list.replaceChildren();
    return;
  }
  badge.textContent = `⚠ ${warnings.length}`;
  badge.hidden = false;
  const groups = new Map();
  for (const w of warnings) {
    const k = KIND_TITLE[w.kind] ? w.kind : 'other';
    groups.set(k, [...(groups.get(k) || []), w]);
  }
  const order = [...Object.keys(KIND_TITLE), 'other'].filter((k) => groups.has(k));
  const nodes = [];
  for (const k of order) {
    const items = groups.get(k);
    nodes.push(el('li', { class: 'warn-group', 'data-kind': k }, `${KIND_TITLE[k] ?? '기타'} (${items.length})`));
    for (const w of items) {
      const li = issueItem(w);
      li.dataset.kind = k;
      if (w.target && onPick) {
        li.classList.add('pickable');
        li.tabIndex = 0;
        li.title = '클릭하면 해당 위치로 이동합니다';
        const go = () => {
          list.hidden = true;
          onPick(w.target);
        };
        li.addEventListener('click', go);
        li.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      }
      nodes.push(li);
    }
  }
  list.replaceChildren(...nodes);
}
