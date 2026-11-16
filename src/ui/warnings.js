import { issueItem } from './dom.js';

/** `⚠ N` badge toggling a path/message list; Info (missing height_u) goes to the footer. */
export function renderWarnings({ badge, list, info }, warnings, infoData) {
  const missing = infoData?.missingHeightU ?? 0;
  info.textContent = missing > 0 ? `height_u 누락 서버 ${missing}대 (1U로 처리)` : '';
  badge.title = info.textContent;
  badge.onclick = () => {
    list.hidden = !list.hidden;
  };
  if (!warnings.length) {
    badge.hidden = true;
    list.hidden = true;
    return;
  }
  badge.textContent = `⚠ ${warnings.length}`;
  badge.hidden = false;
  list.replaceChildren(...warnings.map(issueItem));
}
