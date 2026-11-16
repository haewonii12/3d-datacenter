// Data schema validation + normalization. Three-free, pure.

/** @typedef {{path: string, message: string}} Issue */

const STATUSES = ['ok', 'warn', 'down'];
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isPosInt = (v) => isInt(v) && v > 0;
const hasStr = (v) => typeof v === 'string' && v.length > 0;
const heightOf = (s) => (isPosInt(s.height_u) ? s.height_u : 1);
const totalOf = (r) => (isPosInt(r.total_u) ? r.total_u : 42);

/** Legacy v1: top-level `floors` and no `datacenters` → one DC `default`, paths without prefix. */
const isLegacy = (json) => Boolean(json) && typeof json === 'object' && !('datacenters' in json) && 'floors' in json;

/**
 * Core analysis shared by validate and normalize.
 * Keys of excludedRacks / invalidServers are "di:fi:ri" / "di:fi:ri:si".
 * @param {any} json
 */
function analyze(json) {
  /** @type {Issue[]} */ const fatal = [];
  /** @type {Issue[]} */ const warnings = [];
  const info = { missingHeightU: 0 };
  const excludedRacks = new Set();
  const invalidServers = new Set();
  const F = (path, message) => fatal.push({ path, message });
  const W = (path, message) => warnings.push({ path, message });
  const out = { fatal, warnings, info, excludedRacks, invalidServers };

  if (isLegacy(json)) {
    analyzeFloors(json.floors, '', 0, F, W, info, excludedRacks, invalidServers);
    return out;
  }
  const dcs = json && json.datacenters;
  if (!Array.isArray(dcs) || dcs.length === 0) {
    F('datacenters', 'datacenters must be a non-empty array');
    return out;
  }
  const dcIds = new Set();
  dcs.forEach((dc, di) => {
    const dp = `datacenters[${di}]`;
    if (!dc || typeof dc !== 'object') {
      F(dp, 'datacenter must be an object');
      return;
    }
    if (!hasStr(dc.id)) F(`${dp}.id`, 'datacenter id is required');
    else if (dcIds.has(dc.id)) F(`${dp}.id`, `duplicate datacenter id "${dc.id}"`);
    else dcIds.add(dc.id);
    if (!hasStr(dc.name)) W(`${dp}.name`, 'datacenter name missing; id is used instead');
    analyzeFloors(dc.floors, `${dp}.`, di, F, W, info, excludedRacks, invalidServers);
  });
  return out;
}

