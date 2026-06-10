/** 数据源能力枚举 → 中文标签(key 与 engine Capability 枚举一致)。设置页与引导页共用,避免漂移。 */
export const CAP_LABELS: Record<string, string> = {
  DAILY_OHLCV: '日线行情',
  ADJ_FACTOR: '复权因子',
  DAILY_BASIC: '每日指标',
  FUNDAMENTAL: '财务数据',
  FINA_INDICATOR: '财务指标',
  NORTHBOUND: '北向资金',
  INDEX_OHLCV: '指数行情',
  INDEX_WEIGHT: '指数成分',
  SW_INDUSTRY: '申万行业',
  EARNINGS_FORECAST: '业绩预告',
  TRADE_CAL: '交易日历',
  REALTIME_QUOTE: '实时报价',
};

export function capLabel(k: string): string {
  return CAP_LABELS[k] ?? k;
}
