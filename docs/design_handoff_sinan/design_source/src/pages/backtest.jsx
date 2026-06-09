/* ============================================================
   司南 Sinan — 回测 Backtest (数据最密集)
   ============================================================ */
function Backtest() {
  const { inv } = React.useContext(AppCtx);
  const eq = React.useMemo(() => genEquity(240, 19), []);
  const daily = React.useMemo(() => genDaily(11), []);
  const [expanded, setExpanded] = React.useState(null);
  const markers = [{ i: 22, t: "buy" }, { i: 58, t: "buy" }, { i: 95, t: "sell" }, { i: 130, t: "buy" }, { i: 175, t: "sell" }, { i: 210, t: "buy" }];

  const perf = [
    { k: "年化收益", v: "+24.8%", cls: pnlClass(1, inv), note: "Annualized" },
    { k: "超额收益(vs 沪深300)", v: "+11.3%", cls: pnlClass(1, inv), note: "Alpha" },
    { k: "最大回撤", v: "-14.2%", cls: "pnl-down", note: "Max DD" },
    { k: "夏普比率", v: "1.62", cls: "", note: "Sharpe" },
    { k: "信息比率", v: "1.08", cls: "", note: "IR" },
    { k: "跟踪误差", v: "9.4%", cls: "", note: "TE" },
  ];

  return (
    <>
      <PageHero title="回测" sub="模型 v2.4 · 沪深A股 · 2024-01-02 ~ 2026-06-06"
        right={<Button sm variant="primary" icon={I.refresh}>重新回测</Button>} />

      {/* 诚实口径提示条 */}
      <div style={{ margin: "22px 28px 0", padding: "11px 14px", borderRadius: "var(--r-md)",
        background: "var(--status-ok-bg)", border: "0.5px solid color-mix(in srgb, var(--status-ok) 30%, transparent)",
        display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--status-ok)", display: "inline-flex", flex: "none" }}>{I.shield}</span>
        <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
          <b style={{ color: "var(--text-1)", fontWeight: 600 }}>诚实口径</b> · 已启用样本外验证:训练截止 <span className="mono">2023-12-29</span>,Purge <span className="mono">5</span> 日防止前视;成交按 <span className="mono">次日开盘价</span> 撮合,计入 <span className="mono">万2.5</span> 双边费用与滑点。本回测<b style={{ color: "var(--text-1)", fontWeight: 500 }}>不代表未来收益</b>,仅供策略纪律性验证。
        </span>
      </div>

      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 参数 + 绩效 */}
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 20 }}>
          <Card title="回测参数" pad>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <Param label="训练截止" value="2023-12-29" />
              <Param label="回测区间" value="2024-01-02 ~ 2026-06-06" />
              <Param label="Purge 间隔" value="5 个交易日" />
              <Param label="基准" value="沪深300 (000300.SH)" />
              <Param label="调仓频率" value="每周五收盘" />
              <Param label="持仓数" value="Top 20 等权" />
              <Param label="初始资金" value="¥1,000,000" />
              <div className="hairline" style={{ margin: "2px 0" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <Button sm style={{ flex: 1 }}>编辑参数</Button>
                <Button sm variant="ghost">导出</Button>
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {perf.map((p, i) => (
                <div key={i} className="card card-pad" style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{p.k}</span>
                    <span className="cap" style={{ fontSize: 9 }}>{p.note}</span>
                  </div>
                  <div className={"mono " + (p.cls || "")} style={{ fontSize: 22, fontWeight: 600, color: p.cls ? undefined : "var(--text-1)", letterSpacing: "-0.01em" }}>{p.v}</div>
                </div>
              ))}
            </div>

            <Card title="净值 vs 基准 · 含买卖点" sub="模型净值 / 沪深300 / 回撤阴影"
              right={<div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Legend color="var(--accent)" label="模型" value="1.682" cls="" />
                <Legend color="var(--benchmark)" dashed label="沪深300" value="1.241" cls="" />
                <MarkLegend t="buy" /><MarkLegend t="sell" />
              </div>}>
              <EquityChart model={eq.model} bench={eq.bench} dd={eq.dd} height={244} markers={markers} />
            </Card>
          </div>
        </div>

        {/* 月度热力图 */}
        <Card title="月度收益热力图" sub="单月策略收益率 · 红涨绿跌(A股惯例)"
          right={<span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />PnL 通道</span>}>
          <Heatmap years={MONTHLY.years} months={MONTHLY.months} data={MONTHLY.data} />
        </Card>

        {/* 逐笔成交 + 逐日明细 */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.92fr) minmax(0,1.08fr)", gap: 20, alignItems: "start" }}>
          <Card title="逐笔成交" sub={TRADES.length + " 笔 · 方向 = Status 通道" } pad={false}>
            <table className="dt dt-compact">
              <thead>
                <tr><th>日期</th><th>标的</th><th>方向</th><th className="num">价格</th><th className="num">金额</th></tr>
              </thead>
              <tbody>
                {TRADES.map((t, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{t.date}</td>
                    <td><span style={{ fontSize: 12, color: "var(--text-1)" }}>{t.name}</span></td>
                    <td><DirTag dir={t.dir} /></td>
                    <td className="num">{fmt(t.price)}</td>
                    <td className="num" style={{ color: "var(--text-1)" }}>{fmtInt(t.amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="逐日明细" sub="点击某日展开当日持仓" pad={false}>
            <table className="dt dt-compact">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>日期</th>
                  <th className="num">总资产</th>
                  <th className="num">现金</th>
                  <th className="num">持仓市值</th>
                  <th className="num">当日盈亏</th>
                  <th className="num">回撤</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d, i) => (
                  <React.Fragment key={d.date}>
                    <tr onClick={() => setExpanded(expanded === i ? null : i)} style={{ cursor: "pointer" }} className={expanded === i ? "sel" : ""}>
                      <td style={{ color: "var(--text-3)" }}>
                        <span style={{ display: "inline-flex", transform: expanded === i ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>{I.chevR}</span>
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{d.date}</td>
                      <td className="num" style={{ color: "var(--text-1)" }}>{fmtInt(Math.round(d.total))}</td>
                      <td className="num" style={{ color: "var(--text-2)" }}>{fmtInt(Math.round(d.cash))}</td>
                      <td className="num" style={{ color: "var(--text-2)" }}>{fmtInt(Math.round(d.mktVal))}</td>
                      <td className="num"><span className={pnlClass(d.pnl, inv)}>{(d.pnl > 0 ? "+" : "") + fmtInt(Math.round(d.pnl))}</span></td>
                      <td className="num"><span className="pnl-down">{d.dd.toFixed(1)}%</span></td>
                    </tr>
                    {expanded === i && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: "var(--bg-base)" }}>
                          <div style={{ padding: "10px 16px 14px 46px" }}>
                            <div className="cap" style={{ marginBottom: 8 }}>当日持仓 · {d.date}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px 32px" }}>
                              {HOLDINGS_MODEL.slice(0, 4).map((h) => (
                                <div key={h.code} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "0.5px solid var(--border-faint)" }}>
                                  <span style={{ color: "var(--text-2)" }}>{h.name} <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{h.code}</span></span>
                                  <span className="mono" style={{ color: "var(--text-1)" }}>{fmtInt(h.shares)} 股 · {fmtInt(Math.round(h.shares * h.price))}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}

function Param({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{label}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--text-1)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

window.Backtest = Backtest;
