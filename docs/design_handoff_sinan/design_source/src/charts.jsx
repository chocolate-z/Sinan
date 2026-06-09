/* ============================================================
   司南 Sinan — Chart primitives (pure SVG, theme-aware)
   ============================================================ */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC, useLayoutEffect } = React;

function useMeasure() {
  const ref = useRefC(null);
  const [w, setW] = useStateC(720);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => { const cw = e[0].contentRect.width; if (cw) setW(cw); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const cssvar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------- Equity curve vs benchmark + drawdown subpanel ----------
function EquityChart({ model, bench, dd, height = 240, markers = [], showBench = true, showDD = true }) {
  const [ref, W] = useMeasure();
  const padL = 48, padR = 16, padT = 14, padB = 22;
  const ddH = showDD ? 56 : 0;
  const mainH = height - ddH - (showDD ? 10 : 0);
  const innerW = Math.max(10, W - padL - padR);
  const n = model.length;

  const all = showBench ? model.concat(bench) : model;
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const x = (i) => padL + (i / (n - 1)) * innerW;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (mainH - padT - padB);

  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = (arr) => path(arr) + ` L${x(n - 1)} ${mainH - padB} L${padL} ${mainH - padB} Z`;

  // y ticks
  const yticks = 4;
  const ticks = Array.from({ length: yticks + 1 }, (_, i) => lo + (i / yticks) * (hi - lo));

  // drawdown scale
  const ddLo = Math.min(...dd, -1);
  const ddy = (v) => (mainH + 10) + (v / ddLo) * (ddH - 16) + 2;
  const ddPath = dd.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${ddy(v).toFixed(1)}`).join(" ");
  const ddArea = `M${padL} ${mainH + 12} ` + dd.map((v, i) => `L${x(i).toFixed(1)} ${ddy(v).toFixed(1)}`).join(" ") + ` L${x(n - 1)} ${mainH + 12} Z`;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={height} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid-line)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--axis-text)" fontFamily="var(--font-mono)">{t.toFixed(2)}</text>
          </g>
        ))}
        {/* model area + line */}
        <path d={area(model)} fill="url(#eqfill)" />
        {showBench && <path d={path(bench)} fill="none" stroke="var(--benchmark)" strokeWidth="1.3" strokeDasharray="3 3" />}
        <path d={path(model)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
        {/* buy/sell markers (Status channel: 买=蓝 卖=橙) */}
        {markers.map((m, i) => (
          <g key={i} transform={`translate(${x(m.i)},${y(model[m.i])})`}>
            <path d={m.t === "buy" ? "M0,-9 L5,0 L-5,0 Z" : "M0,9 L5,0 L-5,0 Z"}
              fill={m.t === "buy" ? "var(--status-ok)" : "var(--status-warn)"}
              stroke="var(--bg-panel)" strokeWidth="1" />
          </g>
        ))}
        {/* drawdown subpanel */}
        {showDD && (
          <g>
            <text x={padL} y={mainH + 8} fontSize="9.5" fill="var(--axis-text)" className="cap" style={{ letterSpacing: "0.05em" }}>回撤 DRAWDOWN</text>
            <path d={ddArea} fill="var(--dd-fill)" />
            <path d={ddPath} fill="none" stroke="var(--status-err)" strokeWidth="1.2" strokeOpacity="0.7" />
            <text x={padL - 8} y={ddy(ddLo) + 3} textAnchor="end" fontSize="9.5" fill="var(--axis-text)" fontFamily="var(--font-mono)">{ddLo.toFixed(1)}%</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------- Candlestick + MA + volume ----------
function Candles({ data, height = 320, ma = [5, 20], adjusted = true }) {
  const [ref, W] = useMeasure();
  const padL = 8, padR = 52, padT = 8, padB = 4;
  const volH = 52, gap = 8;
  const priceH = height - volH - gap - padB;
  const innerW = Math.max(10, W - padL - padR);
  const n = data.length;
  const cw = Math.max(2, (innerW / n) * 0.62);

  const hi = Math.max(...data.map((d) => d.h)), lo = Math.min(...data.map((d) => d.l));
  const pad = (hi - lo) * 0.06;
  const ph = hi + pad, pl = lo - pad;
  const x = (i) => padL + (i + 0.5) * (innerW / n);
  const y = (v) => padT + (1 - (v - pl) / (ph - pl)) * (priceH - padT);

  const upC = cssvar("--pnl-up"), downC = cssvar("--pnl-down");

  // MA lines
  const maColors = { 5: "#e0b34a", 10: "#5aa9e6", 20: "#b07ce0", 60: "#6bbf8a" };
  const maPath = (period) => {
    const pts = data.map((_, i) => {
      if (i < period - 1) return null;
      let s = 0; for (let k = 0; k < period; k++) s += data[i - k].c;
      return s / period;
    });
    return pts.map((v, i) => v == null ? "" : `${pts[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  };

  const vMax = Math.max(...data.map((d) => d.v));
  const vy = (v) => (priceH + gap) + (1 - v / vMax) * volH;

  const yticks = 4;
  const ticks = Array.from({ length: yticks + 1 }, (_, i) => pl + (i / yticks) * (ph - pl));

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={height} style={{ display: "block", overflow: "visible" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid-line)" />
            <text x={W - padR + 6} y={y(t) + 3.5} fontSize="10" fill="var(--axis-text)" fontFamily="var(--font-mono)">{t.toFixed(2)}</text>
          </g>
        ))}
        {ma.map((p) => <path key={p} d={maPath(p)} fill="none" stroke={maColors[p]} strokeWidth="1.1" opacity="0.9" />)}
        {data.map((d, i) => {
          const up = d.c >= d.o; const c = up ? upC : downC;
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(d.l)} stroke={c} strokeWidth="1" />
              <rect x={x(i) - cw / 2} y={Math.min(y(d.o), y(d.c))} width={cw}
                height={Math.max(1, Math.abs(y(d.o) - y(d.c)))} fill={c} />
              <rect x={x(i) - cw / 2} y={vy(d.v)} width={cw} height={(priceH + gap + volH) - vy(d.v)} fill={c} opacity="0.4" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- Monthly returns heatmap ----------
function Heatmap({ years, months, data }) {
  const maxAbs = 5;
  const color = (v) => {
    if (v == null) return { bg: "var(--bg-panel-2)", fg: "var(--text-3)" };
    const inv = document.documentElement.getAttribute("data-pnl") === "gr";
    const pos = v > 0;
    const intensity = Math.min(1, Math.abs(v) / maxAbs);
    const up = "227,93,91", down = "52,178,126";
    const rgb = (pos !== inv) ? up : down;
    return { bg: `rgba(${rgb}, ${0.12 + intensity * 0.55})`, fg: Math.abs(v) > 2.5 ? "#fff" : "var(--text-1)" };
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: `38px repeat(12, 1fr)`, gap: 3 }}>
      <div />
      {months.map((m) => <div key={m} style={{ textAlign: "center", fontSize: 10, color: "var(--text-3)" }} className="mono">{m}月</div>)}
      {years.map((yr, yi) => (
        <React.Fragment key={yr}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 10, color: "var(--text-2)" }} className="mono">{yr}</div>
          {data[yi].map((v, mi) => {
            const c = color(v);
            return (
              <div key={mi} title={v == null ? "" : v + "%"} style={{
                height: 28, borderRadius: 4, display: "grid", placeItems: "center",
                background: c.bg, color: c.fg, fontSize: 10, fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              }}>{v == null ? "" : (v > 0 ? "+" : "") + v.toFixed(1)}</div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------- Sparkline ----------
function Sparkline({ values, width = 92, height = 26, color }) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color || "var(--text-2)"} strokeWidth="1.3" />
    </svg>
  );
}

// ---------- Risk gauge bar (风控闸状态条) ----------
function RiskBar({ used, limit, label, unit = "%" }) {
  const pct = Math.min(100, (used / limit) * 100);
  const state = pct > 85 ? "err" : pct > 65 ? "warn" : "ok";
  const col = `var(--status-${state})`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: "var(--fs-sub)", color: "var(--text-2)" }}>{label}</span>
        <span className="mono" style={{ fontSize: "var(--fs-sub)", color: "var(--text-1)" }}>
          {used}{unit} <span style={{ color: "var(--text-3)" }}>/ {limit}{unit}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--bg-input)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: col, borderRadius: 3, transition: "width 0.4s var(--ease)" }} />
      </div>
    </div>
  );
}

Object.assign(window, { useMeasure, EquityChart, Candles, Heatmap, Sparkline, RiskBar });
