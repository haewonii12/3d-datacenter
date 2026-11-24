import * as THREE from 'three';
import { RACK, UNIT_H, unitToY, mountY, frontNormal, deviceLabel } from '../domain/layout.js';
import { occupancy, colorFor } from '../domain/occupancy.js';
import { sharedUnits } from '../domain/mount.js';
import { getTheme } from '../ui/theme.js';
import { laneOf } from '../ui/elevation.js';
import { RACK_PALETTE, devicePanelTexture } from './rackTextures.js';
import { ease } from './view.js';

const FRAME = 0.03; // post / plate thickness
const RAIL_INSET = 0.08; // devices sit inside the mounting rails
const SERVER_D = RACK.d - 0.1;
const INSET = 0.004; // vertical gap between stacked devices
const VIOLATION = 0xf85149;
const SLIDE = 0.25; // selected server slides out along the front normal (local +z)
const SLIDE_MS = 200;
const HIGHLIGHT = 0x1f6feb;

/** Name plate for devices taller than 1.5U (front face, local +z). */
function namePlate(text, height, serverW) {
  const h = height * 0.62;
  const w = serverW * 0.86;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(32, Math.round((512 * h) / w));
  const g = canvas.getContext('2d');
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#e6edf3';
  g.font = `600 ${Math.min(Math.round(canvas.height * 0.62), 72)}px ui-monospace, monospace`;
  g.textBaseline = 'middle';
  g.fillText(text, 16, canvas.height / 2, canvas.width - 32);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map }));
  plate.position.set(0, 0, SERVER_D / 2 + 0.002);
  return plate;
}

/**
 * Cabinet: posts, plates, back + side panels, edges, occupancy accent strip. Local +z = front, y=0 = rack bottom.
 * `W` is the rack's width (a multi-cell rack is one wide cabinet).
 */
function buildCabinet(rack, W, theme) {
  const cab = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: RACK_PALETTE.frame, roughness: 0.5, metalness: 0.5 });
  const panelMat = new THREE.MeshStandardMaterial({ color: RACK_PALETTE.side, roughness: 0.8, metalness: 0.2 });
  const SERVER_W = W - RAIL_INSET;
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    cab.add(m);
  };
  const hw = W / 2 - FRAME / 2;
  const hd = RACK.d / 2 - FRAME / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(FRAME, RACK.h, FRAME, frameMat, sx * hw, RACK.h / 2, sz * hd);
  box(W, FRAME, RACK.d, frameMat, 0, -FRAME / 2, 0);
  box(W, FRAME, RACK.d, frameMat, 0, RACK.h + FRAME / 2, 0);
  // mounting rails just behind the front face
  for (const sx of [-1, 1]) box(0.025, RACK.h, 0.02, frameMat, sx * (SERVER_W / 2 + 0.0125), RACK.h / 2, SERVER_D / 2 - 0.01);
  box(W - 2 * FRAME, RACK.h, 0.02, panelMat, 0, RACK.h / 2, -RACK.d / 2 + 0.02); // back panel
  for (const sx of [-1, 1]) box(0.01, RACK.h, RACK.d - 2 * FRAME, panelMat, sx * (W / 2 - 0.005), RACK.h / 2, 0);
  // occupancy accent strip across the top front
  const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorFor(occupancy(rack))) });
  box(W, 0.025, 0.012, accent, 0, RACK.h + FRAME + 0.0125, RACK.d / 2 - 0.006);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, RACK.h + 2 * FRAME, RACK.d)),
    new THREE.LineBasicMaterial({ color: rack.violation ? VIOLATION : theme.edge }),
  );
  edges.position.y = RACK.h / 2;
  cab.add(edges);
  return cab;
}

function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) seen.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map) seen.add(m.map);
      seen.add(m);
    }
  });
  for (const r of seen) r.dispose();
}

/**
 * Selected-rack pull-out: opaque standalone cabinet + one Mesh per server (own material each).
 * @param {{scene:THREE.Scene, racks:any}} deps
 */
