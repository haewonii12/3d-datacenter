import * as THREE from 'three';
import { RACK, UNIT_H, rackFootprint, frontNormal } from '../domain/layout.js';
import { occupancy, colorFor } from '../domain/occupancy.js';
import { createRackMaterials, atlasBoxGeometry } from './rackTextures.js';

const BAND_H = 0.09; // occupancy ring just under the top edge (its top face stays inside the body)
const BAND_OUT = 0.016; // how far the ring sticks out of the body
const VIOLATION = 0xf85149;
/** 42-bit occupied-U mask as two exact floats (U1–21, U22–42) for the cabinet shader (see rackTextures.js). */
function unitMask(units) {
  let lo = 0;
  let hi = 0;
  for (const u of units) {
    if (u <= 21) lo += 2 ** (u - 1);
    else if (u <= 42) hi += 2 ** (u - 22);
  }
  return [lo, hi];
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Per floor: one InstancedMesh of cabinets (atlas-textured; occupied U slots drawn by the shader from a per-rack
 * mask) and one of occupancy rings, added to that floor's group (rack bottoms at y=0).
 * The returned object is stable: `rebuild(floors)` disposes everything and refills it for another DC.
 * @param {Map<string, any>} floors from buildFloors
 */
export function buildRacks(floors) {
  let geometry = null;
  /** @type {Map<string, {mesh:THREE.InstancedMesh, band:THREE.InstancedMesh, panels:THREE.InstancedMesh, materials:THREE.Material[], setOpacity:Function, setDepthWrite:Function, idToRack:string[], rackToId:Map<string,number>, matrices:THREE.Matrix4[]}>} */
  const byFloor = new Map();
  /** rackId -> {floorId, index, rack} */
  const index = new Map();
  const hidden = new Set();

  const m = new THREE.Matrix4();
  let floorsRef = floors;
  const findFloor = (floorId) => floorsRef.get(floorId)?.floor;
  const c = new THREE.Color();
  let bandGeometry = null;
  let edgeGeometry = null;
  /** rackId -> red edge LineSegments of a rack with a rule violation (hidden with the instance) */
  const violationLines = new Map();

  /** Occupied U numbers of a rack (devices with an unparsable position are not mounted). */
  const usedUnits = (rack) => {
    const out = new Set();
    for (const s of rack.servers) if (!s.invalid) for (let u = s.unit; u < s.unit + s.height_u; u++) if (u >= 1 && u <= rack.total_u) out.add(u);
    return [...out];
  };

  function build(floors) {
    geometry = null; // per floor: each floor's geometry carries its own per-instance mask attribute
    bandGeometry = new THREE.BoxGeometry(RACK.w + 2 * BAND_OUT, BAND_H, RACK.d + 2 * BAND_OUT);
    edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(RACK.w * 1.02, RACK.h * 1.01, RACK.d * 1.02));
    for (const [floorId, f] of floors) {
      const racks = f.floor.racks;
      const mats = createRackMaterials();
      const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 1, emissive: 0x000000 });
      const materials = [...mats.all, bandMaterial];
      const count = Math.max(1, racks.length);
      const geo = atlasBoxGeometry(RACK.w, RACK.h, RACK.d);
      const masks = new Float32Array(count * 2);
      let slots = 0;
      racks.forEach((rack, i) => {
        const units = usedUnits(rack);
        slots += units.length;
        masks.set(unitMask(units), i * 2);
      });
      geo.setAttribute('aMask', new THREE.InstancedBufferAttribute(masks, 2));
      const mesh = new THREE.InstancedMesh(geo, mats.body, count);
      mesh.count = racks.length;
      mesh.name = `racks:${floorId}`;
      mesh.userData = { kind: 'racks', floorId };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const band = new THREE.InstancedMesh(bandGeometry, bandMaterial, count);
      band.count = racks.length;
      band.name = `rackBands:${floorId}`;
      band.userData = { kind: 'rackBands', floorId };
      const idToRack = [];
      const rackToId = new Map();
      const matrices = [];
      const bandMatrices = [];
      racks.forEach((rack, i) => {
        const { cx, cz, w } = rackFootprint(f.floor, rack);
        const sx = w / RACK.w;
        m.makeScale(sx, 1, 1).setPosition(cx, RACK.h / 2, cz);
        matrices.push(m.clone());
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(0xffffff));
        const bm = new THREE.Matrix4().makeScale((w + 2 * BAND_OUT) / (RACK.w + 2 * BAND_OUT), 1, 1).setPosition(cx, RACK.h - BAND_H / 2 - 0.012, cz);
        bandMatrices.push(bm);
        band.setMatrixAt(i, bm);
        band.setColorAt(i, c.set(colorFor(occupancy(rack))));
        idToRack.push(rack.id);
        rackToId.set(rack.id, i);
        index.set(rack.id, { floorId, index: i, rack });
        if (rack.violation) {
          const line = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: VIOLATION }));
          line.applyMatrix4(matrices[i]);
          line.name = `violation:${rack.id}`;
          line.userData = { kind: 'violation', rackId: rack.id };
          f.group.add(line);
          violationLines.set(rack.id, line);
        }
      });
      for (const im of [mesh, band]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        f.group.add(im);
      }
      const entry = { mesh, band, slots, panelMap: mats.panelMap, materials, idToRack, rackToId, matrices, bandMatrices };
      /** Floor fade × rack-mode dim, applied to every rack material of the floor together. */
      entry.setOpacity = (o) => {
        for (const mt of materials) mt.opacity = o;
      };
      entry.setDepthWrite = (on) => {
        for (const mt of materials) mt.depthWrite = on;
      };
      byFloor.set(floorId, entry);
    }
  }

  /** matrix null = restore the built matrix; ZERO = hide. The band and violation edges follow. */
  function setInstance(rackId, matrix) {
    const e = index.get(rackId);
    if (!e) return false;
    const { mesh, band, matrices, bandMatrices } = byFloor.get(e.floorId);
    mesh.setMatrixAt(e.index, matrix ?? matrices[e.index]);
    band.setMatrixAt(e.index, matrix ?? bandMatrices[e.index]);
    for (const im of [mesh, band]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    const line = violationLines.get(rackId);
    if (line) line.visible = matrix !== ZERO;
    return true;
  }

  function dispose() {
    for (const { mesh, band, materials, panelMap } of byFloor.values()) {
      mesh.geometry.dispose();
      panelMap.dispose();
      for (const im of [mesh, band]) {
        im.removeFromParent();
        im.dispose();
      }
      for (const mt of materials) {
        mt.map?.dispose();
        mt.dispose();
      }
    }
    for (const line of violationLines.values()) {
      line.removeFromParent();
      line.material.dispose();
    }
    violationLines.clear();
    for (const g of [bandGeometry, edgeGeometry]) g?.dispose();
    geometry = bandGeometry = edgeGeometry = null;
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
    /** Ids of racks drawn with red violation edges. */
    violationIds: () => [...violationLines.keys()],
    /** Footprint {cx, cz, w} (floor-local) of a rack. */
    footprint(rackId) {
      const e = index.get(rackId);
      return e ? rackFootprint(findFloor(e.floorId), e.rack) : null;
    },
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
    /** @returns {string|null} sRGB hex of the rack's occupancy colour (the band ring under its top) */
    instanceColorHex(rackId) {
      const e = index.get(rackId);
      if (!e) return null;
      const color = new THREE.Color();
      byFloor.get(e.floorId).band.getColorAt(e.index, color);
      return `#${color.getHexString()}`;
    },
    dispose,
    /** Frees the current racks and builds those of `floors` (a DC switch). */
    rebuild(floors) {
      dispose();
      floorsRef = floors;
      build(floors);
    },
  };
}
