import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RACK, gridToWorld, floorY, floorFootprint } from '../domain/layout.js';
import { emptySlots } from '../domain/slots.js';
import { floorStats } from '../domain/occupancy.js';

export const SLAB_OPACITY = 0.9;
const SLAB_T = 0.1;

/** `2F · 랙 240/300 · 평균 68%` */
export function floorLabelText(floor, stats = floorStats(floor)) {
  return `${floor.id} · 랙 ${stats.racks}/${stats.slots} · 평균 ${Math.round(stats.avg * 100)}%`;
}

/** Floors of a DC sorted bottom-to-top (level, then input order). */
export function orderedFloors(dc) {
  return dc.floors
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.level ?? a.i) - (b.f.level ?? b.i) || a.i - b.i)
    .map(({ f }) => f);
}

function dashedSlotGeometry(floor) {
  const slots = emptySlots(floor);
  const hw = RACK.w / 2;
  const hd = RACK.d / 2;
  const y = 0.01;
  const pos = new Float32Array(slots.length * 8 * 3);
  let k = 0;
  const push = (x, z) => {
    pos[k++] = x;
    pos[k++] = y;
    pos[k++] = z;
  };
  for (const { row, col } of slots) {
    const { x, z } = gridToWorld(floor, row, col);
    const c = [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]];
    for (let i = 0; i < 4; i++) {
      push(...c[i]);
      push(...c[(i + 1) % 4]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return { geometry: g, count: slots.length };
}

/**
 * One Group per floor of one DC: slab (picking + visual), merged dashed empty slots, CSS2D label.
 * @param {any} dc normalized datacenter ({id, name, floors})
 * @returns {Map<string, {floor:any, index:number, group:THREE.Group, slab:THREE.Mesh, emptyLines:THREE.LineSegments, emptyCount:number, label:CSS2DObject, labelEl:HTMLElement, stats:any}>}
 */
export function buildFloors(dc, scene) {
  const out = new Map();
  orderedFloors(dc).forEach((floor, index) => {
    const group = new THREE.Group();
    group.name = `floor:${floor.id}`;
    group.position.y = floorY(index);

    const { w, d } = floorFootprint(floor);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, SLAB_T, d),
      new THREE.MeshStandardMaterial({
        color: 0x2b3340,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: SLAB_OPACITY,
      }),
    );
    slab.position.y = -SLAB_T / 2;
    slab.userData = { kind: 'slab', floorId: floor.id };
    group.add(slab);

    const { geometry, count } = dashedSlotGeometry(floor);
    const emptyLines = new THREE.LineSegments(
      geometry,
      new THREE.LineDashedMaterial({ color: 0x8b949e, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 1 }),
    );
    emptyLines.computeLineDistances();
    emptyLines.userData = { kind: 'emptySlots', floorId: floor.id };
    group.add(emptyLines);

    const stats = floorStats(floor);
    const labelEl = document.createElement('div');
    labelEl.className = 'floor-label';
    labelEl.dataset.floor = floor.id;
    labelEl.textContent = floorLabelText(floor, stats);
    const label = new CSS2DObject(labelEl);
    label.position.set(w / 2 + 0.5, 0.2, -d / 2);
    label.center.set(0, 0.5);
    group.add(label);

    scene.add(group);
    out.set(floor.id, { floor, index, group, slab, emptyLines, emptyCount: count, label, labelEl, stats });
  });
  return out;
}

/**
 * Removes every floor group from the scene and frees slab/line geometries + materials and the label elements.
 * CSS2DObject only drops its element on its own 'removed' event, which a parent's removal does not fire.
 */
export function disposeFloors(floors) {
  for (const f of floors.values()) {
    f.group.removeFromParent();
    f.slab.geometry.dispose();
    f.slab.material.dispose();
    f.emptyLines.geometry.dispose();
    f.emptyLines.material.dispose();
    f.label.removeFromParent();
    f.labelEl.remove();
  }
  floors.clear();
}
