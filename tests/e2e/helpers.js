import { expect } from '@playwright/test';

export const settled = (page) =>
  page.waitForFunction(() => window.__dc && window.__dc.isSettled(), null, { timeout: 5000 });

export async function boot(page, hash = '') {
  await page.goto(`/?debug=1${hash}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  await settled(page);
}

export const dc = (page, fn, arg) => page.evaluate(fn, arg);
export const state = (page) => dc(page, () => window.__dc.state());

/** The first DC of the sample; legacy-style expectations ({floor, rack, server}) default to it. */
export const FIRST_DC = 'seoul-1';

/** Polls the (async, hashchange-driven) state, then waits for transitions to finish. */
export async function reach(page, want) {
  await expect.poll(() => state(page)).toEqual({ dc: FIRST_DC, floor: null, rack: null, server: null, ...want });
  await settled(page);
}
