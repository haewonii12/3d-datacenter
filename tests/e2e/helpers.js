import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseDataset } from '../../src/data/load.js';

export const settled = (page) =>
  page.waitForFunction(() => window.__dc && window.__dc.isSettled(), null, { timeout: 10000 });

/** The first DC of the sample; legacy-style expectations ({floor, rack, server}) default to it. */
export const FIRST_DC = '가산IDC';
export const dcHash = (id = FIRST_DC) => `#dc=${encodeURIComponent(id)}`;

/** Opens the app at `hash` (default: the first DC's overview — the map is `bootMap`). */
export async function boot(page, hash = dcHash()) {
  await page.goto(`/?debug=1${hash}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  await settled(page);
}

/** Opens the app without a hash: the map entry screen. */
export async function bootMap(page) {
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  await expect(page.locator('#map-view')).toBeVisible();
  await settled(page);
}

export const dc = (page, fn, arg) => page.evaluate(fn, arg);
export const state = (page) => dc(page, () => window.__dc.state());

/** Polls the (async, hashchange-driven) state, then waits for transitions to finish. */
export async function reach(page, want) {
  await expect.poll(() => state(page)).toEqual({ dc: FIRST_DC, floor: null, rack: null, server: null, ...want });
  await settled(page);
}

/** The shipped sample, validated + normalized exactly as the app does (Node side, for expectations). */
export function loadSample() {
  const r = parseDataset(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8'), 'sample');
  if (r.fatal.length) throw new Error(JSON.stringify(r.fatal));
  return r.data;
}

/** Fails the test on any console error / page error (call in beforeEach, assert in afterEach). */
export function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
