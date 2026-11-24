// Device mounting rules inside one rack. Pure: no DOM, no three.
// A device spans U s..e (inclusive). Two devices may share exactly one U, and only at the boundary:
// the lower device's last U is the upper device's first U (e.g. 3U (29-31) + 2U (31-32)).
// Identical ranges, containment and overlaps of 2U or more are violations — so a 1U device never shares a U.

/** @typedef {{id:string, s:number, e:number}} Mount */

const ord = (a, b) => a.s - b.s || a.e - b.e;
const span = (d) => (d.s === d.e ? `U${d.s}` : `U${d.s}–${d.e}`);

/** True when lower/upper (ordered by start) share only the boundary U. */
export function isBoundaryShare(lower, upper) {
  return lower.s < upper.s && lower.e === upper.s && upper.e > lower.e;
}

/**
 * Pairwise check (O(n²) per rack; n ≤ total_u).
 * @param {Mount[]} devices valid mounts only (parse failures are handled by the caller)
 * @returns {{kind:'mount-overlap'|'mount-crowded', message:string, devices:string[]}[]}
 */
export function checkMounts(devices) {
  const list = [...devices].sort(ord);
  const issues = [];
  for (let i = 0; i < list.length; i++) {
    const L = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const U = list[j];
      if (U.s > L.e) break; // sorted by start: no later device can overlap L
      if (isBoundaryShare(L, U)) continue;
      issues.push({
        kind: 'mount-overlap',
        message: `${span(L)}와(과) ${span(U)}가 겹칩니다 (경계 U 하나만 공유할 수 있습니다)`,
        devices: [L.id, U.id],
      });
    }
  }
  // Defensive: cannot happen on its own under the pair rule, but catches corrupted input.
  const perU = new Map();
  for (const d of list) for (let u = d.s; u <= d.e; u++) perU.set(u, [...(perU.get(u) || []), d.id]);
  for (const [u, ids] of perU) {
    if (ids.length > 2) issues.push({ kind: 'mount-crowded', message: `U${u}에 장비가 ${ids.length}대입니다 (최대 2대)`, devices: ids });
  }
  return issues;
}

/**
 * Half-U trims for legal boundary shares: in a shared U the lower device keeps the bottom half,
 * the upper device the top half.
 * @param {Mount[]} devices
 * @returns {Map<string, {trimTop:boolean, trimBottom:boolean}>} only devices that share a U
 */
export function sharedUnits(devices) {
  const list = [...devices].sort(ord);
  const out = new Map();
  const get = (id) => out.get(id) || out.set(id, { trimTop: false, trimBottom: false }).get(id);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const L = list[i];
      const U = list[j];
      if (U.s > L.e) break;
      if (isBoundaryShare(L, U)) {
        get(L.id).trimTop = true;
        get(U.id).trimBottom = true;
      }
    }
  return out;
}
