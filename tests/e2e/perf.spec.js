import { test, expect } from '@playwright/test';

// Informational only: headless Chromium renders with SwiftShader (CPU), so this number is NOT
// representative of real-GPU performance. The real gate is the manual ≥55fps check in README.
test('perf (informational): overview rAF frame times over ~3s', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'ok');
  await page.waitForFunction(() => window.__dc && window.__dc.isSettled(), null, { timeout: 5000 });
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
          else resolve({ frames: times.length, ms: now - t0, times });
        }
        requestAnimationFrame(f);
      }),
  );
  const sorted = [...r.times].sort((a, b) => a - b);
  const fps = (r.frames / r.ms) * 1000;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`[perf] headless SwiftShader overview: ${r.frames} frames / ${r.ms.toFixed(0)}ms = ${fps.toFixed(1)} fps; frame p50 ${p50.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`);
  expect(r.frames).toBeGreaterThan(0);
});
