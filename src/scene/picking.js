import * as THREE from 'three';

const CLICK_MAX_PX = 5;
const CLICK_MAX_MS = 300;

/**
 * Click/hover detection + per-mode pick targets. Raycaster ignores `visible`, so targets are explicit.
 * @param {{dom:HTMLElement, camera:THREE.Camera, floors:Map<string,any>, racks:any, store:any, detail:any, onHover?:Function}} deps
 */
export function createPicking({ dom, camera, floors, racks, store, detail, onHover, interceptClick }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** Single-pass targets for overview/floor; pass-2 targets for rack/server. */
  function targetsFor(state, mode) {
    const of = (id) => [racks.byFloor.get(id).mesh, floors.get(id).slab];
    if (mode === 'overview') return [...floors.keys()].flatMap(of);
    if (mode === 'floor') return of(state.floor);
    return [detail.proxy, ...of(state.floor)].filter(Boolean);
  }

  const rackOf = (hit) => {
    const ud = hit.object.userData;
    if (ud.kind !== 'racks' || hit.instanceId == null) return null;
    const id = racks.rackIdAt(ud.floorId, hit.instanceId);
    return id && !racks.isHidden(id) ? id : null;
  };

  /**
   * @returns {{kind:'server'|'selectedRack'|'rack'|'slab', id:string}|null}
   * overview/floor: nearest rack or slab. rack/server: 2-pass — selected rack's servers first, then
   * fixed priority (not distance) selectedRack > other rack > slab.
   */
  function pick(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const state = store.state;
    const mode = store.mode();
    if (mode === 'rack' || mode === 'server') {
      const s = raycaster.intersectObjects(detail.serverMeshList(), false)[0];
      if (s) return { kind: 'server', id: s.object.userData.id };
      const hits = raycaster.intersectObjects(targetsFor(state, mode), false);
      const sel = hits.find((h) => h.object.userData.kind === 'selectedRack');
      if (sel) return { kind: 'selectedRack', id: sel.object.userData.id };
      for (const h of hits) {
        const id = rackOf(h);
        if (id) return { kind: 'rack', id };
      }
      const slab = hits.find((h) => h.object.userData.kind === 'slab');
      return slab ? { kind: 'slab', id: slab.object.userData.floorId, point: slab.point } : null;
    }
    for (const hit of raycaster.intersectObjects(targetsFor(state, mode), false)) {
      const id = rackOf(hit);
      if (id) return { kind: 'rack', id };
      if (hit.object.userData.kind === 'slab') return { kind: 'slab', id: hit.object.userData.floorId, point: hit.point };
    }
    return null;
  }

  function onClick(clientX, clientY) {
    const mode = store.mode();
    const hit = pick(clientX, clientY);
    if (interceptClick?.(hit, mode)) return; // edit mode claims some clicks (e.g. an empty slot)
    if (hit?.kind === 'server') store.selectServer(hit.id);
    else if (hit?.kind === 'selectedRack') return; // selected rack's empty U: no-op
    else if (hit?.kind === 'rack') store.openRack(hit.id);
    else if (mode === 'overview' && hit?.kind === 'slab') store.enterFloor(hit.id);
    else if (mode !== 'overview' || !hit) store.up(); // "빈공간": nothing, or slab only (floor/rack/server)
  }

  // Hover: throttled to one pick per animation frame; suppressed while a button is held (orbit).
  let hoverAt = null;
  let raf = 0;
  const onMove = (e) => {
    if (!onHover) return;
    hoverAt = e.buttons ? null : { x: e.clientX, y: e.clientY };
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        onHover(hoverAt && pick(hoverAt.x, hoverAt.y), hoverAt);
      });
    }
  };
  const onLeave = () => {
    hoverAt = null;
    onHover?.(null, null);
  };
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerleave', onLeave);

  let down = null;
  const onDown = (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e) => {
    if (!down || e.button !== 0) return;
    const d = down;
    down = null;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved < CLICK_MAX_PX && performance.now() - d.t < CLICK_MAX_MS) onClick(e.clientX, e.clientY);
  };
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);

  // Floor labels are DOM elements (pointer-events:auto) and enter their floor directly. Delegated on the
  // viewport so labels rebuilt on a DC switch need no listeners of their own.
  const labelHost = dom.parentElement;
  const onLabelClick = (e) => {
    const el = e.target.closest?.('.floor-label');
    if (!el || !floors.has(el.dataset.floor)) return;
    e.stopPropagation();
    if (store.mode() === 'overview') store.enterFloor(el.dataset.floor);
  };
  labelHost?.addEventListener('click', onLabelClick);

  return {
    pick,
    targetsFor,
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      labelHost?.removeEventListener('click', onLabelClick);
      cancelAnimationFrame(raf);
    },
  };
}
