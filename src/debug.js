import * as THREE from 'three';
import { frontNormal } from './domain/layout.js';

/** True in dev builds or when the URL has a `debug` query param. */
export function debugEnabled(search = location.search) {
  return Boolean(import.meta.env.DEV) || new URLSearchParams(search).has('debug');
}

const xyz = (v) => ({ x: v.x, y: v.y, z: v.z });

/**
 * Installs window.__dc (test/debug hook).
 * @param {{store:any, view:any, floors:Map<string,any>, racks:any, detail:any, picking:any, camera:THREE.Camera, controls:any, dom:HTMLElement, renderer:THREE.WebGLRenderer}} ctx
 */
export function installDebug(ctx) {
  const { store, view, floors, racks, detail, picking, camera, controls, dom, renderer } = ctx;
  const v = new THREE.Vector3();

  /** Projects a world point to page CSS pixels; null if behind the camera. */
  function toScreen(world) {
    camera.updateMatrixWorld();
    v.copy(world).project(camera);
    if (v.z < -1 || v.z > 1) return null;
    const r = dom.getBoundingClientRect();
    return { x: r.left + window.scrollX + ((v.x + 1) / 2) * r.width, y: r.top + window.scrollY + ((1 - v.y) / 2) * r.height };
  }

  const api = {
    state: () => ({ ...store.state }),
    mode: () => store.mode(),
    navigate: (s) => store.navigate(s),
    /** Current state.dc / all DC ids in file order / the DC whose scene objects are built. */
    currentDc: () => store.state.dc,
    dcIds: () => store.datacenters.map((d) => d.id),
    builtDc: () => view.builtDc,
    /** Ids of the floors built in the scene (current DC only). */
    builtFloorIds: () => [...floors.keys()],
    /** renderer.info.memory: {geometries, textures} live on the GPU (dispose check). */
    gpuMemory: () => ({ ...renderer.info.memory }),
    visibleRackIds() {
      const out = [];
      for (const [id, f] of floors) {
        if (!f.group.visible) continue;
        for (const rackId of racks.byFloor.get(id).idToRack) if (!racks.isHidden(rackId)) out.push(rackId);
      }
      return out;
    },
    rackInstanceColor: (id) => racks.instanceColorHex(id),
    emptySlotCount: (floorId) => floors.get(floorId)?.emptyCount ?? null,
    floorOpacity: (id) => view.floorOpacity(id),
    floorVisible: (id) => floors.get(id)?.group.visible ?? null,
    isSettled: () => view.isSettled(),
    camera() {
      const p = controls.getPosition(new THREE.Vector3(), false);
      const t = controls.getTarget(new THREE.Vector3(), false);
      return { position: xyz(p), target: xyz(t) };
    },
    rackScreenPos(id) {
      const c = racks.rackCenter(id);
      return c ? toScreen(c) : null;
    },
    floorLabelScreenPos(id) {
      const f = floors.get(id);
      if (!f || !f.labelEl.isConnected || f.labelEl.style.display === 'none') return null;
      const r = f.labelEl.getBoundingClientRect();
      return { x: r.left + window.scrollX + r.width / 2, y: r.top + window.scrollY + r.height / 2 };
    },
    /** World center of a rack (also for hidden / faded instances). */
    rackCenter(id) {
      const c = racks.rackCenter(id);
      return c ? xyz(c) : null;
    },
    frontNormal(id) {
      const e = racks.index.get(id);
      return e ? frontNormal(e.rack.row) : null;
    },
    selectedRackId: () => detail.rackId,
    /** Screen pos (CSS px) of the server mesh's front-face center; null if not built. */
    serverScreenPos(id) {
      const w = detail.serverFrontWorld(id);
      return w ? toScreen(w) : null;
    },
    /** Screen pos of an (empty) unit's front-face center inside the selected rack. */
    unitScreenPos(unit) {
      const w = detail.unitFrontWorld(unit);
      return w ? toScreen(w) : null;
    },
    serverMeshes: () => detail.describe(),
    /** Emissive hex of a server mesh (0 = not highlighted); null if not built. */
    serverEmissive: (id) => detail.serverEmissive(id),
    /** Racks zero-scaled because they sit on the camera side of the selected rack (rack/server mode). */
    culledRackIds: () => view.culledRackIds(),
    /** What a click at page CSS px (x, y) would hit: {kind, id} | null (same logic as clicks). */
    pickAt: (x, y) => picking.pick(x - window.scrollX, y - window.scrollY),
    /** Lets later scene modules add or override API entries. */
    extend(more) {
      Object.assign(api, more);
    },
    toScreen: (p) => toScreen(new THREE.Vector3(p.x, p.y, p.z)),
  };
  window.__dc = api;
  return api;
}
