// Light / dark themes: scene colours and lighting, plus `html[data-theme]` for the CSS variables.
// The choice persists in localStorage['dc3d.theme'] (default dark).

export const THEME_KEY = 'dc3d.theme';

export const THEMES = {
  dark: {
    name: 'dark',
    bg: ['#1d2633', '#0b0f15'], // vertical gradient top → bottom
    fog: { color: 0x0f141b, near: 60, far: 220 },
    hemi: { sky: 0xdde6f0, ground: 0x20242c, intensity: 1.5 },
    sun: { intensity: 1.9 },
    slab: 0x1c232d,
    tile: { a: '#27303c', b: '#232b36', line: '#38424f' },
    wall: { color: 0x4a5566, opacity: 0.85 },
    zoneText: 'rgba(200,210,225,0.55)',
    emptyLine: 0x8b949e,
    edge: 0x8b949e,
    cabinet: { frame: 0x3a414b, panel: 0x161b22 },
    device: 0x5b6b82,
  },
  light: {
    name: 'light',
    bg: ['#f7f9fb', '#d5dbe3'],
    fog: { color: 0xe3e7ec, near: 70, far: 240 },
    hemi: { sky: 0xffffff, ground: 0x9aa3ad, intensity: 1.7 },
    sun: { intensity: 2.3 },
    slab: 0xc3c9d1,
    tile: { a: '#eef1f4', b: '#e4e8ec', line: '#c5ccd4' },
    wall: { color: 0xaab2bd, opacity: 0.9 },
    zoneText: 'rgba(60,70,85,0.45)',
    emptyLine: 0x6e7781,
    edge: 0x57606a,
    cabinet: { frame: 0x2d333b, panel: 0x1c2128 },
    device: 0x6b7889,
  },
};

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let current = THEMES[storage()?.getItem(THEME_KEY)] ?? THEMES.dark;
let revision = 0;
const subs = new Set();

export const getTheme = () => current;
/** Bumped on every switch; the scene compares it to know its build is stale. */
export const themeRevision = () => revision;

export function setTheme(name) {
  const next = THEMES[name];
  if (!next || next === current) return;
  current = next;
  revision++;
  try {
    storage()?.setItem(THEME_KEY, name);
  } catch {
    /* storage full / blocked: the theme still applies for this page */
  }
  applyDocumentTheme();
  for (const fn of [...subs]) fn(current);
}

export function onThemeChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function applyDocumentTheme() {
  document.documentElement.dataset.theme = current.name;
}

/** Toggle button (☀ / ☾) for the top bar. */
export function createThemeToggle(button) {
  const sync = () => {
    const light = current.name === 'light';
    button.textContent = light ? '☾ 어둡게' : '☀ 밝게';
    button.title = light ? '어두운 테마로 전환' : '밝은 테마로 전환';
    button.dataset.theme = current.name;
  };
  button.addEventListener('click', () => setTheme(current.name === 'light' ? 'dark' : 'light'));
  onThemeChange(sync);
  sync();
}
