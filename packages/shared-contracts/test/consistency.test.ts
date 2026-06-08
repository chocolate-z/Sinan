import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_BIT,
  CAPABILITY_FLAG,
  capsToFlag,
  flagToCaps,
} from '../src/capabilities.js';
import { ENUM_MIRROR } from '../src/enums.js';
import { API_BASE, HEADERS, API_ENDPOINTS, ENGINE_ENDPOINTS, buildPath } from '../src/endpoints.js';

function spec(name: string): any {
  const url = new URL(`../spec/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf-8'));
}

describe('capabilities ↔ spec', () => {
  const caps = spec('capabilities.json').capabilities as Array<{ name: string; bit: number }>;

  it('names match spec order', () => {
    expect(CAPABILITIES).toEqual(caps.map((c) => c.name));
  });

  it('bit offsets match spec', () => {
    for (const c of caps) {
      expect(CAPABILITY_BIT[c.name as never]).toBe(c.bit);
      expect(CAPABILITY_FLAG[c.name as never]).toBe(1 << c.bit);
    }
  });

  it('capsToFlag / flagToCaps round-trip', () => {
    const flag = capsToFlag({ NORTHBOUND: true, DAILY_OHLCV: true });
    expect(flag).toBe(CAPABILITY_FLAG.NORTHBOUND | CAPABILITY_FLAG.DAILY_OHLCV);
    const back = flagToCaps(flag);
    expect(back.NORTHBOUND).toBe(true);
    expect(back.DAILY_OHLCV).toBe(true);
    expect(back.FUNDAMENTAL).toBe(false);
  });
});

describe('enums ↔ spec', () => {
  const enums = spec('enums.json') as Record<string, unknown>;

  it('every spec enum has a matching TS binding (and vice versa)', () => {
    const specKeys = Object.keys(enums).filter((k) => !k.startsWith('$'));
    expect(Object.keys(ENUM_MIRROR).sort()).toEqual(specKeys.sort());
  });

  it('each enum has identical members in identical order', () => {
    for (const [key, members] of Object.entries(ENUM_MIRROR)) {
      expect(members).toEqual(enums[key]);
    }
  });
});

describe('endpoints ↔ spec', () => {
  const ep = spec('endpoints.json');

  it('base + headers match', () => {
    expect(API_BASE).toBe(ep.api_base);
    expect(HEADERS.sessionToken).toBe(ep.headers.session_token);
    expect(HEADERS.internal).toBe(ep.headers.internal);
  });

  it('api endpoints match spec exactly', () => {
    expect(API_ENDPOINTS).toEqual(ep.api);
  });

  it('engine endpoints match spec exactly', () => {
    expect(ENGINE_ENDPOINTS).toEqual(ep.engine);
  });
});

describe('buildPath', () => {
  it('fills params and url-encodes', () => {
    expect(buildPath(API_ENDPOINTS.credential_put.path, { id: 'tushare' })).toBe(
      '/providers/tushare/credential',
    );
    expect(buildPath(API_ENDPOINTS.jobs_get.path, { id: '01J/x' })).toBe('/jobs/01J%2Fx');
  });

  it('throws on missing param', () => {
    expect(() => buildPath('/jobs/:id', {})).toThrow();
  });
});
