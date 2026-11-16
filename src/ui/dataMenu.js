import { el } from './dom.js';

/**
 * Topbar data controls: 편집 toggle, 데이터 ▾ menu (불러오기 / 내보내기 / 원본으로 되돌리기), a status
 * line, and drag-and-drop of a .json file anywhere on the page.
 * @param {{onFile:(file:File)=>void, onExport:()=>void, onReset:()=>void, onEditToggle:(on:boolean)=>void}} actions
 */
export function createDataMenu(topbar, { onFile, onExport, onExportCsv, onReset, onEditToggle }) {
  const edit = el('button', { type: 'button', id: 'edit-toggle', 'aria-pressed': 'false', title: '편집 모드' }, '편집');
  const toggle = el('button', { type: 'button', id: 'data-menu-btn', 'aria-haspopup': 'true' }, '데이터 ▾');
  const file = el('input', { type: 'file', id: 'file-input', accept: '.json,.csv,.tsv,.txt,application/json,text/csv', hidden: true });
  const item = (id, text) => el('button', { type: 'button', class: 'menu-item', 'data-action': id }, text);
  const menu = el('div', { id: 'data-menu', role: 'menu', hidden: true });
  menu.append(
    item('upload', '파일 불러오기… (JSON / CSV)'),
    item('export', 'JSON 내보내기'),
    item('export-csv', 'CSV 내보내기 (Excel)'),
    item('reset', '원본으로 되돌리기'),
  );
  const status = el('span', { id: 'data-status' });
  const wrap = el('div', { id: 'data-wrap' });
  wrap.append(status, edit, toggle, menu, file);
  topbar.append(wrap);

  const drop = el('div', { id: 'drop-overlay', hidden: true }, 'JSON / CSV 파일을 놓으면 불러옵니다');
  document.body.append(drop);

  let editing = false;
  const setEditing = (on) => {
    editing = on;
    edit.classList.toggle('on', on);
    edit.setAttribute('aria-pressed', String(on));
    edit.textContent = on ? '편집 종료' : '편집';
  };
  edit.addEventListener('click', () => {
    setEditing(!editing);
    onEditToggle(editing);
  });

  const close = () => {
    menu.hidden = true;
  };
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) close();
  });
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    close();
    if (action === 'upload') file.click();
    else if (action === 'export') onExport();
    else if (action === 'export-csv') onExportCsv();
    else if (action === 'reset') onReset();
  });
  file.addEventListener('change', () => {
    if (file.files[0]) onFile(file.files[0]);
    file.value = ''; // the same file can be chosen again
  });

  // Drag-and-drop: a depth counter, because dragenter/leave fire for every child element crossed.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    drop.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) drop.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault(); // allows the drop
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });

  return {
    /** @param {string} text @param {'ok'|'dirty'|'error'} [kind] */
    setStatus(text, kind = 'ok') {
      status.textContent = text;
      status.dataset.kind = kind;
    },
    setEditing,
    /** Edit toggle is disabled until a dataset is loaded. */
    setEnabled(on) {
      edit.disabled = !on;
      for (const b of menu.querySelectorAll('[data-action^=export]')) b.disabled = !on;
    },
  };
}
