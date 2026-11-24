// Deterministic sample data generator (field-record format, one record per device).
// Usage: node scripts/gen-sample.mjs  → public/data/datacenter.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIXES = ['web', 'db', 'cache', 'api', 'batch', 'queue', 'search', 'auth', 'nas', 'sw'];
const COMPANIES = ['해원회사', '한빛솔루션', '누리텍', '다온시스템', '세움IT', '가람네트웍스', '미래데이터'];
const pad = (n, w) => String(n).padStart(w, '0');

/** build name, floors, zones per floor, rows × seq cells per zone, cell fill, rack-name / device code. */
export const DCS = [
  { name: '가산IDC', floors: 4, zones: ['A', 'B', 'C'], rows: 6, cols: 14, fill: 0.72, code: 'gs', rack: 10 },
  { name: '영등포IDC', floors: 3, zones: ['A', 'B'], rows: 7, cols: 16, fill: 0.68, code: 'yd', rack: 20 },
  { name: '파주IDC', floors: 2, zones: ['A', 'B', 'C'], rows: 8, cols: 18, fill: 0.62, code: 'pj', rack: 30 },
];

/** Records of one build from its own PRNG stream. Mount rules hold by construction (0 violations). */
function generateDc(spec, rnd) {
  const out = [];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let rackSeq = 0;
  let devSeq = 0;
  for (let level = 1; level <= spec.floors; level++)
    for (const zone of spec.zones)
      for (let row = 1; row <= spec.rows; row++) {
        let seq = 1;
        while (seq <= spec.cols) {
          if (rnd() > spec.fill) {
            seq++;
            continue;
          }
          // ~10% of racks span 2–5 cells of the row.
          const span = rnd() < 0.1 ? Math.min(2 + Math.floor(rnd() * 4), spec.cols - seq + 1) : 1;
          const cells = Array.from({ length: span }, (_, k) => `${level}${zone}${pad(row, 2)}${pad(seq + k, 2)}`);
          seq += span;
          rackSeq++;
          const base = { build_name: spec.name, floorspace_name: cells.join(','), rack_name: `RI${spec.rack}${pad(rackSeq, 6)}` };
          if (rnd() < 0.05) {
            out.push({ ...base, company: '', device_position: '', device_name: '' }); // empty rack
            continue;
          }
          const company = pick(COMPANIES);
          const target = Math.min(42, Math.round(42 * (0.12 + 0.88 * Math.pow(rnd(), 4))));
          const sharing = rnd() < 0.15; // racks with boundary-shared U pairs
          let next = 1; // first free U
          let prev = null;
          while (true) {
            const r = rnd();
            const h = r < 0.5 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
            // Boundary share: both devices ≥ 2U, the new one starts on the previous one's last U.
            const share = sharing && prev && prev.h >= 2 && h >= 2 && rnd() < 0.5;
            const s = share ? prev.e : next;
            const e = s + h - 1;
            if (e > 42 || s > target) break;
            devSeq++;
            out.push({
              ...base,
              company: rnd() < 0.8 ? company : pick(COMPANIES),
              device_position: `${h}U (${s}-${e})`,
              device_name: `${pick(PREFIXES)}-${spec.code}-${pad(devSeq, 5)}`,
            });
            prev = { s, e, h };
            next = e + 1;
          }
        }
      }
  return out;
}

/** @param {number} seed @returns {object[]} records */
export function generate(seed = 20261120) {
  return DCS.flatMap((spec, i) => generateDc(spec, mulberry32(seed + i * 7919)));
}

export function summarize(records) {
  const per = new Map();
  for (const r of records) {
    const d = per.get(r.build_name) || per.set(r.build_name, { racks: new Set(), devices: 0, spans: 0 }).get(r.build_name);
    if (!d.racks.has(r.rack_name) && r.floorspace_name.includes(',')) d.spans++;
    d.racks.add(r.rack_name);
    if (r.device_position) d.devices++;
  }
  return [...per].map(([name, d]) => ({ name, racks: d.racks.size, devices: d.devices, multiCellRacks: d.spans }));
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = resolve(here, '../public/data/datacenter.json');
  const records = generate();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(records));
  for (const d of summarize(records)) console.log(`${d.name}: racks=${d.racks} devices=${d.devices} multi-cell=${d.multiCellRacks}`);
  console.log(`records=${records.length} -> ${out}`);
}
