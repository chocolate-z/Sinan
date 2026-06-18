-- v2 因子库:内置因子的启用/权重配置。
-- 内置因子的定义(算法)在 engine(factor_meta),本表只存用户对每个内置因子的启用态与权重 ——
-- 打分时把启用的内置因子及权重(builtin 配置)下发 engine。engine 不写本表(红线#6)。
-- 名是 engine 因子名(ep/bp/roe/mom20/north_chg5…),首次列因子时按 engine 注册表补齐缺省行。

CREATE TABLE factor_config (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  weight REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT
);
