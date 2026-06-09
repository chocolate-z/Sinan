-- 司南 M2 回溯增强:回测逐笔成交(买卖点)落库。
-- nav_curve 的逐日明细(现金/持仓市值/当日盈亏/回撤/持仓快照)已随 nav_curve_json 存储,无需改列。

ALTER TABLE backtests ADD COLUMN trades_json TEXT;
