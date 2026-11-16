const KEYS = ['dc', 'floor', 'rack', 'server'];

/**
 * @param {string} hashString e.g. '#dc=seoul-1&floor=2F&rack=R1'
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

/**
 * All-null state serializes to ''.
 * @param {{dc?:string|null, floor?:string|null, rack?:string|null, server?:string|null}} state
 * @returns {string}
 */
export function serialize(state) {
  const parts = [];
  for (const k of KEYS) {
    const v = state[k];
    if (v != null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `#${parts.join('&')}` : '';
}
