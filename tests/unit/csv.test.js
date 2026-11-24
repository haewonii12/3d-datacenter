import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, csvToRecords, csvToDataset, datasetToCsv, decodeBytes } from '../../src/data/csv.js';
import { parseCsvDataset, parseDataset } from '../../src/data/load.js';
import { toStored } from '../../src/data/schema.js';

const HEADER = 'build_name,floorspace_name,company,rack_name,device_position,device_name';

describe('parseCsv', () => {
  it('quoted fields with commas, "" escapes, CRLF', () => {
    expect(parseCsv('a,"b,c","d""e"\r\n1,2,3\r\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]);
  });
});

describe('csvToRecords / csvToDataset', () => {
  it('maps headers (Korean aliases accepted) and keeps Excel row numbers', () => {
    const text = '빌딩,상면,회사,랙,장착위치,장비명\n가산IDC,3A0401,해원,R1,1U (39-39),web\n\n가산IDC,"3A0402,3A0403",해원,R2,2U (1-2),db\n';
    const { records, rows, errors } = csvToRecords(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([2, 4]);
    expect(records[1]).toEqual({ build_name: '가산IDC', floorspace_name: '3A0402,3A0403', company: '해원', rack_name: 'R2', device_position: '2U (1-2)', device_name: 'db' });
  });
  it('missing required header → one error', () => {
    expect(csvToRecords('a,b\n1,2').errors).toEqual([{ path: '1행 (헤더)', message: expect.stringMatching(/build_name/) }]);
  });
  it('rows without a device declare empty racks', () => {
    const { json } = csvToDataset(`${HEADER}\n가산IDC,3A0401,,R1,,\n`);
    expect(json.datacenters[0].floors[0].racks[0]).toMatchObject({ id: 'R1', floorspaces: ['3A0401'], servers: [] });
  });
});

describe('parseCsvDataset: messages cite the Excel row', () => {
  it('violations example', () => {
    const r = parseCsvDataset(readFileSync('examples/violations.csv'), 'v.csv');
    expect(r.fatal).toEqual([]);
    const byKind = (k) => r.warnings.filter((w) => w.kind === k).map((w) => w.path);
    expect(byKind('mount-overlap')).toEqual(['v.csv 2행', 'v.csv 4행', 'v.csv 6행']);
    expect(byKind('position-invalid')).toEqual(['v.csv 13행', 'v.csv 14행']);
    expect(byKind('rack-cell-conflict')).toEqual(['v.csv 11행']);
    expect(byKind('rack-noncontiguous')).toEqual(['v.csv 12행']);
    expect(byKind('unknown-build')).toHaveLength(1);
    // boundary-ok-a / boundary-ok-b (3U (29-31) + 2U (31-32)) are not flagged
    const rack = r.data.datacenters[0].floors[0].racks.find((x) => x.id === 'RV-OVERLAP');
    expect(rack.servers.filter((s) => s.violation).map((s) => s.device_name)).toEqual(['overlap-a', 'overlap-b']);
  });
  it('shipped upload examples load cleanly (CSV and JSON agree)', () => {
    const c = parseCsvDataset(readFileSync('examples/upload-example.csv'), 'e.csv');
    const j = parseDataset(readFileSync('examples/upload-example.json', 'utf8'), 'e.json');
    expect([c.fatal, c.warnings, j.fatal, j.warnings]).toEqual([[], [], [], []]);
    expect(toStored(c.data)).toEqual(toStored(j.data));
  });
});

describe('datasetToCsv', () => {
  it('round-trips multi-cell floorspace lists and empty racks; BOM for Excel', () => {
    const src = parseCsvDataset(readFileSync('examples/upload-example.csv'), 'e.csv').data;
    const csv = datasetToCsv(src);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"3A0402,3A0403"');
    expect(csv).toContain('가산IDC,3A0404,,RI20261122,,');
    const back = parseCsvDataset(new TextEncoder().encode(csv), 'back.csv');
    expect(back.warnings).toEqual([]);
    expect(toStored(back.data)).toEqual(toStored(src));
  });
  it('decodeBytes falls back to EUC-KR', () => {
    const euc = new Uint8Array([0xb0, 0xa1]); // '가'
    expect(decodeBytes(euc)).toBe('가');
  });
});
