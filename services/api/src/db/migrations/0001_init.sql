-- 司南 M0 初始迁移。SQLite 仅由 api 写入(单一写者,WAL);engine 只读。
-- 连接级 PRAGMA(journal_mode=WAL, foreign_keys=ON, busy_timeout=5000)由 api 打开连接时设置。
-- 红线#4:credentials 表绝无明文 token 列 —— token 只入 OS 钥匙串或 AES-GCM 密文。

-- 迁移版本台账(api 迁移器写入)。
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- 设置(KV)。onboarding 状态机也存于此(key='onboarding.step' / 'onboarding.done')。
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                       -- JSON 编码值
  scope TEXT NOT NULL DEFAULT 'app',          -- app / ui / runtime
  updated_at TEXT NOT NULL
);

-- 数据源注册表(内置只读 + 用户可改优先级/状态)。
CREATE TABLE providers (
  id TEXT PRIMARY KEY,                         -- tushare / akshare / realtime_sina / realtime_tencent
  display_name TEXT NOT NULL,
  caps_json TEXT NOT NULL,                     -- 能力声明(能力名→bool)
  needs_token INTEGER NOT NULL,
  rate_limit_json TEXT,
  priority INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok', 'error', 'unknown')),
  last_check_at TEXT
);

-- 凭据(加密)。绝无明文 token 列。
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  key_ref TEXT NOT NULL CHECK (key_ref IN ('keychain', 'aes-gcm')),
  keyring_ref TEXT,                            -- key_ref='keychain' 时的钥匙串条目名
  cipher BLOB,                                 -- key_ref='aes-gcm' 兜底:AES-256-GCM 密文
  nonce BLOB,
  tag BLOB,
  fingerprint TEXT,                            -- 明文 token 的 SHA-256 前 8 位,仅 UI 显示掩码
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 数据/训练作业(冷启动建缓存、断点续传核心)。
CREATE TABLE data_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('cache_build', 'incremental', 'train', 'signal_gen', 'paper_run', 'news_fetch')),
  provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'done', 'failed', 'canceled')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule', 'onboarding')),
  params_json TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cursor_json TEXT,                            -- 断点游标 {last_code,last_dataset,page}
  progress REAL NOT NULL DEFAULT 0,
  rate_limit_json TEXT,                        -- 限速状态(令牌桶剩余/冷却到点)
  lineage_json TEXT,                           -- 数据血缘快照
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON data_jobs (status);
CREATE INDEX idx_jobs_type ON data_jobs (type);

-- 缓存覆盖台账(增量与血缘的单一事实源)。
CREATE TABLE data_coverage (
  stock_code TEXT NOT NULL,
  dataset TEXT NOT NULL CHECK (dataset IN ('price', 'adj_factor', 'daily_basic', 'fundamental', 'fina_indicator', 'northbound', 'index_ohlcv', 'index_weight', 'sw_industry')),
  provider TEXT NOT NULL,                      -- 实际写入该段的源(行级血缘)
  first_date TEXT,
  last_date TEXT,                              -- 增量从此 +1 拉
  rows INTEGER,
  checksum TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (stock_code, dataset)
);

-- 运行日志(统一日志总线索引;全文另落滚动文件)。
CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source TEXT,                                 -- api / engine / scheduler / provider.tushare
  job_id TEXT,
  message TEXT NOT NULL,
  context_json TEXT
);
CREATE INDEX idx_logs_ts ON logs (ts);
CREATE INDEX idx_logs_level ON logs (level);
