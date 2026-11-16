// Camera presets that scale with a DC's real floor sizes. Three-free, pure.
import { floorFootprint, stackExtent, floorY, FLOOR_SPACING } from './layout.js';

const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
/** View directions (target → camera), as the v1 presets: front-right diagonal from above. */
const OVERVIEW_DIR = unit([30, 27, 38]);
const FLOOR_DIR = unit([20, 29, 25]);
/**
 * Distance = FIT × bounding-sphere radius. 1/sin(fov/2) ≈ 2.61 for the 45° camera frames the sphere;
 * the factors match the former fixed presets for the 12×20, 4-floor sample (≈55 / ≈43 units).
 */
export const OVERVIEW_FIT = 2.85;
export const FLOOR_FIT = 2.6;

const at = (dir, dist, t) => ({ p: t.map((x, i) => x + dir[i] * dist), t });

/** Overview: the whole stack of `floors` (bottom-to-top order is irrelevant here). */
export function overviewPreset(floors) {
  const e = stackExtent(floors);
  const r = Math.hypot(e.w, e.d, e.h) / 2;
  return at(OVERVIEW_DIR, OVERVIEW_FIT * r, [0, (Math.max(1, e.count) - 1) * FLOOR_SPACING / 2 - 1, 0]);
}

/** Floor mode: the whole slab of `floor`, stacked at level index `index`. */
export function floorPreset(floor, index) {
  const { w, d } = floorFootprint(floor);
  return at(FLOOR_DIR, (FLOOR_FIT * Math.hypot(w, d)) / 2, [0, floorY(index), 0]);
}
