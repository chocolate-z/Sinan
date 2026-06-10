-- 司南 M4 扩展:自定义因子合成权重。等权(目前)→ 可调权重(手动;后续可接 ICIR 加权)。
-- weight 仅作用于「合成打分」层(score_universe 加权),不改单因子取数/质检口径(质检仍逐因子算真实 IC)。
-- 权重经 customFactorsForQuality 自动贯穿实盘 run_eod 与回测 run_backtest(口径一致)。既有行默认 1.0=等权。

ALTER TABLE custom_factors ADD COLUMN weight REAL NOT NULL DEFAULT 1.0;
