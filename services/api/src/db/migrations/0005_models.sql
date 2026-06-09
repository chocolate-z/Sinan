-- 司南 M3 迁移:模型版本库。engine 训练(walk-forward + 样本内外 IC,模型=线性系数 JSON),api 落库。
-- 红线#1:purge>=label_horizon 守卫在 engine;落库存 label_horizon/purge/embargo 以便审计复现。
-- 红线#3:样本内外指标成对存(ic_is/ic_oos、icir_is/icir_oos);夏普/年化为分层口径(layered_,非完整回测)。
-- 红线#6:engine 只算不写库,本表由 api 落库;模型产物为纯系数 JSON(无二进制/无外联)。
-- 枚举 model_type / status 由契约 ModelType / ModelStatus 守护(test_sql_contract 校验 CHECK 与契约一致)。

CREATE TABLE model_versions (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  name TEXT,
  model_type TEXT NOT NULL CHECK (model_type IN ('elasticnet')),
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
  oos_clean INTEGER NOT NULL DEFAULT 1,   -- 红线#2:walk-forward 样本外硬守卫(purge>=horizon)
  metrics_note TEXT,                      -- 诚实口径标注(分层口径,非完整回测)随数据走
  feature_cols_json TEXT,                 -- 可用特征列
  feature_importance_json TEXT,           -- [{feature, weight}] |coef| 归一
  fold_metrics_json TEXT,                 -- 每折 {index, n_train, n_test, ic_oos}
  model_json TEXT,                        -- 线性系数(推理:intercept + Σ coef·f)
  degraded_json TEXT,                     -- 因子降级如实标注
  created_at TEXT NOT NULL
);
CREATE INDEX idx_model_versions_created ON model_versions (created_at);
CREATE INDEX idx_model_versions_status ON model_versions (status);
