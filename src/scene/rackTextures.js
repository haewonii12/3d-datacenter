// Procedural rack textures (no image files): cabinet door, top with fans, and a 1U device panel with LEDs.
// Style follows the isometric server-room illustration look: dark navy cabinets, lighter flat top,
// rows of device panels with green / cyan status LEDs.
import * as THREE from 'three';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  return t;
}

/** Front/back door: frame, perforated mesh, handle. */
function doorTexture(p) {
  return canvasTexture(128, 384, (g, w, h) => {
    g.fillStyle = p.frame;
    g.fillRect(0, 0, w, h);
    g.fillStyle = p.door;
    g.fillRect(8, 10, w - 16, h - 20);
    g.fillStyle = p.perf;
    for (let y = 16; y < h - 16; y += 6) for (let x = 13 + ((y / 6) % 2) * 3; x < w - 16; x += 6) g.fillRect(x, y, 2, 2);
    g.fillStyle = p.handle;
    g.fillRect(w - 18, h * 0.42, 5, h * 0.16);
  });
}

/** Top: flat lighter face with vent slots (reads well even when a multi-cell rack stretches it). */
function topTexture(p) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = p.top;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = p.topEdge;
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = p.fan;
    for (let y = 34; y < h - 30; y += 18) g.fillRect(24, y, w - 48, 8);
  });
}

/** Side panels: flat with a subtle inset. */
function sideTexture(p) {
  return canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = p.side;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = p.sideEdge;
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
}

/** One U of a mounted device: bezel, drive bays, status LEDs. */
function panelTexture(p) {
  return canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = p.panel;
    g.fillRect(0, 0, w, h);
    g.fillStyle = p.panelEdge;
    g.fillRect(0, 0, w, 3);
    g.fillStyle = p.bay;
    for (let x = 70; x < w - 20; x += 22) g.fillRect(x, 8, 18, h - 15);
    const leds = [p.ledGreen, p.ledGreen, p.ledCyan, p.ledGreen];
    leds.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(10 + i * 13, h / 2 - 3, 8, 6);
    });
  });
}

/** Rack palette (both themes: the illustration's dark navy cabinets read well on light and dark floors). */
export const RACK_PALETTE = {
  frame: '#4a5468',
  door: '#323a4a',
  perf: '#414b5e',
  handle: '#aab4c6',
  top: '#5f6a82',
  topEdge: '#6f7b94',
  fan: '#3a4356',
  side: '#3a4252',
  sideEdge: '#465063',
  panel: '#20252f',
  panelEdge: '#4a5568',
  bay: '#2d3440',
  ledGreen: '#5cff8f',
  ledCyan: '#4fe3ff',
};

/** Device panel texture for the pull-out rack (one U high; set `repeat.y` to the device height). */
export const devicePanelTexture = (p = RACK_PALETTE) => panelTexture(p);

/**
 * Atlas layout (u0, v0, u1, v1 in 0..1) of the cabinet faces in one texture, so a whole floor of racks
 * is a single draw call with one material (the 6-material box was ~4× slower on software GL).
 */
const ATLAS = { door: [0, 0, 0.5, 1], side: [0.5, 0, 0.75, 1], top: [0.75, 0.5, 1, 1], bottom: [0.75, 0, 1, 0.5] };

function atlasTexture(p) {
  const parts = { door: doorTexture(p), side: sideTexture(p), top: topTexture(p) };
  const t = canvasTexture(512, 512, (g, w, h) => {
    for (const [k, [u0, v0, u1, v1]] of Object.entries(ATLAS)) {
      const x = u0 * w;
      const y = (1 - v1) * h; // canvas y grows down, uv v grows up
      if (parts[k]) g.drawImage(parts[k].image, x, y, (u1 - u0) * w, (v1 - v0) * h);
      else {
        g.fillStyle = '#1a1e26';
        g.fillRect(x, y, (u1 - u0) * w, (v1 - v0) * h);
      }
    }
  });
  for (const part of Object.values(parts)) part.dispose();
  return t;
}

/** BoxGeometry with UVs remapped into the atlas (face order +x, −x, +y, −y, +z, −z; 4 vertices each). */
export function atlasBoxGeometry(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = ['side', 'side', 'top', 'bottom', 'door', 'door'];
  faces.forEach((name, f) => {
    const [u0, v0, u1, v1] = ATLAS[name];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  });
  g.clearGroups(); // one material
  return g;
}

/**
 * Cabinet material (atlas). Occupied U slots are drawn by the shader on the door faces from a per-instance
 * 42-bit mask (`aMask`: U1–21 in x, U22–42 in y): bezel + LED pattern from `panelMap`, LEDs emissive.
 * No geometry per device, so a floor of racks stays one draw call.
 * `transparent` so floor fades / rack-mode dims can drive the opacity.
 */
export function createRackMaterials(p = RACK_PALETTE, totalU = 42) {
  const panelMap = panelTexture(p);
  const body = new THREE.MeshStandardMaterial({ map: atlasTexture(p), roughness: 0.55, metalness: 0.35, transparent: true, opacity: 1 });
  body.onBeforeCompile = (sh) => {
    sh.uniforms.panelMap = { value: panelMap };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMask;\nvarying vec2 vMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D panelMap;
varying vec2 vMask;
float slotOn = 0.0;
vec4 slotTex = vec4(0.0);`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
if (vMapUv.x < ${ATLAS.door[2].toFixed(3)}) { // door region of the atlas: one slot per U
  float uy = vMapUv.y * ${totalU.toFixed(1)};
  float u = floor(uy); // 0 = U1
  float m = u < 21.0 ? vMask.x : vMask.y;
  float bit = mod(floor(m / exp2(mod(u, 21.0))), 2.0);
  float fy = fract(uy);
  float fx = vMapUv.x / ${ATLAS.door[2].toFixed(3)};
  if (bit > 0.5 && fy > 0.08 && fy < 0.92 && fx > 0.06 && fx < 0.94) {
    slotTex = texture2D(panelMap, vec2((fx - 0.06) / 0.88, (fy - 0.08) / 0.84));
    slotOn = 1.0;
    diffuseColor.rgb = slotTex.rgb;
  }
}`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += slotOn * slotTex.rgb * 0.35;');
  };
  body.customProgramCacheKey = () => 'rack-slots-v1';
  return { body, all: [body], panelMap };
}
