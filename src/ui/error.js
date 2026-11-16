import { el, issueItem } from './dom.js';

/** Shows every fatal issue with its path. `dismissible` adds a close button (the current data stays loaded). */
export function renderError(root, fatal, { dismissible = false, title = '데이터를 불러올 수 없습니다' } = {}) {
  const list = el('ul');
  for (const issue of fatal) list.append(issueItem(issue));
  const nodes = [el('h2', {}, title), list];
  if (dismissible) {
    const close = el('button', { type: 'button', class: 'error-close' }, '닫기');
    close.addEventListener('click', () => {
      root.hidden = true;
    });
    nodes.push(el('p', { class: 'error-note' }, '기존 데이터는 그대로 유지됩니다.'), close);
  }
  root.replaceChildren(...nodes);
  root.hidden = false;
}
