/**
 * @typedef {{dcId:string, dcName:string, floorId:string, rackId:string, serverId:string, hostname:string, services:string[]}} IndexEntry
 * @typedef {{type:'hostname'|'service', dcId:string, floorId:string, rackId:string, serverId:string, label:string, sub:string}} SearchResult
 */

/** One entry per server across every DC. @returns {IndexEntry[]} */
export function buildIndex(data) {
  const out = [];
  for (const dc of data.datacenters)
    for (const f of dc.floors)
      for (const r of f.racks)
        for (const s of r.servers)
          out.push({
            dcId: dc.id,
            dcName: dc.name,
            floorId: f.id,
            rackId: r.id,
            serverId: s.id,
            hostname: s.hostname,
            services: (s.services || []).map((x) => x.name),
          });
  return out;
}

/**
 * Case-insensitive substring search; a server appears once (hostname match wins).
 * `sub` gets ` · {DC name}` when `currentDc` is given and the result's DC differs from it.
 * @param {IndexEntry[]} index
 * @param {string} query
 * @param {number} [limit]
 * @param {string|null} [currentDc]
 * @returns {SearchResult[]}
 */
export function search(index, query, limit = 20, currentDc = null) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const e of index) {
    const base = { dcId: e.dcId, floorId: e.floorId, rackId: e.rackId, serverId: e.serverId };
    const where = (sub) => (currentDc == null || e.dcId === currentDc ? sub : `${sub} · ${e.dcName}`);
    if (e.hostname.toLowerCase().includes(q)) {
      out.push({ type: 'hostname', ...base, label: e.hostname, sub: where(e.rackId) });
    } else {
      for (const name of e.services) {
        if (name.toLowerCase().includes(q)) {
          out.push({ type: 'service', ...base, label: name, sub: where(e.hostname) });
        }
      }
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
