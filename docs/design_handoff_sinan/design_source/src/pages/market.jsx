/* ============================================================
   司南 Sinan — 行情 Market
   ============================================================ */
function Market() {
  const { inv } = React.useContext(AppCtx);
  const [sel, setSel] = React.useState("600519.SH");
  const [q, setQ] = React.useState("");
  const [adj, setAdj] = React.useState("前复权");
  const [tf, setTf] = React.useState("日K");
  const candles = React.useMemo(() => genCandles(120, 31, 1402), []);
  const cur = QUOTES.find((x) => x.code === sel) || QUOTES[0];
  const rows = QUOTES.filter((x) => !q || x.name.includes(q) || x.code.includes(q.toUpperCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHero title="行情" sub="沪深A股 · 自选与全市场报价"
        right={<span style={{ fontSize: 12, color: "var(--text-3)" }} className="mono">延迟 ~120ms</span>} />
      <div style={{ display: "grid", gridTemplateColumns: "352px minmax(0,1fr)", flex: 1, minHeight: 0, marginTop: 18, borderTop: "0.5px solid var(--border)" }}>
        {/* 左侧报价表 */}
        <div style={{ borderRight: "0.5px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "0.5px solid var(--border)", position: "relative" }}>
            <span style={{ position: "absolute", left: 26, top: 22, color: "var(--text-3)" }}>{I.search}</span>
            <input className="input input-search" placeholder="搜索代码 / 名称 / 拼音" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            <table className="dt dt-compact">
              <thead>
                <tr>
                  <th>代码 / 名称</th>
                  <th className="num">现价</th>
                  <th className="num">涨跌幅</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className={r.code === sel ? "sel" : ""} onClick={() => setSel(r.code)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ color: "var(--text-1)", fontWeight: 500, fontSize: 12.5 }}>{r.name}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.code}</span>
                      </div>
                    </td>
                    <td className="num" style={{ color: "var(--text-1)" }}>{fmt(r.price)}</td>
                    <td className="num"><span className={pnlClass(r.chg, inv)}>{fmtPct(r.chg)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右侧 K线 */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  <span style={{ fontSize: 19, fontWeight: 600, color: "var(--text-1)" }}>{cur.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{cur.code}</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className={"mono " + pnlClass(cur.chg, inv)} style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em" }}>{fmt(cur.price)}</span>
                <span className={"mono " + pnlClass(cur.chg, inv)} style={{ fontSize: 14, fontWeight: 500 }}>
                  {cur.chg > 0 ? "+" : ""}{fmt(cur.price * cur.chg / 100)}　{fmtPct(cur.chg)}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Segmented options={["分时", "日K", "周K", "月K"]} value={tf} onChange={setTf} />
              <Segmented options={["前复权", "后复权", "不复权"]} value={adj} onChange={setAdj} />
            </div>
          </div>

          {/* key metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0, borderBottom: "0.5px solid var(--border)" }}>
            {[["今开", fmt(cur.price * 0.992)], ["最高", fmt(cur.price * 1.015), "pnl-up"], ["最低", fmt(cur.price * 0.985), "pnl-down"],
              ["成交量", cur.vol + "手"], ["成交额", cur.amt], ["市盈率(TTM)", cur.pe]].map((m, i) => (
              <div key={i} style={{ padding: "12px 18px", borderRight: i < 5 ? "0.5px solid var(--border-faint)" : "none" }}>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>{m[0]}</div>
                <div className={"mono " + (m[2] || "")} style={{ fontSize: 13, color: m[2] ? undefined : "var(--text-1)", fontWeight: 500 }}>{m[1]}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "12px 24px 4px", display: "flex", gap: 18, alignItems: "center" }}>
            <MA c="#e0b34a" t="MA5" v={fmt(cur.price * 0.996)} />
            <MA c="#5aa9e6" t="MA10" v={fmt(cur.price * 0.985)} />
            <MA c="#b07ce0" t="MA20" v={fmt(cur.price * 0.972)} />
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }} className="cap">{adj} · {tf}</span>
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            <Candles data={candles} height={360} ma={[5, 10, 20]} />
          </div>
        </div>
      </div>
    </div>
  );
}
function MA({ c, t, v }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
      <span style={{ width: 12, height: 2, background: c, borderRadius: 1 }} />
      <span style={{ color: "var(--text-2)" }}>{t}</span>
      <span className="mono" style={{ color: "var(--text-1)" }}>{v}</span>
    </span>
  );
}
window.Market = Market;
