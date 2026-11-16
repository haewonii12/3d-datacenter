import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validate, normalize } from '../../src/data/schema.js';
import { generate } from '../../scripts/gen-sample.mjs';

const srv = (o = {}) => ({ id: 's1', hostname: 'h1', unit: 1, height_u: 1, services: [], ...o });
const rack = (o = {}) => ({ id: 'r1', row: 1, col: 1, total_u: 42, servers: [], ...o });
const floor = (o = {}) => ({ id: 'F1', level: 1, rows: 2, cols: 3, racks: [rack()], ...o });
const ds = (floors) => ({ version: 1, floors }); // legacy v1: paths without a DC prefix
const dcOf = (o = {}) => ({ id: 'd1', name: 'D1', floors: [floor()], ...o });
const v2 = (datacenters) => ({ version: 2, datacenters });
const paths = (arr) => arr.map((i) => i.path);

describe('validate: valid input', () => {
  it('has no issues', () => {
    const r = validate(ds([floor()]));
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('validate: fatal', () => {
  it('floors not an array / empty', () => {
    expect(paths(validate({ floors: 'x' }).fatal)).toEqual(['floors']);
    expect(paths(validate(ds([])).fatal)).toEqual(['floors']);
  });
  it('floor missing id/rows/cols', () => {
    const r = validate(ds([floor({ id: undefined, rows: 0, cols: 1.5 })]));
    expect(paths(r.fatal)).toEqual(['floors[0].id', 'floors[0].rows', 'floors[0].cols']);
  });
  it('duplicate floor id', () => {
    const r = validate(ds([floor(), floor({ racks: [rack({ id: 'r2' })] })]));
    expect(paths(r.fatal)).toEqual(['floors[1].id']);
  });
  it('duplicate rack id (within the DC)', () => {
    const r = validate(ds([floor(), floor({ id: 'F2', racks: [rack()] })]));
    expect(paths(r.fatal)).toEqual(['floors[1].racks[0].id']);
  });
  it('duplicate server id', () => {
    const r = validate(ds([floor({ racks: [rack({ servers: [srv(), srv({ unit: 5 })] })] })]));
    expect(paths(r.fatal)).toEqual(['floors[0].racks[0].servers[1].id']);
  });
  it('rack missing id', () => {
    const r = validate(ds([floor({ racks: [rack({ id: undefined })] })]));
    expect(paths(r.fatal)).toEqual(['floors[0].racks[0].id']);
  });
  it('server missing id', () => {
    const r = validate(ds([floor({ racks: [rack({ servers: [srv({ id: undefined })] })] })]));
    expect(paths(r.fatal)).toEqual(['floors[0].racks[0].servers[0].id']);
  });
  it('server unit missing / non-integer', () => {
    const r = validate(ds([floor({ racks: [rack({ servers: [srv({ unit: undefined }), srv({ id: 's2', unit: 1.5 })] })] })]));
    expect(paths(r.fatal)).toEqual([
      'floors[0].racks[0].servers[0].unit',
      'floors[0].racks[0].servers[1].unit',
    ]);
  });
});

describe('validate: warnings', () => {
  const w = (racks) => validate(ds([floor({ racks })])).warnings;
  it('rack row/col missing, non-integer, out of grid', () => {
    expect(paths(w([rack({ row: undefined })]))).toEqual(['floors[0].racks[0].row']);
    expect(paths(w([rack({ col: 1.5 })]))).toEqual(['floors[0].racks[0].col']);
    expect(paths(w([rack({ row: 3 })]))).toEqual(['floors[0].racks[0].row']);
    expect(paths(w([rack({ col: 0 })]))).toEqual(['floors[0].racks[0].col']);
  });
  it('two racks in the same slot', () => {
    expect(paths(w([rack(), rack({ id: 'r2' })]))).toEqual(['floors[0].racks[1]']);
  });
  it('server unit < 1 or beyond total_u', () => {
    const a = w([rack({ servers: [srv({ unit: 0 })] })]);
    expect(paths(a)).toEqual(['floors[0].racks[0].servers[0].unit']);
    const b = w([rack({ servers: [srv({ unit: 42, height_u: 2 })] })]);
    expect(paths(b)).toEqual(['floors[0].racks[0].servers[0].unit']);
  });
  it('overlapping U ranges', () => {
    const r = w([rack({ servers: [srv({ unit: 5, height_u: 2 }), srv({ id: 's2', unit: 6 })] })]);
    expect(paths(r)).toEqual(['floors[0].racks[0].servers[1].unit']);
  });
  it('hostname missing', () => {
    const r = w([rack({ servers: [srv({ hostname: undefined })] })]);
    expect(paths(r)).toEqual(['floors[0].racks[0].servers[0].hostname']);
  });
  it('service name missing / bad status', () => {
    const r = w([rack({ servers: [srv({ services: [{ status: 'ok' }, { name: 'a', status: 'bad' }, { name: 'b' }] })] })]);
    expect(paths(r)).toEqual([
      'floors[0].racks[0].servers[0].services[0].name',
      'floors[0].racks[0].servers[0].services[1].status',
      'floors[0].racks[0].servers[0].services[2].status',
    ]);
  });
});

describe('validate: info', () => {
  it('counts servers without height_u', () => {
    const r = validate(ds([floor({ racks: [rack({ servers: [srv({ height_u: undefined }), srv({ id: 's2', unit: 3 })] })] })]));
    expect(r.info.missingHeightU).toBe(1);
  });
});

describe('normalize', () => {
  it('applies defaults, drops/marks, does not mutate', () => {
    const input = ds([floor({ racks: [
      rack({ total_u: undefined, servers: [
        srv({ hostname: undefined, height_u: undefined, services: [{ status: 'ok' }, { name: 'a', status: 'weird' }, { name: 'b', status: 'down' }] }),
        srv({ id: 's2', unit: 1 }),
        srv({ id: 's3', unit: 50 }),
      ] }),
      rack({ id: 'r2', row: 9 }),
    ] })]);
    const copy = JSON.stringify(input);
    const out = normalize(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(out.datacenters[0].floors[0].racks).toHaveLength(1);
    const r = out.datacenters[0].floors[0].racks[0];
    expect(r.total_u).toBe(42);
    const [a, b, c] = r.servers;
    expect(a.hostname).toBe('s1');
    expect(a.height_u).toBe(1);
    expect(a.services).toEqual([{ name: 'a', status: 'unknown' }, { name: 'b', status: 'down' }]);
    expect(a.invalid).toBeUndefined();
    expect(b.invalid).toBe(true); // overlaps earlier s1
    expect(c.invalid).toBe(true); // out of range
  });
  it('does not mark valid servers invalid', () => {
    const out = normalize(ds([floor({ racks: [rack({ servers: [srv()] })] })]));
    expect(out.datacenters[0].floors[0].racks[0].servers[0].invalid).toBeUndefined();
  });
});

describe('v2 datacenters', () => {
  it('valid multi-DC input has no issues; ids may repeat across DCs', () => {
    const r = validate(v2([dcOf(), dcOf({ id: 'd2', name: 'D2' })]));
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('datacenters not an array / empty', () => {
    expect(paths(validate({ version: 2, datacenters: 'x' }).fatal)).toEqual(['datacenters']);
    expect(paths(validate(v2([])).fatal)).toEqual(['datacenters']);
    expect(paths(validate({}).fatal)).toEqual(['datacenters']);
  });
  it('DC missing id / duplicate id', () => {
    expect(paths(validate(v2([dcOf({ id: undefined })])).fatal)).toEqual(['datacenters[0].id']);
    expect(paths(validate(v2([dcOf(), dcOf()])).fatal)).toEqual(['datacenters[1].id']);
  });
  it('DC missing name → warning, normalized to the id', () => {
    const input = v2([dcOf({ name: undefined })]);
    expect(paths(validate(input).warnings)).toEqual(['datacenters[0].name']);
    expect(normalize(input).datacenters[0].name).toBe('d1');
  });
  it('paths gain the datacenters[i]. prefix; uniqueness is per DC', () => {
    const r = validate(v2([dcOf(), dcOf({ id: 'd2', floors: [floor(), floor({ racks: [rack({ id: 'r2' })] })] })]));
    expect(paths(r.fatal)).toEqual(['datacenters[1].floors[1].id']);
    expect(paths(validate(v2([dcOf({ floors: [] })])).fatal)).toEqual(['datacenters[0].floors']);
    const w = validate(v2([dcOf(), dcOf({ id: 'd2', floors: [floor({ racks: [rack({ row: 9 })] })] })])).warnings;
    expect(paths(w)).toEqual(['datacenters[1].floors[0].racks[0].row']);
  });
  it('normalize keeps exclusions / invalid marks per DC', () => {
    const out = normalize(v2([
      dcOf(),
      dcOf({ id: 'd2', floors: [floor({ racks: [rack({ row: 9 }), rack({ id: 'r2', col: 2, servers: [srv({ unit: 50 })] })] })] }),
    ]));
    expect(out.datacenters[0].floors[0].racks.map((x) => x.id)).toEqual(['r1']);
    expect(out.datacenters[1].floors[0].racks.map((x) => x.id)).toEqual(['r2']);
    expect(out.datacenters[1].floors[0].racks[0].servers[0].invalid).toBe(true);
  });
  it('legacy v1 file → one DC "default" named by top-level name or 데이터센터', () => {
    const a = normalize({ version: 1, name: 'Old DC', floors: [floor()] });
    expect(a.floors).toBeUndefined();
    expect(a.datacenters.map((d) => [d.id, d.name])).toEqual([['default', 'Old DC']]);
    expect(a.datacenters[0].floors[0].id).toBe('F1');
    expect(normalize(ds([floor()])).datacenters[0].name).toBe('데이터센터');
  });
});

describe('sample dataset', () => {
  const data = JSON.parse(readFileSync(new URL('../../public/data/datacenter.json', import.meta.url), 'utf8'));
  it('satisfies AC1', () => {
    const r = validate(data);
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(data.version).toBe(2);
    // [id, name, floors, rows, cols, racks min..max, servers min..max]
    const want = [
      ['seoul-1', '서울 DC1', 4, 12, 20, 700, 950, 2000, 6000],
      ['busan-1', '부산 DC2', 3, 10, 16, 250, 480, 1200, 3500],
      ['daejeon-1', '대전 DC3', 2, 14, 24, 300, 672, 1500, 4500],
    ];
    expect(data.datacenters.map((d) => d.id)).toEqual(want.map((w) => w[0]));
    let allServers = 0;
    data.datacenters.forEach((dc, i) => {
      const [, name, nf, rows, cols, rmin, rmax, smin, smax] = want[i];
      expect(dc.name).toBe(name);
      expect(dc.floors).toHaveLength(nf);
      for (const f of dc.floors) expect([f.rows, f.cols]).toEqual([rows, cols]);
      expect(dc.floors.map((f) => f.id)).toEqual(Array.from({ length: nf }, (_, k) => `${k + 1}F`));
      const racks = dc.floors.flatMap((f) => f.racks);
      const servers = racks.flatMap((x) => x.servers);
      expect(racks.length).toBeGreaterThanOrEqual(rmin);
      expect(racks.length).toBeLessThanOrEqual(rmax);
      expect(servers.length).toBeGreaterThanOrEqual(smin);
      expect(servers.length).toBeLessThanOrEqual(smax);
      allServers += servers.length;
    });
    expect(allServers).toBeGreaterThanOrEqual(5000);
    expect(allServers).toBeLessThanOrEqual(12000);
    // Per-DC ids restart (every DC has 1F / R-1F-01-01-style racks); hostnames stay distinct overall.
    for (const dc of data.datacenters) expect(dc.floors[0].racks.some((r) => r.id.startsWith('R-1F-'))).toBe(true);
    const hosts = data.datacenters.flatMap((d) => d.floors.flatMap((f) => f.racks.flatMap((x) => x.servers.map((s) => s.hostname))));
    expect(new Set(hosts).size).toBe(hosts.length);
    const ratio = r.info.missingHeightU / allServers;
    expect(ratio).toBeGreaterThanOrEqual(0.03);
    expect(ratio).toBeLessThanOrEqual(0.08);
  });
  it('has a mix of occupancy colors and empty racks', () => {
    const occ = data.datacenters.flatMap((d) => d.floors).flatMap((f) => f.racks).map((r) =>
      r.servers.reduce((a, s) => a + (s.height_u ?? 1), 0) / r.total_u);
    expect(occ.some((o) => o === 0)).toBe(true);
    expect(occ.some((o) => o > 0 && o < 0.6)).toBe(true);
    expect(occ.some((o) => o >= 0.6 && o < 0.85)).toBe(true);
    expect(occ.some((o) => o >= 0.85)).toBe(true);
  });
  it('generator is deterministic and matches committed file', () => {
    expect(JSON.stringify(generate())).toBe(JSON.stringify(generate()));
    expect(generate()).toEqual(data);
  });
});

describe('examples/upload-example.json', () => {
  it('is a valid upload: no fatal, no warnings, 2 DCs', async () => {
    const { readFileSync } = await import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../../examples/upload-example.json', import.meta.url), 'utf8'));
    const r = validate(json);
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(normalize(json).datacenters.map((d) => d.id)).toEqual(['seoul-1', 'busan-1']);
  });
});
