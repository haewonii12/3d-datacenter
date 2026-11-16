import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

CameraControls.install({ THREE });

/**
 * Renderer, camera, controls, lights, CSS2D overlay, resize and render loop.
 * @param {HTMLElement} container
 */
export function createSetup(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0d1117, 1);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde6f0, 0x20242c, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(30, 60, 40);
  scene.add(sun);

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
  function frame() {
    const dt = clock.getDelta();
    controls.update(dt);
    const now = performance.now();
    for (const fn of tickers) fn(now, dt);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  /** Registers a per-frame callback (now ms, dt s); returns an unsubscribe. */
  const onTick = (fn) => {
    tickers.add(fn);
    return () => tickers.delete(fn);
  };

  return { THREE, renderer, labelRenderer, scene, camera, controls, onTick, resize };
}
