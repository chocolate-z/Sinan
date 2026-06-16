// api 响应类型(B4 类型安全):取代 client.ts 里的 any,让后端改字段名时前端编译期能发现。
// 口径以各页/store 实际消费 + 后端 repository/engine 返回为准;不确定的字段用可选 + 宽松类型,
// 宁可少断言也不给"假类型"(错误的精确类型比 unknown 更危险)。允许多余字段(后端可能多返)。

export interface Coverage {
  last_date?: string | null;
  first_date?: string | null;
  rows?: number;
  datasets?: Record<
    string,
    { first_date?: string | null; last_date?: string | null; rows?: number }
  >;
  [k: string]: unknown;
}

export interface LogEntry {
  id?: string;
  level: string;
  source: string;
  message: string;
  ts?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface ProviderInfo {
  id: string;
  name?: string;
  active?: boolean;
  configured?: boolean;
  fingerprint?: string | null;
  [k: string]: unknown;
}

export interface Signal {
  stock_code: string;
  stock_name?: string | null;
  action: string; // buy/sell/hold
  score?: number | null;
  factor_breakdown?: Record<string, number> | null;
  reason?: string;
  blocked?: boolean;
  [k: string]: unknown;
}

export interface Holding {
  stock_code: string;
  stock_name?: string | null;
  shares: number;
  avg_cost: number;
  market_value?: number | null;
  float_pnl?: number | null;
  day_pnl?: number | null;
  weight?: number | null;
  [k: string]: unknown;
}

export interface Trade {
  trade_date: string;
  code: string;
  side: string; // buy/sell
  shares: number;
  price: number;
  amount?: number | null;
  fee_total?: number | null;
  reason?: string;
  [k: string]: unknown;
}

export interface PnlDay {
  date: string;
  nav?: number | null;
  day_return?: number | null;
  [k: string]: unknown;
}

export interface PnlToday {
  pnl?: number | null;
  pnl_pct?: number | null;
  nav?: number | null;
  degraded?: boolean;
  [k: string]: unknown;
}

export interface Quote {
  stock_code: string;
  name?: string | null;
  price?: number | null;
  prev_close?: number | null;
  open?: number | null;
  source?: string | null;
}
export interface QuotesResult {
  degraded: boolean;
  quotes: Quote[];
}

export interface PriceBar {
  trade_date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  [k: string]: unknown;
}
export interface PricesResult {
  code: string;
  adjust: string;
  rows: PriceBar[];
  degraded?: boolean;
}

export interface ModelVersion {
  id: string;
  name?: string | null;
  status?: string; // running/active/...
  train_end?: string;
  model_type?: string;
  ic_oos?: number | null;
  icir_oos?: number | null;
  layered_sharpe_oos?: number | null;
  layered_annual_return_oos?: number | null;
  metrics_note?: string | null;
  created_at?: string;
  [k: string]: unknown;
}

export interface BacktestMetrics {
  annual_return?: number | null;
  total_return?: number | null;
  max_drawdown?: number | null;
  sharpe?: number | null;
  calmar?: number | null;
  excess_return?: number | null;
  benchmark_return?: number | null;
  information_ratio?: number | null;
  tracking_error?: number | null;
  win_rate?: number | null;
  profit_factor?: number | null;
  turnover?: number | null;
  [k: string]: unknown;
}
export interface BacktestResult {
  id?: string;
  backtest_start?: string;
  backtest_end?: string;
  train_end?: string;
  purge?: number;
  benchmark?: string;
  scoring?: string;
  model_id?: string | null;
  n_days?: number;
  n_trades?: number;
  cost_included?: boolean;
  metrics?: BacktestMetrics;
  nav_curve?: Array<Record<string, unknown>>;
  trades?: Trade[];
  degraded?: string[];
  [k: string]: unknown;
}

// 行情快照(收盘/实时共用)
export interface Breadth {
  total: number;
  up: number;
  down: number;
  flat: number;
  avg_chg: number;
}
export interface Sector {
  name: string;
  chg: number;
  count: number;
  up: number;
  down: number;
  lead: string;
  lead_chg: number;
  spark: number[];
}
export interface IndexBar {
  code: string;
  name: string;
  close: number | null;
  chg: number | null; // 涨跌幅 %;缺 prev/数据时 null(诚实显「—」)
  trade_date: string;
}
export interface MarketSnapshot {
  asof: string | null;
  breadth: Breadth | null;
  sectors: Sector[];
  indices?: IndexBar[]; // 大盘指数条(沪深300/中证500/上证/深证/创业板),来自缓存 index_ohlcv
  spark_days?: number;
  live?: boolean;
}
export interface SectorConstituents {
  industry: string;
  asof: string | null;
  constituents: Array<{
    stock_code: string;
    name?: string | null;
    price?: number | null;
    chg: number;
    turnover?: number | null;
  }>;
  live?: boolean;
}
