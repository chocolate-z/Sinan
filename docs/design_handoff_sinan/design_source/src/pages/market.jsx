/* ============================================================
   司南 Sinan — 行情 Market (板块视角)
   左: 行业板块卡片网格(涨跌幅 + 主力资金净流入/流出)
   右: 今日行业板块涨跌幅排行榜
   ============================================================ */
function Market() {
  const { inv } = React.useContext(AppCtx);
  const [sort, setSort] = React.useState("涨跌幅");
  const [openSector, setOpenSector] = React.useState(null);
  const [selStock, setSelStock] = React.useState(null);

  const openDrill = (s) => { setSelStock(null); setOpenSector(s); };
  const closeDrill = () => { setOpenSector(null); setSelStock(null); };

  // 排序后的板块(卡片网格随之联动)
  const sorted = React.useMemo(() => {
    const arr = [...SECTORS];
    if (sort === "涨跌幅") arr.sort((a, b) => b.chg - a.chg);
    else if (sort === "资金流入") arr.sort((a, b) => b.flow - a.flow);
    else arr.sort((a, b) => b.turnover - a.turnover);
    return arr;
  }, [sort]);

  const upN = SECTORS.filter((s) => s.chg > 0).length;
  const downN = SECTORS.filter((s) => s.chg < 0).length;
  const netFlow = SECTORS.reduce((a, b) => a + b.flow, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <PageHero title="行情" sub="沪深A股 · 行业板块概览 · 收盘后数据"
        right={<>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>15:08 收盘</span>
          <Button sm icon={I.refresh}>刷新</Button>
        </>} />

      {/* 大盘指数条 */}
      <div style={{ display: "flex", gap: 0, margin: "18px 28px 0", borderRadius: "var(--r-lg)",
        overflow: "hidden", border: "0.5px solid var(--border)", background: "var(--glass-card)",
        WebkitBackdropFilter: "var(--glass-blur)", backdropFilter: "var(--glass-blur)", boxShadow: "var(--hi-edge), var(--shadow-card)" }}>
        {INDICES.map((ix, i) => (
          <div key={ix.code} style={{ flex: 1, padding: "13px 18px", borderRight: i < INDICES.length - 1 ? "0.5px solid var(--border-faint)" : "none",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{ix.name}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{ix.code}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={"mono " + pnlClass(ix.chg, inv)} style={{ fontSize: 16, fontWeight: 600 }}>{fmt(ix.price)}</div>
              <div className={"mono " + pnlClass(ix.chg, inv)} style={{ fontSize: 11.5, marginTop: 2 }}>{fmtPct(ix.chg)}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 388px", gap: 20, padding: 28, flex: 1, minHeight: 0, overflow: "auto" }}>
        {/* 左: 板块卡片网格 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="sec-label" style={{ padding: 0, whiteSpace: "nowrap" }}>行业板块</span>
              <span style={{ display: "inline-flex", gap: 10, fontSize: 11.5, whiteSpace: "nowrap" }}>
                <span className={pnlClass(1, inv)}>{upN} 涨</span>
                <span className={pnlClass(-1, inv)}>{downN} 跌</span>
              </span>
            </div>
            <Segmented options={["涨跌幅", "资金流入", "成交额"]} value={sort} onChange={setSort} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))", gap: 14 }}>
            {sorted.map((s) => <SectorCard key={s.name} s={s} inv={inv} onClick={() => openDrill(s)} />)}
          </div>
        </div>

        {/* 右: 涨跌幅排行榜 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card title="板块涨跌幅排行" sub="今日 · 申万一级行业"
            right={<span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />PnL</span>} pad={false}>
            <div style={{ padding: "6px 8px" }}>
              {[...SECTORS].sort((a, b) => b.chg - a.chg).map((s, i) => <RankRow key={s.name} s={s} rank={i + 1} inv={inv} onClick={() => openDrill(s)} />)}
            </div>
          </Card>

          <Card title="主力资金净流向" sub="单位 亿元 · 正流入 / 负流出">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...SECTORS].sort((a, b) => b.flow - a.flow).slice(0, 6).map((s) => <FlowRow key={s.name} s={s} inv={inv} />)}
              <div className="hairline" style={{ margin: "2px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>板块合计净流入</span>
                <span className={"mono " + pnlClass(netFlow, inv)} style={{ fontSize: 14, fontWeight: 600 }}>{fmtSigned(netFlow, 1)} 亿</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {openSector && (
        <SectorDrawer sector={openSector} selStock={selStock} setSelStock={setSelStock} onClose={closeDrill} inv={inv} />
      )}
    </div>
  );
}

// ---- 板块卡片 ----
function SectorCard({ s, inv, onClick }) {
  const cls = pnlClass(s.chg, inv);
  const flowCls = pnlClass(s.flow, inv);
  const lineColor = s.chg >= 0
    ? (inv ? "var(--pnl-down)" : "var(--pnl-up)")
    : (inv ? "var(--pnl-up)" : "var(--pnl-down)");
  return (
    <div className="card" onClick={onClick} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13, cursor: "pointer", transition: "border-color var(--t-fast)" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{s.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>领涨 {s.lead}</div>
        </div>
        <div className={"mono " + cls} style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", flex: "none" }}>{fmtPct(s.chg)}</div>
      </div>

      <Sparkline values={s.spark} width={206} height={30} color={lineColor} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 11, borderTop: "0.5px solid var(--border-faint)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>主力净{s.flow >= 0 ? "流入" : "流出"}</span>
          <span className={"mono " + flowCls} style={{ fontSize: 13, fontWeight: 600 }}>{fmtSigned(s.flow, 1)} 亿</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>涨 / 跌 家数</span>
          <span className="mono" style={{ fontSize: 12 }}>
            <span className={pnlClass(1, inv)}>{s.up}</span>
            <span style={{ color: "var(--text-3)" }}> / </span>
            <span className={pnlClass(-1, inv)}>{s.down}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- 排行榜行 ----
function RankRow({ s, rank, inv, onClick }) {
  const cls = pnlClass(s.chg, inv);
  const top3 = rank <= 3;
  const barColor = s.chg >= 0
    ? (inv ? "var(--pnl-down)" : "var(--pnl-up)")
    : (inv ? "var(--pnl-up)" : "var(--pnl-down)");
  const maxAbs = 4.2;
  const w = Math.min(100, Math.abs(s.chg) / maxAbs * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", borderRadius: "var(--r-sm)", cursor: "pointer" }}
      onClick={onClick}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-elevated)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <span className="mono" style={{ width: 18, textAlign: "center", fontSize: 12, fontWeight: 700,
        color: top3 ? "var(--accent)" : "var(--text-3)" }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 500 }}>{s.name}</span>
          <span className={"mono " + cls} style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtPct(s.chg)}</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-input)", overflow: "hidden" }}>
          <div style={{ width: w + "%", height: "100%", background: barColor, borderRadius: 2, opacity: 0.85 }} />
        </div>
      </div>
    </div>
  );
}

// ---- 资金流向行 ----
function FlowRow({ s, inv }) {
  const cls = pnlClass(s.flow, inv);
  const maxAbs = 38.6;
  const w = Math.min(100, Math.abs(s.flow) / maxAbs * 100);
  const barColor = s.flow >= 0
    ? (inv ? "var(--pnl-down)" : "var(--pnl-up)")
    : (inv ? "var(--pnl-up)" : "var(--pnl-down)");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <span style={{ width: 60, fontSize: 12, color: "var(--text-2)", flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-input)", overflow: "hidden" }}>
        <div style={{ width: w + "%", height: "100%", background: barColor, borderRadius: 3, opacity: 0.85 }} />
      </div>
      <span className={"mono " + cls} style={{ width: 58, textAlign: "right", fontSize: 12, fontWeight: 500, flex: "none" }}>{fmtSigned(s.flow, 1)}</span>
    </div>
  );
}

window.Market = Market;

// ============================================================
// 下钻抽屉: 板块 → 成分股列表 → 个股当日分时
// ============================================================
function SectorDrawer({ sector, selStock, setSelStock, onClose, inv }) {
  const stocks = React.useMemo(() => enrichStocks(sector.name, sector.chg), [sector.name]);

  // Esc 关闭
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") { selStock ? setSelStock(null) : onClose(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selStock]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer">
        {/* 头部 */}
        <div className="drawer-head">
          {selStock ? (
            <button className="drawer-iconbtn" onClick={() => setSelStock(null)} title="返回成分股">{I.back}</button>
          ) : (
            <span style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", display: "grid", placeItems: "center",
              background: "var(--accent-bg)", color: "var(--accent)", flex: "none" }}>{I.market}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {selStock ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{selStock.name}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{selStock.code}</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{sector.name}</span>
                <span className={"mono " + pnlClass(sector.chg, inv)} style={{ fontSize: 13, fontWeight: 600 }}>{fmtPct(sector.chg)}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{stocks.length} 只成分股</span>
              </div>
            )}
          </div>
          <button className="drawer-iconbtn" onClick={onClose} title="关闭">{I.close}</button>
        </div>

        {/* 内容 */}
        <div className="drawer-body">
          {selStock ? <StockDetail stock={selStock} inv={inv} /> : <Constituents stocks={stocks} inv={inv} onPick={setSelStock} />}
        </div>
      </div>
    </>
  );
}

// ---- 成分股列表 ----
function Constituents({ stocks, inv, onPick }) {
  const totalFlow = stocks.reduce((a, b) => a + b.flow, 0);
  return (
    <div>
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--border)", display: "flex", gap: 22 }}>
        <MiniStat k="主力净流入" v={fmtSigned(totalFlow, 1) + " 亿"} cls={pnlClass(totalFlow, inv)} />
        <MiniStat k="上涨" v={stocks.filter((s) => s.chg > 0).length + " 只"} cls={pnlClass(1, inv)} />
        <MiniStat k="下跌" v={stocks.filter((s) => s.chg < 0).length + " 只"} cls={pnlClass(-1, inv)} />
      </div>
      <table className="dt dt-compact">
        <thead>
          <tr>
            <th>名称 / 代码</th>
            <th className="num">现价</th>
            <th className="num">涨跌幅</th>
            <th className="num">主力净流入</th>
            <th className="num">换手</th>
            <th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s.code} onClick={() => onPick(s)} style={{ cursor: "pointer" }}>
              <td>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ color: "var(--text-1)", fontWeight: 500, fontSize: 12.5 }}>{s.name}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{s.code}</span>
                </div>
              </td>
              <td className="num" style={{ color: "var(--text-1)" }}>{fmt(s.price)}</td>
              <td className="num"><span className={pnlClass(s.chg, inv)}>{fmtPct(s.chg)}</span></td>
              <td className="num"><span className={pnlClass(s.flow, inv)}>{fmtSigned(s.flow, 1)}</span></td>
              <td className="num" style={{ color: "var(--text-2)" }}>{s.turn}%</td>
              <td style={{ color: "var(--text-3)", textAlign: "center" }}>{I.chevR}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "12px 16px", fontSize: 11, color: "var(--text-3)" }}>点击任意成分股查看当日分时走势</div>
    </div>
  );
}

