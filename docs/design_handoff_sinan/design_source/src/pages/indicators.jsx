/* ============================================================
   司南 Sinan — 指标 / 因子库 Indicators
   IC/ICIR = 因子研究指标(中性通道) · 分层收益 = PnL通道
   ============================================================ */
function Indicators() {
  const { inv } = React.useContext(AppCtx);
  const [cat, setCat] = React.useState("全部");
  const [selKey, setSelKey] = React.useState("mom60");

  const cats = ["全部", ...Array.from(new Set(FACTORS.map((f) => f.cat)))];
  const rows = FACTORS.filter((f) => cat === "全部" || f.cat === cat);
  const sel = FACTORS.find((f) => f.key === selKey) || FACTORS[0];
  const onCount = FACTORS.filter((f) => f.on).length;

  // generated research series for the selected factor
  const seed = React.useMemo(() => sel.key.split("").reduce((a, c) => a + c.charCodeAt(0), 7), [selKey]);
  const icSeries = React.useMemo(() => {
    const rng = mulberry32(seed); const out = [];
    for (let i = 0; i < 36; i++) out.push(sel.ic + (rng() - 0.5) * 0.06);
    return out;
  }, [selKey]);
  const deciles = React.useMemo(() => {
    const rng = mulberry32(seed + 3); const dir = sel.ic >= 0 ? 1 : -1; const out = [];
    for (let i = 0; i < 10; i++) out.push(dir * ((i - 4.5) * 0.9 + (rng() - 0.5) * 1.2));
    return out;
  }, [selKey]);

  return (
    <>
      <PageHero title="指标 · 因子库" sub={`多因子模型的原子构建块 · 共 ${FACTORS.length} 个因子 · ${onCount} 个启用 · ICIR 加权合成`}
        right={<Button sm variant="primary" icon={I.plus}>新建因子</Button>} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 过滤器 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="segmented">
            {cats.map((c) => (
              <button key={c} aria-selected={cat === c} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 11, color: "var(--text-3)" }}>
            <span className="ch-tag"><i style={{ background: "var(--text-2)" }} />IC/ICIR=中性</span>
            <span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />分层收益=PnL</span>
            <span className="ch-tag"><i style={{ background: "var(--accent)" }} />启用=Accent</span>
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.45fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
          {/* 因子表 */}
          <Card pad={false}>
            <table className="dt">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>因子</th>
                  <th>类别</th>
                  <th className="num">IC 均值</th>
                  <th className="num">ICIR</th>
                  <th className="num">覆盖度</th>
                  <th className="num">权重</th>
                  <th style={{ width: 56, textAlign: "center" }}>启用</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.key} className={f.key === selKey ? "sel" : ""} onClick={() => setSelKey(f.key)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontWeight: 500, color: "var(--text-1)" }}>{f.name}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{f.key}</span>
                      </div>
                    </td>
                    <td><span className="chip">{f.cat}</span></td>
                    <td className="num" style={{ color: "var(--text-1)" }}>{f.ic >= 0 ? "" : "−"}{Math.abs(f.ic).toFixed(3)}</td>
                    <td className="num" style={{ color: "var(--text-2)" }}>{f.icir.toFixed(2)}</td>
                    <td className="num" style={{ color: "var(--text-2)" }}>{(f.cov * 100).toFixed(0)}%</td>
                    <td className="num">
                      <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
                        <span style={{ color: f.on ? "var(--text-1)" : "var(--text-3)" }}>{(f.weight * 100).toFixed(0)}%</span>
                        <div style={{ width: 34, height: 4, background: "var(--bg-input)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: f.weight / 0.2 * 100 + "%", height: "100%", background: "var(--accent)", opacity: f.on ? 0.85 : 0.3 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <Switch checked={f.on} onChange={() => {}} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* 因子详情 */}
          <Card title={sel.name} sub={sel.key}
            right={<span className="chip">{sel.cat}</span>}>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{sel.desc}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
              <Mini k="IC 均值" v={(sel.ic >= 0 ? "" : "−") + Math.abs(sel.ic).toFixed(3)} />
              <Mini k="ICIR" v={sel.icir.toFixed(2)} />
              <Mini k="覆盖度" v={(sel.cov * 100).toFixed(0) + "%"} />
              <Mini k="半衰期" v={sel.hl + "日"} />
            </div>

            <div className="cap" style={{ marginBottom: 8 }}>IC 时序 · 近36月</div>
            <div style={{ marginBottom: 18 }}>
              <ICChart values={icSeries} />
            </div>

            <div className="cap" style={{ marginBottom: 8 }}>分层回测 · 十分位年化收益</div>
            <DecileBars values={deciles} inv={inv} />
          </Card>
        </div>
      </div>
    </>
  );
}

function Mini({ k, v }) {
  return (
    <div style={{ background: "var(--bg-panel-2)", borderRadius: "var(--r-sm)", padding: "10px 12px" }}>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{k}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{v}</div>
    </div>
  );
}

function ICChart({ values }) {
  const [ref, W] = useMeasure();
  const H = 70, pad = 4;
  const lo = Math.min(...values, -0.02), hi = Math.max(...values, 0.02);
  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const zero = y(0);
  const bw = Math.max(2, (W / values.length) * 0.6);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--border-strong)" />
        {values.map((v, i) => (
          <rect key={i} x={x(i) - bw / 2} y={Math.min(zero, y(v))} width={bw} height={Math.max(1, Math.abs(y(v) - zero))}
            fill={v >= 0 ? "var(--accent)" : "var(--text-3)"} opacity="0.8" rx="1" />
        ))}
      </svg>
    </div>
  );
}

function DecileBars({ values, inv }) {
  const [ref, W] = useMeasure();
  const H = 84, pad = 2;
  const mx = Math.max(...values.map(Math.abs));
  const zero = H / 2;
  const bw = Math.max(6, (W / values.length) * 0.66);
  const x = (i) => (i + 0.5) * (W / values.length);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={H + 16} style={{ display: "block", overflow: "visible" }}>
        <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--border-strong)" />
        {values.map((v, i) => {
          const h = (Math.abs(v) / mx) * (H / 2 - pad);
          const up = (v >= 0) !== inv;
          return (
            <g key={i}>
              <rect x={x(i) - bw / 2} y={v >= 0 ? zero - h : zero} width={bw} height={h}
                fill={v >= 0 ? "var(--pnl-up)" : "var(--pnl-down)"} rx="1.5" />
              <text x={x(i)} y={H + 12} textAnchor="middle" fontSize="9" fill="var(--axis-text)" fontFamily="var(--font-mono)">D{i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

window.Indicators = Indicators;
