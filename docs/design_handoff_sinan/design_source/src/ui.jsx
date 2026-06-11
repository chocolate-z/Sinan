/* ============================================================
   司南 Sinan — UI primitives + format helpers
   ============================================================ */
const { useState, useEffect, useRef, useContext, createContext } = React;

// ---- App context: theme + pnl invert ----
const AppCtx = createContext({ theme: "dark", inv: false });

// ---------- Formatters ----------
function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtInt(n) { return n == null ? "—" : Number(n).toLocaleString("en-US"); }
function fmtPct(n, dec = 2, sign = true) {
  if (n == null || isNaN(n)) return "—";
  const s = sign && n > 0 ? "+" : "";
  return s + Number(n).toFixed(dec) + "%";
}
function fmtSigned(n, dec = 2) {
  if (n == null || isNaN(n)) return "—";
  const s = n > 0 ? "+" : "";
  return s + fmt(n, dec);
}
// PnL color resolver — respects red-up/green-down invert toggle
function pnlClass(v, inv) {
  if (v > 0) return inv ? "pnl-down" : "pnl-up";
  if (v < 0) return inv ? "pnl-up" : "pnl-down";
  return "";
}
function PnlColor({ v, children, style }) {
  const { inv } = useContext(AppCtx);
  return <span className={"mono " + pnlClass(v, inv)} style={style}>{children}</span>;
}

// ---------- Card ----------
function Card({ title, sub, right, children, pad, style, className = "" }) {
  return (
    <div className={"card " + className} style={style}>
      {(title || right) && (
        <div className="card-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          {right}
        </div>
      )}
      <div className={pad === false ? "" : "card-pad"}>{children}</div>
    </div>
  );
}

// ---------- Button ----------
function Button({ variant = "secondary", sm, icon, children, className = "", ...rest }) {
  return (
    <button className={`btn btn-${variant} ${sm ? "btn-sm" : ""} ${className}`} {...rest}>
      {icon}{children}
    </button>
  );
}

// ---------- Badge ----------
function Badge({ kind = "ok", children }) {
  return <span className={`badge badge-${kind}`}><span className="dot" />{children}</span>;
}

// ---------- Chip (factor) ----------
function Chip({ label, value }) {
  const { inv } = useContext(AppCtx);
  const cls = value != null ? pnlClass(value, inv) : "";
  return (
    <span className="chip">
      {label}
      {value != null && <span className={"chip-val " + cls}>{fmtSigned(value, 2)}</span>}
    </span>
  );
}

// ---------- Segmented ----------
function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const lab = typeof o === "string" ? o : o.label;
        return (
          <button key={val} role="tab" aria-selected={value === val} onClick={() => onChange(val)}>
            {lab}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Switch ----------
function Switch({ checked, onChange }) {
  return <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

// ---------- Icons (inline stroke, 16px) ----------
const Icon = ({ d, size = 16, fill, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>{d}</svg>
);
const I = {
  dashboard: <Icon d={<><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>} />,
  market: <Icon d={<><path d="M3 17l5-5 4 3 8-9"/><path d="M21 6v5h-5"/></>} />,
  signals: <Icon d={<><path d="M3 12h4l3 8 4-16 3 8h4"/></>} />,
  portfolio: <Icon d={<><path d="M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>} />,
  backtest: <Icon d={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>} />,
  logs: <Icon d={<><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></>} />,
  settings: <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M19.07 4.93l-2.12 2.12M7.05 16.95l-2.12 2.12M19.07 19.07l-2.12-2.12M7.05 7.05L4.93 4.93"/></>} />,
  search: <Icon d={<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>} size={15} />,
  sun: <Icon d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></>} size={15} />,
  moon: <Icon d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>} size={15} />,
  chevR: <Icon d={<path d="M9 6l6 6-6 6"/>} size={14} />,
  chevD: <Icon d={<path d="M6 9l6 6 6-6"/>} size={14} />,
  shield: <Icon d={<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>} size={15} />,
  check: <Icon d={<path d="M4 12l5 5L20 6"/>} size={14} />,
  alert: <Icon d={<><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></>} size={15} />,
  arrowUp: <Icon d={<path d="M12 19V5M6 11l6-6 6 6"/>} size={12} />,
  arrowDown: <Icon d={<path d="M12 5v14M6 13l6 6 6-6"/>} size={12} />,
  refresh: <Icon d={<><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v5h-5"/></>} size={14} />,
  db: <Icon d={<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>} size={15} />,
  plus: <Icon d={<path d="M12 5v14M5 12h14"/>} size={14} />,
  indicator: <Icon d={<><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.3"/><circle cx="16" cy="12" r="2.3"/><circle cx="7" cy="17" r="2.3"/></>} />,
  model: <Icon d={<><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11L15.6 7M8.2 13L15.6 17"/></>} />,
  close: <Icon d={<path d="M6 6l12 12M18 6L6 18"/>} size={16} />,
  back: <Icon d={<path d="M15 6l-6 6 6 6"/>} size={16} />,
};

// ---------- Empty state ----------
function Empty({ icon, title, desc, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || I.dashboard}</div>
      <div style={{ fontSize: "var(--fs-h3)", fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
      {desc && <div style={{ fontSize: "var(--fs-sub)", color: "var(--text-2)", maxWidth: 320, lineHeight: 1.5 }}>{desc}</div>}
      {action}
    </div>
  );
}

// ---------- Page title (Apple large-title, flows in content — no chrome bar) ----------
function PageHero({ title, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      gap: 16, padding: "34px 28px 0" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "var(--fs-display)", fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-1)" }}>{title}</h1>
        {sub && <p style={{ margin: "8px 0 0", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{sub}</p>}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 3 }}>{right}</div>}
    </div>
  );
}

Object.assign(window, {
  AppCtx, fmt, fmtInt, fmtPct, fmtSigned, pnlClass, PnlColor,
  Card, Button, Badge, Chip, Segmented, Switch, Icon, I, Empty, PageHero,
});
