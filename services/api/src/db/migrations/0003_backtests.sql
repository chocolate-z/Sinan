-- 司南 M2 迁移:回测结果。engine 计算(逐日撮合 + 硬守卫 + 含成本),api 落库展示。
-- nav_curve/metrics 体量小(数百点),直接以 JSON 存 SQLite;status 为内部枚举(不入契约)。

CREATE TABLE backtests (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  backtest_start TEXT NOT NULL,
  backtest_end TEXT NOT NULL,
  train_end TEXT NOT NULL,
  purge INTEGER NOT NULL,
  benchmark TEXT NOT NULL,
  initial_cash REAL NOT NULL,
  n_days INTEGER,
  n_trades INTEGER,
  total_cost REAL,
  cost_included INTEGER NOT NULL DEFAULT 1,   -- 红线#2:回测必含成本,恒为 1
  metrics_json TEXT,                          -- performance 聚合(年化/超额/MaxDD/Sharpe/IR/...)
  nav_curve_json TEXT,                        -- [{date, nav, benchmark}] 净值轨迹
  degraded_json TEXT,                         -- 因子降级标注
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('running', 'done', 'failed')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_backtests_created ON backtests (created_at);
