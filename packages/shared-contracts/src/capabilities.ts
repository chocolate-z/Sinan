/**
 * 能力位(Capability)— 单一真相源镜像自 spec/capabilities.json。
 * 任何改动须同步 spec 与 Python 绑定;consistency 测试会校验三者一致。
 */

export const CAPABILITIES = [
  'DAILY_OHLCV',
  'ADJ_FACTOR',
  'REALTIME_QUOTE',
  'FUNDAMENTAL',
  'FINA_INDICATOR',
  'DAILY_BASIC',
  'NORTHBOUND',
  'INDEX_OHLCV',
  'INDEX_WEIGHT',
  'SW_INDUSTRY',
  'EARNINGS_FORECAST',
  'TRADE_CAL',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** 能力位 → bit 偏移(与 spec.bit 一致),用于引擎位运算路由。 */
export const CAPABILITY_BIT: Record<Capability, number> = {
  DAILY_OHLCV: 0,
  ADJ_FACTOR: 1,
  REALTIME_QUOTE: 2,
  FUNDAMENTAL: 3,
  FINA_INDICATOR: 4,
  DAILY_BASIC: 5,
  NORTHBOUND: 6,
  INDEX_OHLCV: 7,
  INDEX_WEIGHT: 8,
  SW_INDUSTRY: 9,
  EARNINGS_FORECAST: 10,
  TRADE_CAL: 11,
};

/** 能力位 → 位掩码值(1 << bit)。 */
export const CAPABILITY_FLAG: Record<Capability, number> = Object.fromEntries(
  CAPABILITIES.map((c) => [c, 1 << CAPABILITY_BIT[c]]),
) as Record<Capability, number>;

/** caps_json 的对前端/DB 形态:能力名 → 是否具备。 */
export type CapsRecord = Partial<Record<Capability, boolean>>;

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** 把 CapsRecord 折叠为位掩码(仅 true 的能力置位)。 */
export function capsToFlag(caps: CapsRecord): number {
  let flag = 0;
  for (const cap of CAPABILITIES) {
    if (caps[cap]) flag |= CAPABILITY_FLAG[cap];
  }
  return flag;
}

/** 把位掩码展开为 CapsRecord(全部 12 个能力位都给出布尔值)。 */
export function flagToCaps(flag: number): Record<Capability, boolean> {
  const out = {} as Record<Capability, boolean>;
  for (const cap of CAPABILITIES) {
    out[cap] = (flag & CAPABILITY_FLAG[cap]) !== 0;
  }
  return out;
}