export function createRackDetail({ scene, racks }) {
  let cur = null; // {rackId, group, proxy, servers: Map<id, Mesh>, n}
  const tmp = new THREE.Vector3();
  const base = new THREE.Vector3();
  /** mesh -> {from, to, t0} slide tweens of the local z offset */
  const slides = new Map();

  function clear() {
    if (!cur) return;
    slides.clear();
    racks.restoreInstance(cur.rackId);
    cur.group.removeFromParent();
    disposeTree(cur.group);
    cur = null;
  }

  function show(rackId) {
    if (cur?.rackId === rackId) return;
    clear();
    const e = racks.index.get(rackId);
    if (!e) return;
    const { rack } = e;
    const center = racks.rackCenter(rackId);
    const n = frontNormal(rack.row);
    const theme = getTheme();
    const W = racks.footprint(rackId)?.w ?? RACK.w;
    const SERVER_W = W - RAIL_INSET;

    const group = new THREE.Group();
    group.name = `rackDetail:${rackId}`;
    group.position.set(center.x, center.y - RACK.h / 2, center.z);
    group.rotation.y = n.z > 0 ? 0 : Math.PI; // local +z = front normal
    group.add(buildCabinet(rack, W, theme));

    // Invisible pick proxy (Raycaster ignores `visible`): the selected rack's volume.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(W, RACK.h, RACK.d), new THREE.MeshBasicMaterial());
    proxy.visible = false;
    proxy.position.y = RACK.h / 2;
    proxy.userData = { kind: 'selectedRack', id: rackId };
    group.add(proxy);

    const servers = new Map();
    const mounted = rack.servers.filter((s) => !s.invalid); // unparsable positions: listed in the elevation only
    const shares = sharedUnits(mounted.map((s) => ({ id: s.id, s: s.unit, e: s.unit + s.height_u - 1 })));
    // Devices overlapping in violation of the mount rules are drawn side by side (same lanes as the elevation).
    const lanes = laneOf(mounted, shares);
    const laneCount = Math.max(0, ...lanes.values()) + 1;
    const laneW = SERVER_W / laneCount;
    for (const s of mounted) {
      const h = s.height_u;
      const { y, h: hy } = mountY(s, shares.get(s.id));
      // Front face: the same bezel + LED panel as the floor view, one texture row per U.
      const map = devicePanelTexture();
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, Math.max(1, Math.round(hy / UNIT_H)));
      const tint = s.violation ? 0xff8a8a : 0xffffff;
      const front = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.4, metalness: 0.5, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.35 });
      const body = new THREE.MeshStandardMaterial({ color: s.violation ? 0x8a3a3a : RACK_PALETTE.panel, roughness: 0.55, metalness: 0.35 });
      const mat = [body, body, body, body, front, body];
      const lit = [body, front]; // materials that take the selection highlight
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(laneW - (laneCount > 1 ? 0.01 : 0), hy - INSET, SERVER_D), mat);
      mesh.position.set(-SERVER_W / 2 + laneW * ((lanes.get(s.id) ?? 0) + 0.5), y, 0);
      mesh.name = `server:${s.id}`;
      mesh.userData = { kind: 'server', id: s.id, baseZ: 0, heightU: h, lit };
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: s.violation ? VIOLATION : 0x0d1117 }),
      );
      if (s.violation) edges.scale.setScalar(1.01);
      mesh.add(edges);
      if (hy >= 1.5 * UNIT_H) mesh.add(namePlate(deviceLabel(s), hy, laneW));
      group.add(mesh);
      servers.set(s.id, mesh);
    }

    // The faded floor sits in the transparent pass and its facing row is between camera and rack.
    // Drawing the pull-out (opacity 1) after it, via renderOrder, keeps the rack crisp instead of tinted.
    group.traverse((o) => {
      if (!o.material) return;
      o.renderOrder = 1;
      for (const mt of Array.isArray(o.material) ? o.material : [o.material]) mt.transparent = true;
    });
    racks.hideInstance(rackId);
    scene.add(group);
    group.updateMatrixWorld(true);
    cur = { rackId, group, proxy, servers, n };
  }

  const setZ = (m, z) => {
    m.position.z = m.userData.baseZ + z;
    m.updateMatrixWorld(true);
  };

  /** Highlights + slides out `serverId` (null = none); every other server reverts. */
  function select(serverId, animate) {
    if (!cur) return;
    for (const [id, m] of cur.servers) {
      const on = id === serverId;
      const [body, front] = m.userData.lit;
      body.emissive.setHex(on ? HIGHLIGHT : 0x000000);
      body.emissiveIntensity = on ? 0.7 : 1;
      front.emissive.setHex(on ? HIGHLIGHT : 0xffffff);
      front.emissiveIntensity = on ? 0.9 : 0.35;
      const to = on ? SLIDE : 0;
      const from = m.position.z - m.userData.baseZ;
      slides.delete(m);
      if (!animate || Math.abs(from - to) < 1e-9) setZ(m, to);
      else slides.set(m, { from, to, t0: performance.now() });
    }
  }

  function tick(now) {
    for (const [m, sl] of slides) {
      const t = Math.min(1, (now - sl.t0) / SLIDE_MS);
      if (t >= 1) slides.delete(m);
      setZ(m, sl.from + (sl.to - sl.from) * ease(t));
    }
  }

  return {
    show,
    clear,
    select,
    tick,
    get sliding() {
      return slides.size > 0;
    },
    get rackId() {
      return cur ? cur.rackId : null;
    },
    get proxy() {
      return cur ? cur.proxy : null;
    },
    serverMeshList: () => (cur ? [...cur.servers.values()] : []),
    serverMesh: (id) => cur?.servers.get(id) ?? null,
    /** World point at the center of a server's front face. */
    serverFrontWorld(id, out = new THREE.Vector3()) {
      const m = cur?.servers.get(id);
      if (!m) return null;
      m.updateWorldMatrix(true, false);
      return m.localToWorld(out.set(0, 0, SERVER_D / 2));
    },
    /** World point at the center of an empty unit's front face (for tests: "click empty U"). */
    unitFrontWorld(unit, out = new THREE.Vector3()) {
      if (!cur) return null;
      cur.group.updateWorldMatrix(true, false);
      return cur.group.localToWorld(out.set(0, unitToY(unit, 1), SERVER_D / 2));
    },
    /** Emissive hex of a server's material (0 = no highlight); null if not built. */
    serverEmissive: (id) => cur?.servers.get(id)?.userData.lit[0].emissive.getHex() ?? null,
    describe() {
      return [...(cur?.servers ?? [])].map(([id, m]) => {
        m.getWorldPosition(tmp);
        // World displacement from the base (un-slid) position, projected on the front normal.
        cur.group.localToWorld(base.set(m.position.x, m.position.y, m.userData.baseZ));
        const { n } = cur;
        const off = (tmp.x - base.x) * n.x + (tmp.y - base.y) * n.y + (tmp.z - base.z) * n.z;
        return { id, worldPos: { x: tmp.x, y: tmp.y, z: tmp.z }, offsetAlongNormal: Math.abs(off) < 1e-9 ? 0 : off, width: m.geometry.parameters.width };
      });
    },
  };
}
