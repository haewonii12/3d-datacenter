const KEYS = ['dc', 'floor', 'rack', 'server'];

/**
 * `#map` (and '') is the map entry screen: every key null.
 * @param {string} hashString e.g. '#dc=가산IDC&floor=2F&rack=R1'
 * @returns {{dc:string|null, floor:string|null, rack:string|null, server:string|null}}
 */
export function parse(hashString) {
  const out = { dc: null, floor: null, rack: null, server: null };
  const s = (hashString || '').replace(/^#/, '');
  for (const part of s.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i);
    if (!(k in out)) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1));
    } catch {
      /* malformed escape: ignore */
    }
  }
  return out;
}

/** Canonical hash of the map screen (no datacenter selected). */
export const MAP_HASH = '#map';

/**
 * A state without `dc` (the map) serializes to MAP_HASH.
 * @param {{dc?:string|null, floor?:string|null, rack?:string|null, server?:string|null}} state
 * @returns {string}
 */
export function serialize(state) {
  if (state.dc == null || state.dc === '') return MAP_HASH;
  const parts = [];
  for (const k of KEYS) {
    const v = state[k];
    if (v != null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `#${parts.join('&')}`;
}
