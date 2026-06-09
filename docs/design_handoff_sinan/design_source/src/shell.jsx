/* ============================================================
   司南 Sinan — Shell pieces (title bar · sidebar · status bar · nav map)
   Shared by the live app (app.jsx) and the print/export sheet.
   ============================================================ */
const NAV = [
  { group: "监控", items: [{ id: "dashboard", label: "总览", icon: I.dashboard }, { id: "market", label: "行情", icon: I.market }] },
  { group: "研究", items: [{ id: "indicators", label: "指标", icon: I.indicator }, { id: "strategy", label: "模型", icon: I.model }, { id: "backtest", label: "回测", icon: I.backtest }] },
  { group: "交易", items: [{ id: "signals", label: "信号", icon: I.signals }, { id: "portfolio", label: "持仓", icon: I.portfolio }] },
  { group: "系统", items: [{ id: "settings", label: "设置", icon: I.settings }] },
];
const PAGES = { dashboard: Dashboard, market: Market, indicators: Indicators, strategy: Strategy, signals: Signals, portfolio: Portfolio, backtest: Backtest, settings: Settings };

function TitleBar() {
  return (
    <div style={{ height: "var(--titlebar-h)", flex: "none", background: "var(--glass-chrome)",
      WebkitBackdropFilter: "var(--glass-blur)", backdropFilter: "var(--glass-blur)",
      borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center",
      justifyContent: "space-between", paddingLeft: 14, WebkitAppRegion: "drag", userSelect: "none", zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Compass size={15} color="var(--accent)" />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)", letterSpacing: "0.01em" }}>司南</span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sinan</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 2, padding: "1px 5px", border: "0.5px solid var(--border)", borderRadius: 4 }}>v2.4.0</span>
      </div>
      <div style={{ display: "flex", height: "100%", WebkitAppRegion: "no-drag" }}>
        <WinBtn type="min" /><WinBtn type="max" /><WinBtn type="close" />
      </div>
    </div>
  );
}
function WinBtn({ type }) {
  const [h, setH] = React.useState(false);
  const close = type === "close";
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: 44, height: "100%", display: "grid", placeItems: "center", cursor: "default",
        background: h ? (close ? "#e34a3f" : "var(--bg-elevated)") : "transparent", transition: "background 0.1s",
        color: h && close ? "#fff" : "var(--text-2)" }}>
      <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1" fill="none">
        {type === "min" && <line x1="1" y1="5" x2="9" y2="5" />}
        {type === "max" && <rect x="1.5" y="1.5" width="7" height="7" />}
        {type === "close" && <><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" /></>}
      </svg>
    </div>
  );
}

function Sidebar({ page, setPage, theme, toggleTheme, openOnboarding }) {
  return (
    <aside style={{ width: "var(--nav-w)", flex: "none", background: "var(--glass-chrome)",
      WebkitBackdropFilter: "var(--glass-blur)", backdropFilter: "var(--glass-blur)",
      borderRight: "0.5px solid var(--border)", display: "flex", flexDirection: "column", padding: "12px 10px 12px" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="cap" style={{ padding: "0 10px 7px" }}>{g.group}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {g.items.map((it) => (
                <button key={it.id} onClick={() => setPage && setPage(it.id)}
                  className={"nav-item" + (page === it.id ? " active" : "")}>
                  <span className="nav-chip">{it.icon}</span>
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* footer: data source card + theme toggle */}
      <div style={{ paddingTop: 12, marginTop: 4, borderTop: "0.5px solid var(--border)", display: "flex", flexDirection: "column", gap: 9 }}>
        <button onClick={openOnboarding} className="src-card">
          <span style={{ width: 23, height: 23, borderRadius: 6, background: "var(--status-ok-bg)", display: "grid", placeItems: "center", flex: "none", color: "var(--status-ok)" }}>{I.db}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-1)" }}>Tushare Pro</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--status-ok)" }} />已连接 · 缓存就绪
            </div>
          </div>
          <span style={{ color: "var(--text-3)" }}>{I.chevR}</span>
        </button>
        <button onClick={toggleTheme} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 11px", borderRadius: "var(--r-md)", background: "transparent", border: "0.5px solid var(--border)",
          cursor: "pointer", color: "var(--text-2)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 12 }}>
            <span style={{ display: "inline-flex", color: "var(--text-2)" }}>{theme === "dark" ? I.moon : I.sun}</span>
            外观主题
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{theme === "dark" ? "深色" : "浅色"}</span>
        </button>
      </div>
    </aside>
  );
}

function StatusBar() {
  return (
    <div style={{ height: "var(--statusbar-h)", flex: "none", background: "var(--glass-chrome)",
      WebkitBackdropFilter: "var(--glass-blur)", backdropFilter: "var(--glass-blur)",
      borderTop: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 14px", fontSize: 11, color: "var(--text-3)", zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Stat dot="ok" label="行情 API" val="正常" />
        <Stat dot="ok" label="计算引擎" val="空闲" />
        <Stat dot="warn" label="数据更新" val="待今日盘后" />
        <span className="mono" style={{ color: "var(--text-3)" }}>缓存 1.8 GB · 412,803 条</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span>本工具仅供量化研究与策略验证,不构成任何投资建议</span>
        <span className="mono">15:08:42</span>
      </div>
    </div>
  );
}
function Stat({ dot, label, val }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--status-${dot})` }} />
      <span>{label}</span>
      <span style={{ color: "var(--text-2)" }} className="mono">{val}</span>
    </span>
  );
}

Object.assign(window, { NAV, PAGES, TitleBar, WinBtn, Sidebar, StatusBar, Stat });
