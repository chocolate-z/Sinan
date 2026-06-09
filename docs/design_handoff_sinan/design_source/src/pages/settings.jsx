/* ============================================================
   司南 Sinan — 设置 Settings (Apple grouped-list, fills width)
   ============================================================ */
function GRow({ label, desc, children }) {
  return (
    <div className="grow">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>{label}</div>
        {desc && <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function Settings() {
  const ctx = React.useContext(AppCtx);
  const [provider, setProvider] = React.useState("tushare");
  const [token, setToken] = React.useState("a1b2••••••••••••••••••••3f9e");
  const [probe, setProbe] = React.useState("ok");
  const [autoRefresh, setAutoRefresh] = React.useState("每分钟");
  const [lastRefresh, setLastRefresh] = React.useState("2026-06-09 15:08:42");
  const doRefresh = () => {
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    setLastRefresh(`2026-06-09 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
  };

  const providers = [
    { id: "tushare", name: "Tushare Pro", desc: "社区数据接口 · 需 token", status: "ok" },
    { id: "akshare", name: "AkShare", desc: "开源免费 · 公开行情", status: "idle" },
    { id: "wind", name: "Wind 万得", desc: "本地 W.Edb 客户端", status: "idle" },
    { id: "local", name: "本地 CSV / Parquet", desc: "离线数据目录", status: "idle" },
  ];

  return (
    <>
      <PageHero title="设置" sub="数据源、外观与风控配置 · 所有数据均存储于本机" />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 26 }}>

        {/* 数据源 */}
        <section>
          <div className="sec-label">数据源</div>
          <div className="glist" style={{ padding: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
              {providers.map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)} style={{
                  textAlign: "left", cursor: "pointer", padding: 14, borderRadius: "var(--r-md)",
                  background: provider === p.id ? "var(--accent-bg)" : "var(--bg-panel-2)",
                  border: "0.5px solid " + (provider === p.id ? "var(--accent)" : "var(--border)"),
                  display: "flex", flexDirection: "column", gap: 10, transition: "all 0.12s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: provider === p.id ? "var(--accent)" : "var(--text-3)" }}>{I.db}</span>
                    {p.status === "ok" && <Badge kind="ok">已连接</Badge>}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 3 }}>{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <label className="field-label">API Token</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} />
              <Button onClick={() => { setProbe("testing"); setTimeout(() => setProbe("ok"), 900); }}>测试连通</Button>
            </div>

            <div style={{ background: "var(--bg-panel-2)", borderRadius: "var(--r-md)", border: "0.5px solid var(--border)", padding: 16 }}>
              <div className="cap" style={{ marginBottom: 12 }}>能力探测</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "11px 32px" }}>
                {[["日线行情", "ok"], ["分钟线", "ok"], ["财务数据", "ok"], ["复权因子", "ok"], ["板块成分", "warn"], ["龙虎榜", "idle"]].map(([k, s]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "var(--text-2)" }}>{k}</span>
                    {s === "ok" && <span style={{ color: "var(--status-ok)", display: "inline-flex", alignItems: "center", gap: 5 }}>{I.check}<span style={{ fontSize: 11 }}>可用</span></span>}
                    {s === "warn" && <span style={{ color: "var(--status-warn)", fontSize: 11 }}>受限 (积分不足)</span>}
                    {s === "idle" && <span style={{ color: "var(--text-3)", fontSize: 11 }}>未授权</span>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>本地缓存 · 412,803 条记录 · 占用 1.8 GB</span>
                <Button sm variant="ghost" icon={I.refresh}>重建缓存</Button>
              </div>
            </div>
          </div>
        </section>

        {/* 数据更新 */}
        <section>
          <div className="sec-label">数据更新</div>
          <div className="glist">
            <GRow label="上次刷新" desc="最近一次行情与因子数据落库时间">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span className="live-dot" />
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)" }}>{lastRefresh}</span>
                </span>
                <Button sm icon={I.refresh} onClick={doRefresh}>立即刷新</Button>
              </div>
            </GRow>
            <GRow label="自动刷新频率" desc="盘中行情自动拉取间隔">
              <Segmented options={["实时", "每分钟", "每5分钟", "手动"]} value={autoRefresh} onChange={setAutoRefresh} />
            </GRow>
            <GRow label="盘后数据落库" desc="每个交易日收盘后自动下载日线与基本面">
              <Badge kind="ok">15:30 自动</Badge>
            </GRow>
          </div>
        </section>

        {/* 外观 */}
        <section>
          <div className="sec-label">外观</div>
          <div className="glist">
            <GRow label="主题" desc="深色为默认 · 可跟随系统自动切换">
              <Segmented options={[{ value: "dark", label: "深色" }, { value: "light", label: "浅色" }, { value: "auto", label: "跟随系统" }]}
                value={ctx.themePref} onChange={ctx.setThemePref} />
            </GRow>
            <GRow label="涨跌配色" desc="A股惯例为红涨绿跌 · 可反转为欧美惯例(绿涨红跌)">
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <PnlPreview inv={ctx.inv} />
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 12, color: ctx.inv ? "var(--text-3)" : "var(--text-1)" }}>红涨绿跌</span>
                  <Switch checked={ctx.inv} onChange={ctx.setInv} />
                  <span style={{ fontSize: 12, color: ctx.inv ? "var(--text-1)" : "var(--text-3)" }}>绿涨红跌</span>
                </div>
              </div>
            </GRow>
            <GRow label="数字字体" desc="金额与代码使用等宽 tabular 字体保证列对齐">
              <Badge kind="ok">已启用等宽对齐</Badge>
            </GRow>
          </div>
        </section>

        {/* 隐私 */}
        <section>
          <div className="sec-label">隐私与本地化</div>
          <div className="glist">
            <GRow label="数据本地存储" desc="所有缓存与账本存储于 ~/Library/Sinan/ · 司南不上传任何持仓或交易数据">
              <Badge kind="ok">仅本机</Badge>
            </GRow>
            <GRow label="崩溃诊断上报" desc="匿名 · 不含任何财务信息">
              <Switch checked={false} onChange={() => {}} />
            </GRow>
          </div>
        </section>
      </div>
    </>
  );
}

function PnlPreview({ inv }) {
  const up = inv ? "var(--pnl-down)" : "var(--pnl-up)";
  const down = inv ? "var(--pnl-up)" : "var(--pnl-down)";
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span className="mono" style={{ fontSize: 12, color: up, background: "var(--bg-panel-2)", padding: "3px 8px", borderRadius: 4 }}>+1.82%</span>
      <span className="mono" style={{ fontSize: 12, color: down, background: "var(--bg-panel-2)", padding: "3px 8px", borderRadius: 4 }}>-1.13%</span>
    </div>
  );
}

window.Settings = Settings;
