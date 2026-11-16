import './style.css';
import { loadDataset, resolveDataUrl, parseDataset, checkDataset, isCsvName, parseCsvDataset } from './data/load.js';
import { datasetToCsv } from './data/csv.js';
import { toPlain } from './data/edit.js';
import { loadSaved, save, clearSaved } from './data/persist.js';
import { createStore, bindHash } from './state/store.js';
import { renderError } from './ui/error.js';
import { renderWarnings } from './ui/warnings.js';
import { createFloorSummary } from './ui/floorSummary.js';
import { createBreadcrumb } from './ui/breadcrumb.js';
import { createDcSelect } from './ui/dcSelect.js';
import { createDataMenu } from './ui/dataMenu.js';
import { createEditor } from './ui/editor.js';
import { createSetup } from './scene/setup.js';
import { buildRacks } from './scene/racks.js';
import { createView } from './scene/view.js';
import { createRackDetail } from './scene/rackDetail.js';
import { createTooltip } from './ui/tooltip.js';
import { createElevation } from './ui/elevation.js';
import { createServerPanel } from './ui/serverPanel.js';
import { createSearch } from './ui/search.js';
import { createPicking } from './scene/picking.js';
import { debugEnabled, installDebug } from './debug.js';

const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const dataUrl = resolveDataUrl(location.search);

/** Built once, on the first valid dataset; later datasets (upload, edit, reset) go through store.setData. */
let ui = null;
/** Where the current dataset came from: the data URL, or an uploaded file's name. */
let source = dataUrl;

function install(data) {
  const store = createStore({ data, location: window.location, history: window.history });

  // Stable containers for the current DC's scene objects; applyView fills them (only one DC is built).
  const setup = createSetup($('#viewport'));
  const floors = new Map();
  const racks = buildRacks(floors);
  const detail = createRackDetail({ scene: setup.scene, racks });
  const view = createView({
    scene: setup.scene,
    floors,
    racks,
    controls: setup.controls,
    onTick: setup.onTick,
    detail,
    getDc: (id) => store.getDc(id),
    getRevision: () => store.revision,
  });

  const panel = $('#panel');
  const dcSelect = createDcSelect($('#dc-select'), store);
  const summary = createFloorSummary($('#floor-summary'), store);
  const breadcrumb = createBreadcrumb($('#breadcrumb'), store);
  const tooltip = createTooltip($('#tooltip'), store);
  const editor = createEditor(panel, store, { commit: (next) => commitEdit(next) });
  const elevation = createElevation(panel, store, { onEmptyUnit: (u) => editor.pickUnit(u) });
  const serverPanel = createServerPanel(panel, store);
  panel.append(editor.root); // below the elevation / server details
  createSearch({ input: $('#search'), list: $('#search-results'), wrap: $('#search-wrap') }, store);

  const renderPanels = (state) => {
    elevation.render(state);
    serverPanel.render(state);
    editor.render(state);
    panel.hidden = [...panel.children].every((c) => c.hidden);
  };
  store.subscribe((prev, next) => view.applyView(prev, next));
  store.subscribe((_, next) => {
    dcSelect.render(next);
    summary.render(next);
    breadcrumb.render(next);
    renderPanels(next);
    tooltip.hide();
  });

  const picking = createPicking({
    dom: setup.renderer.domElement,
    camera: setup.camera,
    floors,
    racks,
    store,
    detail,
    onHover: (hit, at) => tooltip.update(hit, at),
    interceptClick: (hit, mode) => editor.interceptClick(hit, mode),
  });
  if (debugEnabled()) {
    const dom = setup.renderer.domElement;
    const api = installDebug({ store, view, floors, racks, detail, picking, camera: setup.camera, controls: setup.controls, dom, renderer: setup.renderer });
    api.extend({ revision: () => store.revision, data: () => toPlain(store.data) });
  }

  // ESC = up one level, except while typing (search clears/blurs itself; editor controls keep focus).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const active = document.activeElement;
    if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.closest?.('#editor')) return;
    store.up();
  });
  // The first apply (prev state has dc=null) builds the DC and places everything without animation.
  bindHash(store, window);
  return { store, editor, renderPanels };
}

