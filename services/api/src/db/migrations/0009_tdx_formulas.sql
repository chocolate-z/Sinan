-- 司南迁移:保存的通达信/同花顺公式。用户在「公式」页编辑的公式可命名保存,供日后加载/扫描。
-- 公式合法性由 engine 解析器在保存前校验(白名单 + 无未来函数);engine 不写本表(红线#6)。
CREATE TABLE tdx_formulas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  src TEXT NOT NULL,
  signal TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tdx_formulas_created ON tdx_formulas (created_at);
