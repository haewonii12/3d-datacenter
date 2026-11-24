import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
const BASE = `http://localhost:${PORT}`;
/** A non-default port builds into its own folder so two e2e runs never write dist/ at the same time. */
const OUT = PORT === 4173 ? 'dist' : `node_modules/.e2e-dist-${PORT}`;
/** Every spec runs under both themes; the theme is preset through localStorage (src/ui/theme.js). */
const themed = (theme) => ({
  name: theme,
  use: { storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'dc3d.theme', value: theme }] }] } },
});

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    ...devices['Desktop Chrome'],
    // Deliberately 1280×720 (common laptop); set after the device spread so it is not overridden.
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [themed('dark'), themed('light')],
  webServer: {
    command: `npx vite build --outDir ${OUT} --emptyOutDir && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