// ---- 个股当日分时 ----
function StockDetail({ stock, inv }) {
  const data = React.useMemo(() => genIntraday(stock.code, stock.prevClose, stock.chg), [stock.code]);
  const chgAmt = stock.price - stock.prevClose;
  const cls = pnlClass(stock.chg, inv);
  const hi = Math.max(...data.price), lo = Math.min(...data.price);
  return (
    <div style={{ padding: "18px 18px 24px" }}>
      {/* 价格头 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className={"mono " + cls} style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1 }}>{fmt(stock.price)}</div>
          <div className={"mono " + cls} style={{ fontSize: 13, fontWeight: 500, marginTop: 7 }}>
            {chgAmt > 0 ? "+" : ""}{fmt(chgAmt)}　{fmtPct(stock.chg)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}>
            <span style={{ width: 12, height: 2, background: stock.chg >= 0 ? (inv ? "var(--pnl-down)" : "var(--pnl-up)") : (inv ? "var(--pnl-up)" : "var(--pnl-down)") }} />价格
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}>
            <span style={{ width: 12, height: 2, background: "#e0b34a" }} />均价
          </span>
        </div>
      </div>

      {/* 分时图 */}
      <Intraday data={data} chg={stock.chg} inv={inv} height={300} />

      {/* 关键指标 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 20 }}>
        {[["昨收", fmt(stock.prevClose)], ["最高", fmt(hi), inv ? "pnl-down" : "pnl-up"], ["最低", fmt(lo), inv ? "pnl-up" : "pnl-down"], ["换手率", stock.turn + "%"],
          ["成交额", stock.amt + "亿"], ["主力净流入", fmtSigned(stock.flow, 1) + "亿", pnlClass(stock.flow, inv)], ["市盈率", stock.pe], ["振幅", ((hi - lo) / stock.prevClose * 100).toFixed(2) + "%"]].map((m, i) => (
          <div key={i} style={{ background: "var(--bg-panel-2)", borderRadius: "var(--r-sm)", padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{m[0]}</div>
            <div className={"mono " + (m[2] || "")} style={{ fontSize: 13, fontWeight: 600, color: m[2] ? undefined : "var(--text-1)" }}>{m[1]}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
        <Button variant="primary" sm style={{ flex: 1 }}>加入自选</Button>
        <Button sm style={{ flex: 1 }}>查看日K线</Button>
      </div>
    </div>
  );
}

function MiniStat({ k, v, cls }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 3 }}>{k}</div>
      <div className={"mono " + (cls || "")} style={{ fontSize: 13, fontWeight: 600, color: cls ? undefined : "var(--text-1)" }}>{v}</div>
    </div>
  );
}
