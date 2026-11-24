/**
 * @typedef {{dcId:string, dcName:string, floorId:string, rackId:string, rackName:string, cells:string, serverId:string, deviceName:string, company:string}} IndexEntry
 * @typedef {{type:'device'|'rack'|'company', dcId:string, floorId:string, rackId:string, serverId:string|null, label:string, sub:string}} SearchResult
 */

/** One entry per device (and one per empty rack) across every DC. @returns {IndexEntry[]} */
export function buildIndex(data) {
  const out = [];
  for (const dc of data.datacenters)
    for (const f of dc.floors)
      for (const r of f.racks) {
        const base = { dcId: dc.id, dcName: dc.name, floorId: f.id, rackId: r.id, rackName: r.name || r.id, cells: r.floorspaces.join(',') };
        if (!r.servers.length) out.push({ ...base, serverId: null, deviceName: '', company: '' });
        for (const s of r.servers) out.push({ ...base, serverId: s.id, deviceName: s.device_name || '', company: s.company || '' });
      }
  return out;
}

/**
 * Case-insensitive substring search over device_name, rack_name and company. A device appears once
 * (device name > rack name > company); a rack-name hit is reported once per rack.
 * `sub` = `rack_name · floorspace`, plus ` · {DC name}` when the result is in another DC than `currentDc`.
 * @param {IndexEntry[]} index
 * @returns {SearchResult[]}
 */
export function search(index, query, limit = 20, currentDc = null) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const racksSeen = new Set();
  for (const e of index) {
    const base = { dcId: e.dcId, floorId: e.floorId, rackId: e.rackId, serverId: e.serverId };
    const where = (sub) => (currentDc == null || e.dcId === currentDc ? sub : `${sub} · ${e.dcName}`);
    const at = where(`${e.rackName} · ${e.cells}`);
    if (e.serverId && e.deviceName.toLowerCase().includes(q)) {
      out.push({ type: 'device', ...base, label: e.deviceName, sub: at });
    } else if (e.rackName.toLowerCase().includes(q)) {
      const k = `${e.dcId}\u0000${e.rackId}`;
      if (!racksSeen.has(k)) {
        racksSeen.add(k);
        out.push({ type: 'rack', ...base, serverId: null, label: e.rackName, sub: where(e.cells) });
      }
    } else if (e.serverId && e.company.toLowerCase().includes(q)) {
      out.push({ type: 'company', ...base, label: e.company, sub: where(`${e.deviceName} · ${e.rackName}`) });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
