-- 司南 M4 v3 迁移:自定义因子。用户用 DSL(白名单字段 + 仅回看算子)定义因子,api 落库,
-- 质检时下发 engine 与内置因子并列计算真实 IC/分层。表达式安全性由 engine 沙箱在创建前校验。
-- 红线#1:DSL 结构上无未来函数(仅回看算子);engine 求值经 asof(PIT)。engine 不写本表(红线#6)。

CREATE TABLE custom_factors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  expr TEXT NOT NULL,
  factor_group TEXT NOT NULL DEFAULT 'custom',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_custom_factors_created ON custom_factors (created_at);
