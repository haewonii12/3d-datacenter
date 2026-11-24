import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RACK, rackFootprint, zoneRect, floorY, floorFootprint } from '../domain/layout.js';
import { emptySlots } from '../domain/slots.js';
import { floorStats } from '../domain/occupancy.js';
import { getTheme } from '../ui/theme.js';

const WALL_H = 0.35;
const WALL_T = 0.05;
const ZONE_MARGIN = 0.45; // tiled border around a zone's cells, inside its walls
const TILE_PX = 48; // texture pixels per world unit

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
    const { cx: x, cz: z } = rackFootprint(floor, { row, col, span: 1 });
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

/** Raised-floor tiles (procedural, no image files) with the zone name in the front margin. */
function tileTexture(rect, zoneId, theme) {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, Math.max(64, Math.round(w * TILE_PX)));
  canvas.height = Math.min(2048, Math.max(64, Math.round(d * TILE_PX)));
  const g = canvas.getContext('2d');
  const sx = canvas.width / w;
  const sz = canvas.height / d;
  const tile = 0.6; // 600 mm tiles
  for (let i = 0; i * tile < w; i++)
    for (let j = 0; j * tile < d; j++) {
      g.fillStyle = (i + j) % 2 ? theme.tile.a : theme.tile.b;
      g.fillRect(i * tile * sx, j * tile * sz, tile * sx + 1, tile * sz + 1);
    }
  g.strokeStyle = theme.tile.line;
  g.lineWidth = 1;
  for (let i = 0; i * tile <= w; i++) {
    g.beginPath();
    g.moveTo(i * tile * sx + 0.5, 0);
    g.lineTo(i * tile * sx + 0.5, canvas.height);
    g.stroke();
  }
  for (let j = 0; j * tile <= d; j++) {
    g.beginPath();
    g.moveTo(0, j * tile * sz + 0.5);
    g.lineTo(canvas.width, j * tile * sz + 0.5);
    g.stroke();
  }
  g.fillStyle = theme.zoneText;
  g.font = `700 ${Math.round(ZONE_MARGIN * sz * 0.8)}px system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(`${zoneId}구역`, 8, (ZONE_MARGIN * sz) / 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** Zone tiles + low walls of a floor. @returns {{group:THREE.Group, fades:{material:THREE.Material, base:number}[]}} */
function buildZones(floor, theme) {
  const group = new THREE.Group();
  group.name = `zones:${floor.id}`;
  const fades = [];
  const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall.color, roughness: 0.6, metalness: 0.2, transparent: true, opacity: theme.wall.opacity });
  fades.push({ material: wallMat, base: theme.wall.opacity });
  for (const z of floor.zones || []) {
    const r = zoneRect(floor, z, ZONE_MARGIN);
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const mat = new THREE.MeshStandardMaterial({ map: tileTexture(r, z.id, theme), roughness: 0.85, metalness: 0, transparent: true, opacity: 1 });
    fades.push({ material: mat, base: 1 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, 0.004, cz);
    plane.receiveShadow = true;
    plane.name = `zone:${floor.id}:${z.id}`;
    plane.userData = { kind: 'zone', floorId: floor.id, zone: z.id };
    group.add(plane);
    const wall = (ww, dd, x, zz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, WALL_H, dd), wallMat);
      m.position.set(x, WALL_H / 2, zz);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData = { kind: 'wall', floorId: floor.id, zone: z.id };
      group.add(m);
    };
    wall(w, WALL_T, cx, r.z0);
    wall(w, WALL_T, cx, r.z1);
    wall(WALL_T, d, r.x0, cz);
    wall(WALL_T, d, r.x1, cz);
  }
  return { group, fades };
}

/**
 * One Group per floor of one DC: slab (picking + visual), merged dashed empty slots, CSS2D label.
 * @param {any} dc normalized datacenter ({id, name, floors})
 * @returns {Map<string, {floor:any, index:number, group:THREE.Group, slab:THREE.Mesh, emptyLines:THREE.LineSegments, emptyCount:number, label:CSS2DObject, labelEl:HTMLElement, stats:any}>}
 */
export function buildFloors(dc, scene) {
  const out = new Map();
  const theme = getTheme();
  orderedFloors(dc).forEach((floor, index) => {
    const group = new THREE.Group();
    group.name = `floor:${floor.id}`;
    group.position.y = floorY(index);

    const { w, d } = floorFootprint(floor);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w, SLAB_T, d),
      new THREE.MeshStandardMaterial({
        color: theme.slab,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: SLAB_OPACITY,
      }),
    );
    slab.position.y = -SLAB_T / 2;
    slab.receiveShadow = true;
    slab.userData = { kind: 'slab', floorId: floor.id };
    group.add(slab);
    const zones = buildZones(floor, theme);
    group.add(zones.group);

    const { geometry, count } = dashedSlotGeometry(floor);
    const emptyLines = new THREE.LineSegments(
      geometry,
      new THREE.LineDashedMaterial({ color: theme.emptyLine, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 1 }),
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
    out.set(floor.id, { floor, index, group, slab, zones: zones.group, fades: zones.fades, emptyLines, emptyCount: count, label, labelEl, stats });
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
    f.zones.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    f.label.removeFromParent();
    f.labelEl.remove();
  }
  floors.clear();
}
