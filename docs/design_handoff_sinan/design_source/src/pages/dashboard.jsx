/* ============================================================
   司南 Sinan — 总览 Dashboard
   ============================================================ */
function StatCard({ label, channel, value, valueColor, delta, deltaPct, spark, sparkVals, metrics }) {
  const { inv } = React.useContext(AppCtx);
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="cap">{label}</span>
        <span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />PnL</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className={"mono " + (valueColor || "")} style={{ fontSize: "var(--fs-mono-lg)", fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em" }}>{value}</div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span className={"mono " + pnlClass(delta, inv)} style={{ fontSize: 13, fontWeight: 500 }}>
              {delta > 0 ? "▲" : "▼"} {deltaPct}
            </span>
          </div>
        </div>
        {sparkVals && <Sparkline values={sparkVals} width={104} height={40} color={delta > 0 ? "var(--pnl-up)" : "var(--pnl-down)"} />}
      </div>
      <div className="hairline" />
      <div style={{ display: "flex", gap: 24 }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3, whiteSpace: "nowrap" }}>{m.k}</div>
            <div className={"mono " + (m.c || "")} style={{ fontSize: 13, color: m.c ? undefined : "var(--text-1)", fontWeight: 500 }}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const { inv } = React.useContext(AppCtx);
  const eq = React.useMemo(() => genEquity(170, 7), []);
  const [period, setPeriod] = React.useState("近6月");
  const markers = [{ i: 28, t: "buy" }, { i: 62, t: "sell" }, { i: 96, t: "buy" }, { i: 134, t: "sell" }];
  const maxDD = Math.min(...eq.dd);
  const lastDD = eq.dd[eq.dd.length - 1];
  const totalRet = (eq.model[eq.model.length - 1] - 1) * 100;
  const benchRet = (eq.bench[eq.bench.length - 1] - 1) * 100;

  return (
    <>
      <PageHero title="总览" sub="2026年6月9日 周二 · 收盘后 · 数据更新于 15:08:42"
        right={<Button sm icon={I.refresh}>刷新</Button>} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* PnL 双卡 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <StatCard label="个人账户 · 当日收益" value="+¥12,840" valueColor={pnlClass(1, inv)}
            delta={1} deltaPct="+0.86%" sparkVals={eq.model.slice(-40).map((v, i) => v + Math.sin(i) * 0.002)}
            metrics={[{ k: "持仓市值", v: "¥1,498,200" }, { k: "仓位", v: "78.4%" }, { k: "本月", v: "+2.31%", c: pnlClass(1, inv) }]} />
          <StatCard label="模型模拟盘 · 当日收益" value="+¥21,360" valueColor={pnlClass(1, inv)}
            delta={1} deltaPct="+1.24%" sparkVals={eq.model.slice(-40)}
            metrics={[{ k: "策略净值", v: "1.2840" }, { k: "本月", v: "+3.72%", c: pnlClass(1, inv) }, { k: "最大回撤", v: maxDD.toFixed(1) + "%", c: "pnl-down" }]} />
        </div>

        {/* 净值曲线 + 风控/信号 */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.1fr) minmax(0, 1fr)", gap: 20 }}>
          <Card title="模型净值 vs 沪深300" sub="累计净值 · 前复权 · 含回撤"
            right={<Segmented options={["近1月", "近6月", "今年", "全部"]} value={period} onChange={setPeriod} />}>
            <div style={{ display: "flex", gap: 22, marginBottom: 14 }}>
              <Legend color="var(--accent)" label="模型净值" value={fmtPct(totalRet)} cls={pnlClass(totalRet, inv)} />
              <Legend color="var(--benchmark)" dashed label="沪深300" value={fmtPct(benchRet)} cls={pnlClass(benchRet, inv)} />
              <Legend color="var(--status-err)" label="最大回撤" value={maxDD.toFixed(1) + "%"} cls="" />
              <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
                <MarkLegend t="buy" /><MarkLegend t="sell" />
              </div>
            </div>
            <EquityChart model={eq.model} bench={eq.bench} dd={eq.dd} height={252} markers={markers} />
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card title="风控闸" sub="实时校验"
              right={<Badge kind="ok">全部通过</Badge>} pad>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <RiskBar label="单票集中度" used={9.2} limit={15} />
                <RiskBar label="行业暴露 · 有色金属" used={22} limit={30} />
                <RiskBar label="组合波动率(年化)" used={18.6} limit={25} />
                <RiskBar label="当日回撤" used={1.2} limit={4} />
                <div className="hairline" />
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <GateRow ok label="ST / 退市风险过滤" />
                  <GateRow ok label="流动性闸 · 日均成交 ≥ 5000万" />
                  <GateRow warn label="换手率监测 · 接近阈值" />
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* 空状态引导 */}
        <Card title="今日新增信号" sub="收盘后由因子模型生成"
          right={<Button sm variant="ghost" icon={I.chevR}>查看全部</Button>}>
          <Empty icon={I.signals} title="今日尚未生成信号"
            desc="模型将在每日收盘数据落库后自动运行。你也可以手动触发一次因子计算与选股。"
            action={<div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <Button variant="primary" sm icon={I.refresh}>立即运行选股</Button>
              <Button sm>查看上次结果</Button>
            </div>} />
        </Card>
      </div>
    </>
  );
}

function Legend({ color, label, value, cls, dashed }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 16, height: 0, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <span className={"mono " + (cls || "")} style={{ fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
function MarkLegend({ t }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}>
      <span style={{ color: t === "buy" ? "var(--status-ok)" : "var(--status-warn)", fontSize: 10 }}>{t === "buy" ? "▲" : "▼"}</span>
      {t === "buy" ? "买入" : "卖出"}
    </span>
  );
}
function GateRow({ ok, warn, label }) {
  const k = ok ? "ok" : warn ? "warn" : "err";
  const col = `var(--status-${k})`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ color: col, display: "inline-flex" }}>{ok ? I.check : I.alert}</span>
      <span style={{ color: "var(--text-2)" }}>{label}</span>
    </div>
  );
}

window.Dashboard = Dashboard;
