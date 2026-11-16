import { it, expect } from 'vitest';
import { parse, serialize } from '../../src/state/hash.js';

const nul = { dc: null, floor: null, rack: null, server: null };

it('serialize/parse basic', () => {
  const s = { dc: 'seoul-1', floor: '2F', rack: 'R-2F-03-12', server: 'srv-0123' };
  expect(serialize(s)).toBe('#dc=seoul-1&floor=2F&rack=R-2F-03-12&server=srv-0123');
  expect(parse('#dc=seoul-1&floor=2F&rack=R-2F-03-12&server=srv-0123')).toEqual(s);
});
it('omits null parts; all-null is empty string', () => {
  expect(serialize({ dc: 'd', floor: '2F', rack: null, server: null })).toBe('#dc=d&floor=2F');
  expect(serialize({ floor: '2F', rack: null, server: null })).toBe('#floor=2F');
  expect(serialize(nul)).toBe('');
  expect(parse('')).toEqual(nul);
  expect(parse('#')).toEqual(nul);
  expect(parse('#server=x')).toEqual({ ...nul, server: 'x' });
});
it('legacy hash without dc parses with dc null', () => {
  expect(parse('#floor=2F&rack=R-2F-03-12')).toEqual({ ...nul, floor: '2F', rack: 'R-2F-03-12' });
});
it('roundtrips special characters', () => {
  const s = { dc: '서울 1', floor: 'a b', rack: 'x&y=z', server: '#/é 한' };
  expect(parse(serialize(s))).toEqual(s);
});
it('ignores malformed escapes', () => {
  expect(parse('#floor=%E0%A4%A&rack=r')).toEqual({ ...nul, rack: 'r' });
});
