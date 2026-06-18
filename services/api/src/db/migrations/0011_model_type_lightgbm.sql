-- 司南 M3 v2 迁移:model_type 放开,允许 lightgbm。
-- SQLite 改不了 CHECK 约束,只能重建表(建新表→拷数据→换名→重建索引)。
-- 列定义与 0005 完全一致,只把 CHECK (model_type IN ('elasticnet')) 放宽成 ('elasticnet','lightgbm')。
-- 枚举与契约 ModelType 由 test_sql_contract 守护。LightGBM 模型仍是纯 JSON(dump 出的树结构),
-- 推理走纯 numpy 遍历,无二进制 pickle / 无运行时 lightgbm 依赖(红线#6 不变)。

CREATE TABLE model_versions_new (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  name TEXT,
  model_type TEXT NOT NULL CHECK (model_type IN ('elasticnet', 'lightgbm')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'archived')),
  train_start TEXT NOT NULL,
  train_end TEXT NOT NULL,
  label_horizon INTEGER NOT NULL,
  purge INTEGER NOT NULL,
  embargo INTEGER NOT NULL,
  n_folds INTEGER,
  n_samples INTEGER,
  ic_is REAL,
  ic_oos REAL,
  icir_is REAL,
  icir_oos REAL,
  layered_sharpe_oos REAL,
  layered_annual_return_oos REAL,
  oos_clean INTEGER NOT NULL DEFAULT 1,
  metrics_note TEXT,
  feature_cols_json TEXT,
  feature_importance_json TEXT,
  fold_metrics_json TEXT,
  model_json TEXT,
  degraded_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO model_versions_new SELECT * FROM model_versions;
DROP TABLE model_versions;
ALTER TABLE model_versions_new RENAME TO model_versions;
CREATE INDEX idx_model_versions_created ON model_versions (created_at);
CREATE INDEX idx_model_versions_status ON model_versions (status);
