import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, csvToDataset, datasetToCsv, decodeBytes, parseServices } from '../../src/data/csv.js';
import { parseCsvDataset } from '../../src/data/load.js';
import { validate, normalize } from '../../src/data/schema.js';

const enc = (s) => new TextEncoder().encode(s);
const HEAD = 'dc_id,dc_name,floor_id,floor_level,floor_rows,floor_cols,rack_id,rack_row,rack_col,total_u,server_id,hostname,ip,unit,height_u,services';

describe('parseCsv', () => {
  it('quotes, escaped quotes, CRLF, newline inside quotes, trailing newline', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",2\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2']]);
  });
  it('sniffs ; and tab delimiters from the header', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1,5\t2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
});

describe('decodeBytes', () => {
  it('UTF-8 with BOM, and CP949 (Korean Excel "CSV")', () => {
    expect(decodeBytes(enc('﻿서울,1'))).toBe('서울,1');
    const cp949 = new Uint8Array([100, 99, 95, 105, 100, 44, 102, 108, 111, 111, 114, 95, 105, 100, 44, 100, 99, 95, 110, 97, 109, 101, 10, 100, 49, 44, 49, 70, 44, 188, 173, 191, 239, 10]);
    expect(decodeBytes(cp949)).toBe('dc_id,floor_id,dc_name\nd1,1F,서울\n');
  });
});

describe('parseServices', () => {
  it('name|team|status; …, Korean statuses, optional team/status', () => {
    expect(parseServices('nginx|웹|ok; redis||경고;  api ; db|DBA|중단')).toEqual([
      { name: 'nginx', team: '웹', status: 'ok' },
      { name: 'redis', status: 'warn' },
      { name: 'api' },
      { name: 'db', team: 'DBA', status: 'down' },
    ]);
    expect(parseServices('')).toEqual([]);
  });
});

describe('csvToDataset', () => {
  it('groups rows into DC → floor → rack → server; empty rack and empty floor rows; defaults', () => {
    const csv = [
      HEAD,
      's1,서울,1F,1,2,4,RA,1,1,42,srv-1,web-01,10.0.0.1,1,2,nginx|웹|ok',
      's1,,1F,,,,RA,1,1,,,web-02,,5,,',
      's1,,1F,,,,,1,3,,,,,,,', // empty rack, id derived
      's1,,2F,2,3,3,,,,,,,,,,', // empty floor
      'b1,,1F,,,,RB,2,5,,s9,db-01,,10,4,',
      '',
    ].join('\n');
    const { json, errors } = csvToDataset(csv);
    expect(errors).toEqual([]);
    expect(json.datacenters.map((d) => [d.id, d.name])).toEqual([['s1', '서울'], ['b1', 'b1']]);
    const f1 = json.datacenters[0].floors[0];
    expect(f1).toMatchObject({ id: '1F', level: 1, rows: 2, cols: 4 });
    expect(f1.racks.map((r) => r.id)).toEqual(['RA', 'R-1F-01-03']);
    expect(f1.racks[0].servers).toEqual([
      { id: 'srv-1', hostname: 'web-01', ip: '10.0.0.1', unit: 1, height_u: 2, services: [{ name: 'nginx', team: '웹', status: 'ok' }] },
      { id: 'web-02', hostname: 'web-02', unit: 5, services: [] }, // id ← hostname, height_u omitted
    ]);
    expect(json.datacenters[0].floors[1]).toEqual({ id: '2F', level: 2, rows: 3, cols: 3, racks: [] });
    expect(json.datacenters[1].floors[0]).toMatchObject({ rows: 2, cols: 5 }); // grid inferred from racks
    expect(validate(json).fatal).toEqual([]);
  });
  it('Korean / spaced headers are accepted; unknown columns ignored', () => {
    const { json, errors } = csvToDataset('데이터센터 ID,층,랙 Row,랙 Col,호스트명,시작 U,비고\nd,1F,1,1,h1,3,메모');
    expect(errors).toEqual([]);
    expect(json.datacenters[0].floors[0].racks[0].servers[0]).toMatchObject({ id: 'h1', unit: 3 });
  });
  it('row-level errors carry the Excel row number', () => {
    const { json, errors } = csvToDataset(
      ['dc_id,floor_id,rack_row,rack_col,hostname,unit,floor_rows', 'd,1F,1,1,h1,x,5', ',1F,1,2,h2,1,', 'd,1F,,,h3,1,', 'd,1F,1,2,h4,,', '', 'd,1F,1,3,,4,', 'd,1F,2,2,h6,1,7'].join('\n'),
    );
    expect(json).toBe(null);
    expect(errors.map((e) => e.path)).toEqual(['2행 unit', '3행 dc_id', '4행 rack_row', '5행 unit', '7행 server_id', '8행 floor_rows']);
    expect(errors[5].message).toContain('5 ≠ 7');
  });
  it('missing required header → one error', () => {
    expect(csvToDataset('hostname,unit\nh,1').errors).toEqual([{ path: '1행 (헤더)', message: expect.stringContaining('dc_id, floor_id') }]);
    expect(csvToDataset(' \n').errors[0].path).toBe('CSV');
  });
});

describe('parseCsvDataset maps validator paths back to rows', () => {
  it('duplicate server id → fatal at the row; overlap → warning at the row', () => {
    const csv = [HEAD, 'd,,1F,,2,2,RA,1,1,,s1,a,,1,2,', 'd,,1F,,,,RA,1,1,,s2,b,,2,1,', 'd,,1F,,,,RB,1,2,,s1,c,,1,1,'].join('\n');
    const r = parseCsvDataset(enc(csv), 'x.csv');
    expect(r.data).toBe(null);
    expect(r.fatal).toEqual([{ path: 'x.csv 4행 id', message: 'duplicate server id "s1"' }]);
    const ok = parseCsvDataset(enc(csv.replace(',s1,c,', ',s3,c,')), 'x.csv');
    expect(ok.fatal).toEqual([]);
    expect(ok.warnings.map((w) => w.path)).toEqual(['x.csv 3행 unit']);
  });
});

describe('datasetToCsv round trip', () => {
  it('example file → CSV → dataset equals the normalized original', () => {
    const json = JSON.parse(readFileSync(new URL('../../examples/upload-example.json', import.meta.url), 'utf8'));
    const csv = datasetToCsv(normalize(json));
    expect(csv.startsWith('﻿' + HEAD + '\r\n')).toBe(true);
    const back = parseCsvDataset(enc(csv), 'e.csv');
    expect(back.fatal).toEqual([]);
    expect(back.warnings).toEqual([]);
    expect(back.data).toEqual(normalize(json));
  });
  it('the shipped examples/upload-example.csv loads cleanly', () => {
    const r = parseCsvDataset(readFileSync(new URL('../../examples/upload-example.csv', import.meta.url)), 'upload-example.csv');
    expect(r.fatal).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.data.datacenters.map((d) => d.id)).toEqual(['seoul-1', 'busan-1']);
  });
});
