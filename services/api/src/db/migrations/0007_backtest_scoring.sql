-- 司南 扩展:回测打分口径出处。回测可用激活/指定模型(model_id)或启用的自定义因子,口径与实盘一致。
-- scoring 为解析后的实际口径(model/custom/equal_weight;CHECK 含 auto 仅为契约对齐,落库永不为 auto)。
-- model_id 记录本次回测所用模型版本(便于「先回测再激活」溯源);等权/自定义时为 NULL。
-- 红线#2:以模型回测时,api 把 train_end 抬到不早于该模型训练截止,使回测绝不踩进训练窗口。

ALTER TABLE backtests ADD COLUMN scoring TEXT
  CHECK (scoring IN ('auto', 'equal_weight', 'model', 'custom'));
ALTER TABLE backtests ADD COLUMN model_id TEXT;
