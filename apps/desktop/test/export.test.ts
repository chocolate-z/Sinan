import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/lib/export';

describe('toCsv', () => {
  it('serializes rows with header from keys', () => {
    const csv = toCsv([
      { date: '2024-01-02', nav: 1000000, ret: 0.01 },
      { date: '2024-01-03', nav: 1010000, ret: -0.005 },
    ]);
    expect(csv).toBe('date,nav,ret\n2024-01-02,1000000,0.01\n2024-01-03,1010000,-0.005');
  });

  it('respects explicit column order/subset', () => {
    const csv = toCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a']);
    expect(csv).toBe('c,a\n3,1');
  });

  it('escapes commas, quotes and newlines; null → empty; objects → JSON', () => {
    const csv = toCsv([{ name: 'a,b', note: 'he said "hi"', x: null, pos: { k: 1 } }]);
    expect(csv).toBe('name,note,x,pos\n"a,b","he said ""hi""",,"{""k"":1}"');
  });

  it('empty rows → empty string', () => {
    expect(toCsv([])).toBe('');
  });
});
