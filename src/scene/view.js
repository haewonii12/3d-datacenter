import { RACK, frontNormal } from '../domain/layout.js';
import { overviewPreset, floorPreset } from '../domain/camera.js';
import { SLAB_OPACITY, buildFloors, disposeFloors } from './floors.js';

export const FADE_MS = 300;
export const RACK_MODE_OPACITY = 0.15;
/** Rack-mode camera: p = rackCenter + n·DIST + up·LIFT, t = rackCenter. */
export const RACK_CAM = { dist: 3.5, lift: 0.3 };
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const modeOf = (s) => (s.server ? 'server' : s.rack ? 'rack' : s.floor ? 'floor' : 'overview');

/**
 * The single reconciler for 3D visibility / opacity / labels / camera, and the only place that builds
 * or disposes a DC's floors/racks. Each mode is an absolute target; `prev` only matters for where
 * transitions start. A DC change rebuilds the scene and applies the target without animation.
 * @param {{scene:any, floors: Map<string, any>, racks: any, controls: any, onTick: Function, detail:any, getDc:(id:string)=>any}} deps
 *   floors / racks are stable containers, refilled in place on a DC switch.
 */
export function createView({ scene, floors, racks, controls, onTick, detail, getDc, getRevision = () => 0 }) {
  /** floorId -> current opacity factor (0..1) */
  const opacity = new Map();
  /** floorId -> rack-material dim factor (1, or RACK_MODE_OPACITY in rack/server mode) */
  const dims = new Map();
  /** floorId -> {from, to, t0} */
  const fades = new Map();
  /** floorId -> {from, to, t0} for the rack-material dim */
  const dimFades = new Map();
  let camSeq = 0;
  let camPending = false;
  /** Zero-scaled racks on the camera side of the selected rack (rack/server mode only). */
  const culled = new Set();
  /** Id of the DC whose floors/racks are currently built, and the data revision they were built from. */
  let builtDc = null;
  let builtRev = -1;

  /** Disposes the current DC's floors, racks, pull-out and labels; builds `dcId`'s floors and racks. */
  function loadDc(dcId) {
    detail?.clear();
    culled.clear();
    fades.clear();
    dimFades.clear();
    opacity.clear();
    dims.clear();
    disposeFloors(floors);
    for (const [id, f] of buildFloors(getDc(dcId), scene)) floors.set(id, f);
    racks.rebuild(floors);
    builtDc = dcId;
    builtRev = getRevision();
  }

  /**
   * Racks of the selected rack's floor whose center lies on the camera side: (c − sel)·n > RACK.d/2.
   * The aisle camera sits behind the facing row, which would otherwise fill the view and swallow clicks.
   */
  function cameraSide(rackId) {
    const e = racks.index.get(rackId);
    const sel = racks.rackCenter(rackId);
    const n = frontNormal(e.rack.row);
    const out = new Set();
    for (const id of racks.byFloor.get(e.floorId).idToRack) {
      const c = racks.rackCenter(id);
      if ((c.x - sel.x) * n.x + (c.z - sel.z) * n.z > RACK.d / 2) out.add(id);
    }
    return out;
  }

  function setOpacity(id, o) {
    const f = floors.get(id);
    opacity.set(id, o);
    f.slab.material.opacity = o * SLAB_OPACITY;
    f.emptyLines.material.opacity = o;
    racks.byFloor.get(id).material.opacity = o * (dims.get(id) ?? 1);
    f.labelEl.style.opacity = String(o);
  }

  function setDim(id, d) {
    dims.set(id, d);
    racks.byFloor.get(id).material.opacity = (opacity.get(id) ?? 1) * d;
  }

  function dimTo(id, to, instant) {
    const from = dims.get(id) ?? 1;
    dimFades.delete(id);
    if (instant || from === to) setDim(id, to);
    else dimFades.set(id, { from, to, t0: performance.now() });
  }

  function finishFade(id, to) {
    fades.delete(id);
    setOpacity(id, to);
    floors.get(id).group.visible = to > 0;
  }

  function fadeTo(id, to, instant) {
    const from = opacity.get(id) ?? 1;
    if (instant || from === to) {
      finishFade(id, to);
      return;
    }
    floors.get(id).group.visible = true;
    fades.set(id, { from, to, t0: performance.now() });
  }

  onTick((now) => {
    for (const [id, fd] of fades) {
      const t = Math.min(1, (now - fd.t0) / FADE_MS);
      if (t >= 1) finishFade(id, fd.to);
      else setOpacity(id, fd.from + (fd.to - fd.from) * ease(t));
    }
    for (const [id, fd] of dimFades) {
      const t = Math.min(1, (now - fd.t0) / FADE_MS);
      if (t >= 1) dimFades.delete(id);
      setDim(id, fd.from + (fd.to - fd.from) * ease(t));
    }
    detail?.tick(now);
  });

  function rackPreset(rackId) {
    const t = racks.rackCenter(rackId);
    const n = frontNormal(racks.index.get(rackId).rack.row);
    return {
      p: [t.x + n.x * RACK_CAM.dist, t.y + RACK_CAM.lift, t.z + n.z * RACK_CAM.dist],
      t: [t.x, t.y, t.z],
    };
  }

  let holdCamera = false;
  function moveCamera({ p, t }, animate) {
    if (holdCamera) return;
    const seq = ++camSeq;
    camPending = true;
    controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], animate).then(() => {
      if (seq === camSeq) camPending = false;
    });
  }

  /**
   * @param {{dc,floor,rack,server}|null} prev null on first apply (no animation)
   * @param {{dc,floor,rack,server}} next
   */
  function applyView(prev, next) {
    const switched = next.dc !== builtDc;
    const rebuilt = switched || getRevision() !== builtRev;
    if (rebuilt) loadDc(next.dc);
    const instant = prev == null || rebuilt; // a new DC appears at its preset, no fly-in
    // Data edit with the same view state: rebuild in place, leave the camera where the user put it.
    holdCamera = rebuilt && !switched && prev != null && modeOf(prev) === modeOf(next) &&
      prev.floor === next.floor && prev.rack === next.rack;
    const camAnimate = prev != null && !switched; // after an edit that moved the state (e.g. rack deleted), still fly
    const mode = modeOf(next);
    const detailMode = mode === 'rack' || mode === 'server';

    if (mode === 'overview') {
      for (const [id, f] of floors) {
        f.label.visible = true;
        fadeTo(id, 1, instant);
        dimTo(id, 1, instant);
        racks.byFloor.get(id).material.depthWrite = true;
      }
      moveCamera(overviewPreset([...floors.values()].map((f) => f.floor)), camAnimate);
    } else {
      // floor / rack / server: only floor f is shown; others fade out and end hidden.
      const own = floors.get(next.floor);
      for (const [id, f] of floors) {
        if (f === own) continue;
        f.label.visible = true; // fades with its floor, hidden once the group is hidden
        fadeTo(id, 0, instant);
        dimTo(id, 1, instant);
        racks.byFloor.get(id).material.depthWrite = true;
      }
      fades.delete(next.floor);
      setOpacity(next.floor, 1);
      own.group.visible = true;
      own.label.visible = false;
      // Faded racks stay pickable; depthWrite=false so they never occlude the opaque pull-out.
      racks.byFloor.get(next.floor).material.depthWrite = !detailMode;
      dimTo(next.floor, detailMode ? RACK_MODE_OPACITY : 1, instant);
      if (mode === 'floor') moveCamera(floorPreset(own.floor, own.index), camAnimate);
    }

    // Rack detail: absolute — the pull-out exists iff mode is rack/server, and is for next.rack.
    // Camera-side culling: restore stale ones first (one may become the new pull-out), hide new ones
    // after the detail swap (the old pull-out's restored instance may now be on the camera side).
    const cull = detailMode ? cameraSide(next.rack) : new Set();
    for (const id of culled) {
      if (cull.has(id)) continue;
      racks.restoreInstance(id);
      culled.delete(id);
    }
    const rackChanged = (detail?.rackId ?? null) !== (detailMode ? next.rack : null);
    if (rackChanged) {
      detail?.clear();
      if (detailMode) detail?.show(next.rack);
    }
    for (const id of cull) {
      if (culled.has(id)) continue;
      racks.hideInstance(id);
      culled.add(id);
    }
    // Rack mode always frames the rack; server mode only re-frames when the rack itself changed.
    if (mode === 'rack' || (mode === 'server' && (rackChanged || instant))) moveCamera(rackPreset(next.rack), camAnimate);
    // Server highlight + slide-out: absolute too (rack mode = none selected, all offsets 0).
    if (detailMode) detail?.select(mode === 'server' ? next.server : null, !instant && !rackChanged);
    holdCamera = false;
  }

  return {
    applyView,
    culledRackIds: () => [...culled],
    /** Effective rack-material opacity factor of a floor (fade × rack-mode dim). */
    floorOpacity: (id) => (floors.has(id) ? (opacity.get(id) ?? 1) * (dims.get(id) ?? 1) : null),
    rackPreset,
    get builtDc() {
      return builtDc;
    },
    isSettled: () => fades.size === 0 && dimFades.size === 0 && !camPending && !detail?.sliding,
  };
}
