/* ============================================================
   司南 Sinan — 持仓 Portfolio
   两套独立账本: 模型模拟盘 / 个人持仓 (分段切换)
   ============================================================ */
function Portfolio() {
  const { inv } = React.useContext(AppCtx);
  const [book, setBook] = React.useState("模型");
  const rows = book === "模型" ? HOLDINGS_MODEL : HOLDINGS_PERSONAL;
  const dayMap = Object.fromEntries(QUOTES.map((q) => [q.code, q.chg]));

  const enriched = rows.map((r) => {
    const mktVal = r.shares * r.price;
    const costVal = r.shares * r.cost;
    const pnl = mktVal - costVal;
    const pnlPct = (pnl / costVal) * 100;
    const dayPct = dayMap[r.code] ?? 0;
    const dayPnl = mktVal - mktVal / (1 + dayPct / 100);
    return { ...r, mktVal, costVal, pnl, pnlPct, dayPct, dayPnl };
  });
  const totalMkt = enriched.reduce((a, b) => a + b.mktVal, 0);
  const totalCost = enriched.reduce((a, b) => a + b.costVal, 0);
  const totalDayPnl = enriched.reduce((a, b) => a + b.dayPnl, 0);
  const totalPnl = totalMkt - totalCost;
  const totalPnlPct = (totalPnl / totalCost) * 100;
  const cash = book === "模型" ? 184200 : 96400;
  const totalAsset = totalMkt + cash;

  return (
    <>
      <PageHero title="持仓" sub="持仓与账本 · 收盘价估值"
        right={<Segmented options={[{ value: "模型", label: "模型模拟盘" }, { value: "个人", label: "个人持仓" }]} value={book} onChange={setBook} />} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 账本汇总 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
          <Summary label="总资产" value={"¥" + fmtInt(Math.round(totalAsset))} sub={book === "模型" ? "初始 ¥1,000,000" : "含可用现金"} />
          <Summary label="持仓市值" value={"¥" + fmtInt(Math.round(totalMkt))} sub={`${enriched.length} 只 · 仓位 ${((totalMkt / totalAsset) * 100).toFixed(1)}%`} />
          <Summary label="可用现金" value={"¥" + fmtInt(cash)} sub="T+1 可用" mono />
          <Summary label="今日实时盈亏" live value={(totalDayPnl > 0 ? "+" : "") + "¥" + fmtInt(Math.round(totalDayPnl))}
            valueCls={pnlClass(totalDayPnl, inv)} sub={fmtPct(totalDayPnl / (totalMkt - totalDayPnl) * 100)} subCls={pnlClass(totalDayPnl, inv)} />
          <Summary label="累计浮动盈亏" value={(totalPnl > 0 ? "+" : "") + "¥" + fmtInt(Math.round(totalPnl))}
            valueCls={pnlClass(totalPnl, inv)} sub={fmtPct(totalPnlPct)} subCls={pnlClass(totalPnl, inv)} />
        </div>

        <Card pad={false}
          title={book === "模型" ? "模型模拟盘 · 持仓明细" : "个人持仓 · 明细"}
          sub={book === "模型" ? "由策略自动调仓 · 纸面验证,不下达真实委托" : "手动录入或券商同步"}
          right={<div style={{ display: "flex", gap: 8 }}>
            <span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />浮盈=PnL</span>
            <Button sm variant="ghost" icon={I.refresh}>同步</Button>
          </div>}>
          <table className="dt">
            <thead>
              <tr>
                <th style={{ width: 160 }}>标的</th>
                <th className="num">股数</th>
                <th className="num">成本价</th>
                <th className="num">现价</th>
                <th className="num">市值</th>
                <th className="num">当日盈亏</th>
                <th className="num">浮动盈亏</th>
                <th className="num">盈亏比例</th>
                <th className="num" style={{ width: 110 }}>占比</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => (
                <tr key={r.code}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontWeight: 500, color: "var(--text-1)" }}>{r.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.code}</span>
                    </div>
                  </td>
                  <td className="num">{fmtInt(r.shares)}</td>
                  <td className="num" style={{ color: "var(--text-2)" }}>{fmt(r.cost)}</td>
                  <td className="num" style={{ color: "var(--text-1)" }}>{fmt(r.price)}</td>
                  <td className="num" style={{ color: "var(--text-1)" }}>{fmtInt(Math.round(r.mktVal))}</td>
                  <td className="num">
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-end" }}>
                      <span className={pnlClass(r.dayPnl, inv)}>{(r.dayPnl > 0 ? "+" : "") + fmtInt(Math.round(r.dayPnl))}</span>
                      <span className={pnlClass(r.dayPnl, inv)} style={{ fontSize: 10.5, opacity: 0.8 }}>{fmtPct(r.dayPct)}</span>
                    </div>
                  </td>
                  <td className="num"><span className={pnlClass(r.pnl, inv)}>{(r.pnl > 0 ? "+" : "") + fmtInt(Math.round(r.pnl))}</span></td>
                  <td className="num"><span className={pnlClass(r.pnl, inv)}>{fmtPct(r.pnlPct)}</span></td>
                  <td className="num">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <span style={{ color: "var(--text-2)" }}>{((r.mktVal / totalMkt) * 100).toFixed(1)}%</span>
                      <div style={{ width: 40, height: 4, background: "var(--bg-input)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: (r.mktVal / totalMkt) * 100 + "%", height: "100%", background: "var(--accent)", opacity: 0.7 }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "0.5px solid var(--border-strong)" }}>
                <td style={{ height: 38, color: "var(--text-2)", fontWeight: 500 }}>合计</td>
                <td colSpan={3}></td>
                <td className="num" style={{ color: "var(--text-1)", fontWeight: 600 }}>{fmtInt(Math.round(totalMkt))}</td>
                <td className="num"><span className={"mono " + pnlClass(totalDayPnl, inv)} style={{ fontWeight: 600 }}>{(totalDayPnl > 0 ? "+" : "") + fmtInt(Math.round(totalDayPnl))}</span></td>
                <td className="num"><span className={"mono " + pnlClass(totalPnl, inv)} style={{ fontWeight: 600 }}>{(totalPnl > 0 ? "+" : "") + fmtInt(Math.round(totalPnl))}</span></td>
                <td className="num"><span className={"mono " + pnlClass(totalPnl, inv)} style={{ fontWeight: 600 }}>{fmtPct(totalPnlPct)}</span></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </div>
    </>
  );
}

function Summary({ label, value, valueCls, sub, subCls, mono, live }) {
  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="cap" style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {label}{live && <span className="live-dot" />}
      </span>
      <span className={"mono " + (valueCls || "")} style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", color: valueCls ? undefined : "var(--text-1)" }}>{value}</span>
      <span className={subCls ? "mono " + subCls : ""} style={{ fontSize: 12, color: subCls ? undefined : "var(--text-3)" }}>{sub}</span>
    </div>
  );
}

window.Portfolio = Portfolio;
