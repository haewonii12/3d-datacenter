import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dcHash } from './helpers.js';

const BASE = JSON.parse(readFileSync(new URL('./perf.baseline.json', import.meta.url), 'utf8'));

// Headless Chromium renders with SwiftShader (CPU): absolute numbers are not real-GPU numbers, so the gate
// compares against a baseline measured the same way (tests/e2e/perf.baseline.json), not an absolute target.
test('perf gate: first DC overview ready within baseline × 1.5; frame times logged', async ({ page }, info) => {
  test.skip(info.project.name !== 'dark', 'measured once (dark project)');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await page.goto(`/?debug=1${dcHash()}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok', { timeout: 30000 });
    await page.waitForFunction(() => window.__dc && window.__dc.isSettled(), null, { timeout: 15000 });
    runs.push(Date.now() - t0);
  }
  const median = [...runs].sort((a, b) => a - b)[1];
  const r = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const t0 = last;
        function f(now) {
          times.push(now - last);
          last = now;
          if (now - t0 < 3000) requestAnimationFrame(f);
          else resolve({ frames: times.length, ms: now - t0 });
        }
        requestAnimationFrame(f);
      }),
  );
  const limit = BASE.median * BASE.gateFactor;
  info.annotations.push({ type: 'perf', description: `ready ms ${JSON.stringify(runs)} median ${median} (limit ${limit}); ${r.frames} frames / ${r.ms.toFixed(0)}ms` });
  expect(r.frames).toBeGreaterThan(0);
  expect(median, `ready median ${median} ms vs baseline ${BASE.median} × ${BASE.gateFactor}`).toBeLessThanOrEqual(limit);
});
