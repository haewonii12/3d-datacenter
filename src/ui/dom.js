/** Creates an element; text is set via textContent only (never innerHTML). */
export function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('data-')) e.setAttribute(k, v);
    else e[k] = v;
  }
  if (text != null) e.textContent = String(text);
  return e;
}

/** <li><span class="path">path</span>message</li> */
export function issueItem({ path, message }) {
  const li = el('li');
  li.append(el('span', { class: 'path' }, path), document.createTextNode(message));
  return li;
}
