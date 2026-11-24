// Map entry screen: bundled 서울·경기·인천 시군구 boundaries (no network), one pin per known IDC site,
// and a side list (registered sites + "미등록 DC" for builds without a pin). SVG built with textContent only.
import { el } from './dom.js';
import geo from '../geo/seoul-gyeonggi.geo.json';
import { SITES, siteOf } from '../domain/sites.js';
import { countUnder } from '../data/edit.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 1000;
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** Equirectangular projection fitted to the boundary bbox (x scaled by cos(mid-latitude)). */
export function makeProjection(features, width = W, pad = 20) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      x0 = Math.min(x0, c[0]);
      x1 = Math.max(x1, c[0]);
      y0 = Math.min(y0, c[1]);
      y1 = Math.max(y1, c[1]);
    } else c.forEach(visit);
  };
  for (const f of features) visit(f.geometry.coordinates);
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const scale = (width - 2 * pad) / ((x1 - x0) * k);
  const height = Math.round((y1 - y0) * scale + 2 * pad);
  const project = (lng, lat) => [pad + (lng - x0) * k * scale, pad + (y1 - lat) * scale];
  return { project, width, height };
}

function pathOf(geometry, project) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let d = '';
  for (const poly of polys)
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const [x, y] = project(lng, lat);
        d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      d += 'Z';
    }
  return d;
}

/** {floors, racks, devices} of a datacenter. */
export function dcCounts(dc) {
  const c = countUnder(dc);
  return { floors: c.floors, racks: c.racks, devices: c.servers };
}

export const pinText = (dc) => {
  const c = dcCounts(dc);
  return `${dc.name} · 층 ${c.floors} · 랙 ${c.racks} · 장비 ${c.devices}`;
};

/**
 * @param {HTMLElement} root #map-view container
 * @param {any} store
 */
export function createMapView(root, store) {
  // Fit to 서울(11)·경기(31); Incheon (23) is drawn for context but its far islands do not shrink the map.
  const proj = makeProjection(geo.features.filter((f) => !f.properties.code.startsWith('23')));
  const svg = svgEl('svg', { viewBox: `0 0 ${proj.width} ${proj.height}`, class: 'map-svg', role: 'img', 'aria-label': '서울·경기 데이터센터 지도', overflow: 'hidden' });
  const land = svgEl('g', { class: 'map-land' });
  for (const f of geo.features) {
    const p = svgEl('path', { d: pathOf(f.geometry, proj.project), class: `map-area region-${f.properties.code.slice(0, 2)}`, 'data-name': f.properties.name });
    const t = svgEl('title');
    t.textContent = `${f.properties.region} ${f.properties.name}`;
    p.append(t);
    land.append(p);
  }
  const pins = svgEl('g', { class: 'map-pins' });
  svg.append(land, pins);
  const tip = el('div', { class: 'map-tip', hidden: true });
  const stage = el('div', { class: 'map-stage' });
  stage.append(svg, tip);
  const list = el('aside', { class: 'map-list' });
  const title = el('h1', { class: 'map-title' }, '데이터센터 선택');
  const hint = el('p', { class: 'map-hint' }, '지도의 핀이나 목록에서 데이터센터를 고르세요.');
  const side = el('div', { class: 'map-side' });
  side.append(title, hint, list);
  root.append(stage, side);
  let rev = null;
  let rendered = false;

  function showTip(dc, evt) {
    tip.textContent = pinText(dc);
    const r = stage.getBoundingClientRect();
    tip.style.left = `${evt.clientX - r.left + 14}px`;
    tip.style.top = `${evt.clientY - r.top + 14}px`;
    tip.hidden = false;
  }

  function build() {
    pins.replaceChildren();
    const known = [];
    const unknown = [];
    for (const dc of store.datacenters) (siteOf(dc) ? known : unknown).push(dc);
    for (const dc of known) {
      const site = siteOf(dc);
      const [x, y] = proj.project(site.lng, site.lat);
      const g = svgEl('g', { class: 'map-pin', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-dc': dc.id, tabindex: 0, role: 'button' });
      g.append(svgEl('circle', { r: 20, class: 'pin-halo' }), svgEl('circle', { r: 10, class: 'pin-dot' }));
      const tag = site.tag ?? { dx: 14, dy: -14, anchor: 'start' };
      const label = svgEl('text', { x: tag.dx, y: tag.dy, 'text-anchor': tag.anchor, class: 'pin-label' });
      label.textContent = dc.name;
      g.append(label);
      g.addEventListener('pointerenter', (e) => showTip(dc, e));
      g.addEventListener('pointermove', (e) => showTip(dc, e));
      g.addEventListener('pointerleave', () => (tip.hidden = true));
      g.addEventListener('click', () => store.selectDc(dc.id));
      g.addEventListener('keydown', (e) => e.key === 'Enter' && store.selectDc(dc.id));
      pins.append(g);
    }
    // Known sites with no data: a grey pin so the map still shows all three locations.
    for (const [name, site] of Object.entries(SITES)) {
      if (known.some((dc) => dc.name === name || dc.id === name)) continue;
      const [x, y] = proj.project(site.lng, site.lat);
      const g = svgEl('g', { class: 'map-pin empty', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-site': name });
      g.append(svgEl('circle', { r: 7, class: 'pin-dot' }));
      const label = svgEl('text', { x: 12, y: -12, class: 'pin-label' });
      label.textContent = `${name} (데이터 없음)`;
      g.append(label);
      pins.append(g);
    }
    const item = (dc, cls) => {
      const c = dcCounts(dc);
      const b = el('button', { type: 'button', class: `map-item ${cls}`, 'data-dc': dc.id });
      b.append(el('span', { class: 'name' }, dc.name), el('span', { class: 'meta' }, `층 ${c.floors} · 랙 ${c.racks} · 장비 ${c.devices}`));
      b.addEventListener('click', () => store.selectDc(dc.id));
      return b;
    };
    const nodes = [el('h2', {}, `등록 데이터센터 (${known.length})`), ...known.map((dc) => item(dc, 'known'))];
    if (unknown.length) {
      nodes.push(el('h2', { class: 'unknown-title' }, `미등록 DC (${unknown.length})`), el('p', { class: 'map-hint' }, '지도에 위치가 없는 데이터센터입니다.'));
      nodes.push(...unknown.map((dc) => item(dc, 'unknown')));
    }
    list.replaceChildren(...nodes);
  }

  function render(state) {
    const show = state.dc == null;
    root.hidden = !show;
    document.body.classList.toggle('map-mode', show);
    if (!show) {
      tip.hidden = true;
      return;
    }
    if (rev !== store.revision) {
      build();
      rev = store.revision;
    }
    rendered = true;
  }

  return {
    render,
    /** True once the SVG for the current data is in the DOM (e2e settle check in map mode). */
    isSettled: () => rendered && rev === store.revision && land.childElementCount > 0,
  };
}