/** Floors of one DC; floor/rack/server ids are unique within the DC only. */
function analyzeFloors(floors, prefix, di, F, W, info, excludedRacks, invalidServers) {
  if (!Array.isArray(floors) || floors.length === 0) {
    F(`${prefix}floors`, 'floors must be a non-empty array');
    return;
  }
  const floorIds = new Set();
  const rackIds = new Set();
  const serverIds = new Set();
  const dup = (set, id, path, what) => {
    if (set.has(id)) F(path, `duplicate ${what} id "${id}"`);
    else set.add(id);
  };

  floors.forEach((floor, fi) => {
    const fp = `${prefix}floors[${fi}]`;
    if (!floor || typeof floor !== 'object') {
      F(fp, 'floor must be an object');
      return;
    }
    if (!hasStr(floor.id)) F(`${fp}.id`, 'floor id is required');
    else dup(floorIds, floor.id, `${fp}.id`, 'floor');
    const gridOk = isPosInt(floor.rows) && isPosInt(floor.cols);
    if (!isPosInt(floor.rows)) F(`${fp}.rows`, 'rows must be a positive integer');
    if (!isPosInt(floor.cols)) F(`${fp}.cols`, 'cols must be a positive integer');

    const racks = Array.isArray(floor.racks) ? floor.racks : [];
    const slots = new Set();
    racks.forEach((rack, ri) => {
      const rp = `${fp}.racks[${ri}]`;
      if (!rack || typeof rack !== 'object') {
        F(rp, 'rack must be an object');
        return;
      }
      if (!hasStr(rack.id)) F(`${rp}.id`, 'rack id is required');
      else dup(rackIds, rack.id, `${rp}.id`, 'rack');

      let excluded = false;
      for (const [k, max] of [['row', floor.rows], ['col', floor.cols]]) {
        const v = rack[k];
        if (!isInt(v)) {
          W(`${rp}.${k}`, `${k} is missing or not an integer; rack excluded`);
          excluded = true;
        } else if (gridOk && (v < 1 || v > max)) {
          W(`${rp}.${k}`, `${k} ${v} is outside 1..${max}; rack excluded`);
          excluded = true;
        }
      }
      if (!excluded && gridOk) {
        const key = `${rack.row},${rack.col}`;
        if (slots.has(key)) {
          W(rp, `slot row ${rack.row}, col ${rack.col} already taken; rack excluded`);
          excluded = true;
        } else slots.add(key);
      }
      if (excluded) excludedRacks.add(`${di}:${fi}:${ri}`);

      const total = totalOf(rack);
      const servers = Array.isArray(rack.servers) ? rack.servers : [];
      const occupied = new Map(); // U -> true
      servers.forEach((s, si) => {
        const sp = `${rp}.servers[${si}]`;
        if (!s || typeof s !== 'object') {
          F(sp, 'server must be an object');
          return;
        }
        if (!hasStr(s.id)) F(`${sp}.id`, 'server id is required');
        else dup(serverIds, s.id, `${sp}.id`, 'server');
        if (s.unit === undefined || s.unit === null) F(`${sp}.unit`, 'unit is required');
        else if (!isInt(s.unit)) F(`${sp}.unit`, 'unit must be an integer');
        if (!hasStr(s.hostname)) W(`${sp}.hostname`, 'hostname missing; id is used instead');
        if (s.height_u === undefined || s.height_u === null) info.missingHeightU++;

        if (isInt(s.unit)) {
          const h = heightOf(s);
          let bad = false;
          if (s.unit < 1 || s.unit + h - 1 > total) {
            W(`${sp}.unit`, `U range ${s.unit}..${s.unit + h - 1} is outside 1..${total}`);
            bad = true;
          }
          let overlap = false;
          for (let u = s.unit; u < s.unit + h; u++) {
            if (occupied.has(u)) overlap = true;
            occupied.set(u, true);
          }
          if (overlap) {
            W(`${sp}.unit`, 'U range overlaps another server in the rack');
            bad = true;
          }
          if (bad) invalidServers.add(`${di}:${fi}:${ri}:${si}`);
        }

        (Array.isArray(s.services) ? s.services : []).forEach((svc, vi) => {
          const vp = `${sp}.services[${vi}]`;
          if (!svc || !hasStr(svc.name)) {
            W(`${vp}.name`, 'service name missing; service dropped');
            return;
          }
          if (!STATUSES.includes(svc.status)) {
            W(`${vp}.status`, `status must be one of ${STATUSES.join(', ')}; treated as unknown`);
          }
        });
      });
    });
  });
}

/**
 * @param {any} json
 * @returns {{fatal: Issue[], warnings: Issue[], info: {missingHeightU: number}}}
 */
export function validate(json) {
  const { fatal, warnings, info } = analyze(json);
  return { fatal, warnings, info };
}

/**
 * Returns a new normalized v2 dataset `{..., datacenters: [{id, name, floors}]}` (input is not mutated).
 * A legacy v1 file becomes one DC with id `default` and name = top-level `name` or "데이터센터".
 * @param {any} json
 */
export function normalize(json) {
  const { excludedRacks, invalidServers } = analyze(json);
  const floorsOf = (floors, di) =>
    (Array.isArray(floors) ? floors : []).map((floor, fi) => ({
      ...floor,
      racks: (Array.isArray(floor.racks) ? floor.racks : [])
        .map((rack, ri) => ({ rack, ri }))
        .filter(({ ri }) => !excludedRacks.has(`${di}:${fi}:${ri}`))
        .map(({ rack, ri }) => ({
          ...rack,
          total_u: totalOf(rack),
          servers: (Array.isArray(rack.servers) ? rack.servers : []).map((s, si) => {
            const { invalid: _stale, ...plain } = s; // re-derived below (edited data is normalized again)
            const out = {
              ...plain,
              hostname: hasStr(s.hostname) ? s.hostname : s.id,
              height_u: heightOf(s),
              services: (Array.isArray(s.services) ? s.services : [])
                .filter((svc) => svc && hasStr(svc.name))
                .map((svc) => ({
                  ...svc,
                  status: STATUSES.includes(svc.status) ? svc.status : 'unknown',
                })),
            };
            if (invalidServers.has(`${di}:${fi}:${ri}:${si}`)) out.invalid = true;
            return out;
          }),
        })),
    }));
  if (isLegacy(json)) {
    const { floors, ...rest } = json;
    return {
      ...rest,
      version: 2,
      datacenters: [{ id: 'default', name: hasStr(json.name) ? json.name : '데이터센터', floors: floorsOf(floors, 0) }],
    };
  }
  const dcs = Array.isArray(json && json.datacenters) ? json.datacenters : [];
  return {
    ...json,
    datacenters: dcs.map((dc, di) => ({ ...dc, name: hasStr(dc.name) ? dc.name : dc.id, floors: floorsOf(dc.floors, di) })),
  };
}
