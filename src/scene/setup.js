import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { getTheme } from '../ui/theme.js';

CameraControls.install({ THREE });

/**
 * Renderer, camera, controls, lights, CSS2D overlay, resize and render loop.
 * @param {HTMLElement} container
 */
export function createSetup(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xdde6f0, 0x20242c, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(30, 60, 40);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  /** Background gradient (CanvasTexture), fog and light levels of the current theme. */
  function applyTheme(theme = getTheme()) {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.bg[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    scene.background?.dispose?.();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    hemi.color.setHex(theme.hemi.sky);
    hemi.groundColor.setHex(theme.hemi.ground);
    hemi.intensity = theme.hemi.intensity;
    sun.intensity = theme.sun.intensity;
  }
  applyTheme();

  /** Shadows on/off (materials recompile when the switch flips). */
  function setShadows(on) {
    if (renderer.shadowMap.enabled === on && sun.castShadow === on) return;
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.needsUpdate = true;
    });
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const controls = new CameraControls(camera, renderer.domElement);
  controls.dollyToCursor = true;
  controls.minDistance = 2;
  controls.maxDistance = 200;

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  const tickers = new Set();
  let paused = false;
  function frame() {
    const dt = clock.getDelta();
    controls.update(dt);
    const now = performance.now();
    for (const fn of tickers) fn(now, dt);
    if (paused) return; // map screen: viewport hidden, nothing to draw
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  /** Registers a per-frame callback (now ms, dt s); returns an unsubscribe. */
  const onTick = (fn) => {
    tickers.add(fn);
    return () => tickers.delete(fn);
  };

  return {
    THREE,
    renderer,
    labelRenderer,
    scene,
    camera,
    controls,
    onTick,
    resize,
    applyTheme,
    setShadows,
    get shadows() {
      return renderer.shadowMap.enabled;
    },
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      resize(); // the container may have changed size while hidden
    },
    get paused() {
      return paused;
    },
  };
}
