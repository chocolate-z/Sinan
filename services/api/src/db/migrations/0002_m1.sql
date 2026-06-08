-- 司南 M1 迁移:策略 + 信号 + 成交 + 当日收益 + 双账持仓 + 模拟盘账本。
-- 个人/模型两套账本物理隔离(portfolio='model'|'personal'),严禁误聚合(总纲④)。
-- CHECK 枚举对齐契约(portfolio/action/side/reason),由 test_sql_contract 守护。

CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'factor_score' CHECK (kind IN ('factor_score', 'ml', 'hybrid')),
  params_json TEXT NOT NULL,
  universe_json TEXT,
  active_model_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 当日信号(含被风控拦截组,blocked=1 + reason)。
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  model_run_id TEXT,
  trade_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  score REAL,
  rank INTEGER,
  factor_breakdown_json TEXT,
  reason TEXT,                         -- signal/stop_loss/take_profit/rank_out/market_filter/...
  blocked INTEGER NOT NULL DEFAULT 0,  -- 1=已生成但被风控拦截(单独成组)
  executed INTEGER NOT NULL DEFAULT 0,
  effective_date TEXT,                 -- 信号滞后1日 = trade_date 下一交易日
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_signals ON signals (strategy_id, trade_date, stock_code);
CREATE INDEX idx_signals_date ON signals (trade_date);

-- 成交流水(两套共用,portfolio 区分;含完整成本明细)。
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  portfolio TEXT NOT NULL CHECK (portfolio IN ('model', 'personal')),
  strategy_id TEXT,
  stock_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  shares INTEGER NOT NULL,
  price REAL NOT NULL,
  amount REAL NOT NULL,
  commission REAL NOT NULL DEFAULT 0,
  stamp_tax REAL NOT NULL DEFAULT 0,
  transfer_fee REAL NOT NULL DEFAULT 0,
  impact REAL NOT NULL DEFAULT 0,
  reason TEXT CHECK (reason IN ('signal', 'stop_loss', 'take_profit', 'rank_out', 'market_filter', 'manual')),
  signal_id TEXT,
  trade_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_trades_pf_date ON trades (portfolio, trade_date);
CREATE INDEX idx_trades_code ON trades (stock_code);

-- 模型模拟盘持仓(自动)。
CREATE TABLE holdings_model (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  shares INTEGER NOT NULL,
  avg_cost REAL NOT NULL,
  current_price REAL,
  market_value REAL,
  buy_date TEXT NOT NULL,
  last_buy_date TEXT,
  float_pnl REAL,
  float_pnl_pct REAL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_holdings_model ON holdings_model (strategy_id, stock_code);

-- 个人持仓(手动维护)。
CREATE TABLE holdings_personal (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL UNIQUE,
  stock_name TEXT,
  shares INTEGER NOT NULL,
  avg_cost REAL NOT NULL,
  current_price REAL,
  market_value REAL,
  buy_date TEXT NOT NULL,
  last_buy_date TEXT,
  float_pnl REAL,
  float_pnl_pct REAL,
  note TEXT,
  updated_at TEXT NOT NULL
);

-- 当日收益(个人 + 模型分别记账)。
CREATE TABLE daily_pnl (
  id TEXT PRIMARY KEY,
  portfolio TEXT NOT NULL CHECK (portfolio IN ('model', 'personal')),
  strategy_id TEXT NOT NULL DEFAULT '',   -- personal 用 '' 占位以保证唯一约束
  trade_date TEXT NOT NULL,
  total_assets REAL NOT NULL,
  cash REAL NOT NULL,
  holding_value REAL NOT NULL,
  day_pnl REAL NOT NULL,
  day_pnl_pct REAL NOT NULL,
  cum_pnl_pct REAL,
  peak_assets REAL,
  drawdown REAL,
  benchmark_pct REAL,
  excess_pct REAL,
  degraded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_daily_pnl ON daily_pnl (portfolio, strategy_id, trade_date);
CREATE INDEX idx_pnl_date ON daily_pnl (trade_date);

-- 模拟盘账户净值轨迹(engine 跑、经 api 回传落地)。
CREATE TABLE sim_account (
  strategy_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  cash REAL NOT NULL,
  market_value REAL NOT NULL,
  nav REAL NOT NULL,
  daily_return REAL,
  drawdown REAL,
  PRIMARY KEY (strategy_id, trade_date)
);