const menu = createDataMenu($('#topbar'), {
  onFile: (file) => uploadFile(file),
  onExport: () => exportJson(),
  onExportCsv: () => exportCsv(),
  onReset: () => resetToOriginal(),
  onEditToggle: (on) => {
    if (!ui) return;
    ui.editor.setEditing(on);
    ui.renderPanels(ui.store.state);
  },
});

const savedText = (src) => (src === dataUrl ? '수정됨 · 브라우저에 저장' : `${src} · 브라우저에 저장`);

/**
 * Shows a load/validate result. Fatal → error (dismissible when a dataset is already shown; it stays);
 * otherwise installs the app or swaps its dataset.
 * @returns {boolean} accepted
 */
function accept(result, { reset = false, title } = {}) {
  if (result.fatal.length) {
    renderError($('#error'), result.fatal, { dismissible: Boolean(ui), ...(title ? { title } : {}) });
    if (!ui) app.dataset.ready = 'error';
    return false;
  }
  $('#error').hidden = true;
  renderWarnings({ badge: $('#warnings'), list: $('#warnings-list'), info: $('#info') }, result.warnings, result.info);
  if (!ui) ui = install(result.data);
  else ui.store.setData(result.data, { reset });
  menu.setEnabled(true);
  app.dataset.ready = 'ok';
  return true;
}

async function persist() {
  app.dataset.saved = 'pending';
  const err = await save(toPlain(ui.store.data), source);
  menu.setStatus(err ? '브라우저 저장 실패 — JSON 내보내기로 보관하세요' : savedText(source), err ? 'error' : 'dirty');
  app.dataset.saved = err ? 'error' : 'ok';
}

/** Editor commit: re-validate (recomputes `invalid` flags), swap, persist. */
function commitEdit(next) {
  if (accept(checkDataset(toPlain(next)), { title: '수정을 적용할 수 없습니다' })) persist();
}

async function uploadFile(file) {
  app.dataset.upload = 'pending';
  const result = isCsvName(file.name)
    ? parseCsvDataset(new Uint8Array(await file.arrayBuffer()), file.name)
    : parseDataset(await file.text(), file.name);
  if (!accept(result, { reset: true, title: `${file.name}을(를) 불러올 수 없습니다` })) {
    app.dataset.upload = 'error';
    return;
  }
  source = file.name;
  await persist();
  app.dataset.upload = 'ok';
}

function download(text, type, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = (source === dataUrl ? 'datacenter' : source.replace(/\.(json|csv|tsv|txt)$/i, '')) + ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportJson() {
  if (ui) download(JSON.stringify(toPlain(ui.store.data), null, 2), 'application/json', '.json');
}

function exportCsv() {
  if (ui) download(datasetToCsv(ui.store.data), 'text/csv;charset=utf-8', '.csv');
}

async function resetToOriginal() {
  if (!window.confirm('브라우저에 저장된 변경을 버리고 원본 데이터로 되돌릴까요?')) return;
  app.dataset.saved = 'pending';
  await clearSaved();
  source = dataUrl;
  if (accept(await loadDataset(dataUrl), { reset: true })) menu.setStatus('');
  app.dataset.saved = 'cleared';
}

async function main() {
  menu.setEnabled(false);
  // A saved (edited/uploaded) dataset wins, unless the URL names a file with ?data=.
  const saved = new URLSearchParams(location.search).has('data') ? null : await loadSaved();
  if (saved && accept(checkDataset(saved.data))) {
    source = saved.source || dataUrl;
    menu.setStatus(savedText(source), 'dirty');
    return;
  }
  accept(await loadDataset(dataUrl));
}

main().catch((e) => {
  renderError($('#error'), [{ path: 'app', message: String(e && e.message ? e.message : e) }]);
  app.dataset.ready = 'error';
  console.error(e);
});
