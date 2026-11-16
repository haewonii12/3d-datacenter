import * as THREE from 'three';
import { RACK, gridToWorld } from '../domain/layout.js';
import { occupancy, colorFor } from '../domain/occupancy.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * One InstancedMesh per floor, added to that floor's group (rack bottoms on the slab, y=0).
 * The returned object is stable: `rebuild(floors)` disposes everything and refills it for another DC.
 * @param {Map<string, any>} floors from buildFloors
 */
export function buildRacks(floors) {
  let geometry = null;
  /** @type {Map<string, {mesh:THREE.InstancedMesh, material:THREE.MeshStandardMaterial, idToRack:string[], rackToId:Map<string,number>, matrices:THREE.Matrix4[]}>} */
  const byFloor = new Map();
  /** rackId -> {floorId, index, rack} */
  const index = new Map();
  const hidden = new Set();

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  function build(floors) {
    geometry = new THREE.BoxGeometry(RACK.w, RACK.h, RACK.d);
    for (const [floorId, f] of floors) {
      const racks = f.floor.racks;
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 1,
        depthWrite: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, racks.length));
      mesh.count = racks.length;
      mesh.name = `racks:${floorId}`;
      mesh.userData = { kind: 'racks', floorId };
      const idToRack = [];
      const rackToId = new Map();
      const matrices = [];
      racks.forEach((rack, i) => {
        const { x, z } = gridToWorld(f.floor, rack.row, rack.col);
        m.makeTranslation(x, RACK.h / 2, z);
        matrices.push(m.clone());
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(colorFor(occupancy(rack))));
        idToRack.push(rack.id);
        rackToId.set(rack.id, i);
        index.set(rack.id, { floorId, index: i, rack });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      f.group.add(mesh);
      byFloor.set(floorId, { mesh, material, idToRack, rackToId, matrices });
    }
  }

  function setInstance(rackId, matrix) {
    const e = index.get(rackId);
    if (!e) return false;
    const { mesh } = byFloor.get(e.floorId);
    mesh.setMatrixAt(e.index, matrix ?? byFloor.get(e.floorId).matrices[e.index]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return true;
  }

  function dispose() {
    for (const { mesh, material } of byFloor.values()) {
      mesh.removeFromParent();
      mesh.dispose();
      material.dispose();
    }
    geometry?.dispose();
    geometry = null;
    byFloor.clear();
    index.clear();
    hidden.clear();
  }

  build(floors);
  return {
    byFloor,
    index,
    /** Zero-scales a rack instance (used when the rack is drawn by rackDetail). */
    hideInstance(rackId) {
      if (setInstance(rackId, ZERO)) hidden.add(rackId);
    },
    restoreInstance(rackId) {
      if (setInstance(rackId, null)) hidden.delete(rackId);
    },
    isHidden: (rackId) => hidden.has(rackId),
    /** @returns {string|null} */
    rackIdAt(floorId, instanceId) {
      return byFloor.get(floorId)?.idToRack[instanceId] ?? null;
    },
    /** World-space center of a rack. */
    rackCenter(rackId, out = new THREE.Vector3()) {
      const e = index.get(rackId);
      if (!e) return null;
      const { mesh, matrices } = byFloor.get(e.floorId);
      mesh.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(matrices[e.index]).applyMatrix4(mesh.matrixWorld);
    },
    /** @returns {string|null} sRGB hex of the instance color */
    instanceColorHex(rackId) {
      const e = index.get(rackId);
      if (!e) return null;
      const color = new THREE.Color();
      byFloor.get(e.floorId).mesh.getColorAt(e.index, color);
      return `#${color.getHexString()}`;
    },
    dispose,
    /** Frees the current racks and builds those of `floors` (a DC switch). */
    rebuild(floors) {
      dispose();
      build(floors);
    },
  };
}
