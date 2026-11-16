// Deterministic sample data generator. Usage: node scripts/gen-sample.mjs
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

const PREFIXES = ['web', 'db', 'cache', 'api', 'batch', 'queue', 'search', 'auth'];
const SERVICES = [
  'payment-api', 'order-api', 'user-api', 'auth-service', 'search-indexer', 'search-api',
  'cart-service', 'inventory-sync', 'notification-hub', 'email-sender', 'sms-gateway',
  'image-resizer', 'cdn-origin', 'redis-cache', 'postgres-primary', 'postgres-replica',
  'kafka-broker', 'log-collector', 'metrics-agent', 'batch-scheduler', 'report-builder',
  'recommendation-engine', 'session-store', 'api-gateway', 'config-server',
];
const TEAMS = ['결제팀', '검색팀', '플랫폼팀', '주문팀', '회원팀', '인프라팀', '데이터팀', '보안팀'];

/** id, name, floor count, grid, base slot fill, hostname/IP code. Floor/rack/server ids restart per DC; hostnames carry the code. */
export const DCS = [
  { id: 'seoul-1', name: '서울 DC1', floors: 4, rows: 12, cols: 20, fill: 0.78, code: 'sel', ip: 10 },
  { id: 'busan-1', name: '부산 DC2', floors: 3, rows: 10, cols: 16, fill: 0.62, code: 'pus', ip: 20 },
  { id: 'daejeon-1', name: '대전 DC3', floors: 2, rows: 14, cols: 24, fill: 0.58, code: 'dj', ip: 30 },
];

/** One DC from its own PRNG stream (seoul-1 keeps the v1 sample's layout for the same seed). */
function generateDc(spec, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pad = (n, w) => String(n).padStart(w, '0');
  let serverSeq = 0;
  const floors = [];
  for (let level = 1; level <= spec.floors; level++) {
    const id = `${level}F`;
    const { rows, cols } = spec;
    const slotFill = spec.fill + rnd() * 0.12;
    const ipCounter = {};
    const racks = [];
    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= cols; col++) {
        if (rnd() > slotFill) continue;
        const rack = { id: `R-${id}-${pad(row, 2)}-${pad(col, 2)}`, row, col, total_u: 42, servers: [] };
        racks.push(rack);
        if (rnd() < 0.012) continue; // a few completely empty racks
        const target = Math.min(42, Math.round(42 * (0.1 + 0.9 * Math.pow(rnd(), 5))));
        let unit = 1;
        while (unit <= 42) {
          const r = rnd();
          let h = r < 0.6 ? 1 : r < 0.9 ? 2 : 4;
          const omit = rnd() < 0.055;
          if (omit) h = 1;
          if (unit + h - 1 > 42 || unit - 1 >= target) break;
          serverSeq++;
          const prefix = pick(PREFIXES);
          ipCounter[row] = (ipCounter[row] || 0) + 1;
          const server = {
            id: `srv-${pad(serverSeq, 5)}`,
            hostname: `${prefix}-${spec.code}-${pad(serverSeq, 4)}`,
            ip: `10.${spec.ip + level}.${row}.${((ipCounter[row] - 1) % 254) + 1}`,
            unit,
          };
          if (!omit) server.height_u = h;
          const n = 1 + Math.floor(rnd() * 5);
          const used = new Set();
          server.services = [];
          while (server.services.length < n) {
            const si = Math.floor(rnd() * SERVICES.length);
            if (used.has(si)) continue;
            used.add(si);
            const s = rnd();
            server.services.push({
              name: SERVICES[si],
              team: TEAMS[si % TEAMS.length],
              status: s < 0.85 ? 'ok' : s < 0.95 ? 'warn' : 'down',
            });
          }
          rack.servers.push(server);
          unit += h;
        }
      }
    }
    floors.push({ id, level, rows, cols, racks });
  }
  return { id: spec.id, name: spec.name, floors };
}

/** @param {number} seed */
export function generate(seed = 20261116) {
  return { version: 2, datacenters: DCS.map((spec, i) => generateDc(spec, mulberry32(seed + i * 7919))) };
}

export function summarize(data) {
  const per = data.datacenters.map((dc) => {
    let racks = 0, servers = 0, noH = 0;
    for (const f of dc.floors) for (const r of f.racks) {
      racks++;
      for (const s of r.servers) { servers++; if (s.height_u === undefined) noH++; }
    }
    return { id: dc.id, floors: dc.floors.length, racks, servers, noH };
  });
  const servers = per.reduce((a, d) => a + d.servers, 0);
  const noH = per.reduce((a, d) => a + d.noH, 0);
  return { per, racks: per.reduce((a, d) => a + d.racks, 0), servers, pctNoHeight: +(100 * noH / servers).toFixed(2) };
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = resolve(here, '../public/data/datacenter.json');
  const data = generate();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data));
  const s = summarize(data);
  for (const d of s.per) console.log(`${d.id}: floors=${d.floors} racks=${d.racks} servers=${d.servers}`);
  console.log(`total racks=${s.racks} servers=${s.servers} missing_height_u=${s.pctNoHeight}% -> ${out}`);
}
