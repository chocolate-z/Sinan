/* ============================================================
   司南 Sinan — 首启引导 Onboarding (全屏向导)
   ============================================================ */
function Onboarding({ onDone }) {
  const [step, setStep] = React.useState(0);
  const [provider, setProvider] = React.useState("tushare");
  const [token, setToken] = React.useState("");
  const [test, setTest] = React.useState("idle"); // idle testing ok
  const [cache, setCache] = React.useState(0);

  const steps = ["选择数据源", "填写 Token", "测试连通", "建立缓存"];

  React.useEffect(() => {
    if (step === 3 && cache < 100) {
      const t = setInterval(() => setCache((c) => Math.min(100, c + 4)), 90);
      return () => clearInterval(t);
    }
  }, [step, cache]);

  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="main-aurora" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", zIndex: 100 }}>
      {/* drag title bar */}
      <div style={{ height: "var(--titlebar-h)", flex: "none" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: 560, maxWidth: "100%" }}>
          {/* brand */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 40 }}>
            <div style={{ width: 52, height: 52, borderRadius: 15, background: "var(--accent-grad)", display: "grid", placeItems: "center", marginBottom: 16, boxShadow: "var(--accent-glow)" }}>
              <Compass size={28} color="#fff" />
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>欢迎使用 司南 Sinan</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-2)" }}>诚实、纪律化、可解释的本地量化研究工具</p>
          </div>

          {/* progress */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
            {steps.map((s, i) => (
              <React.Fragment key={i}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, flex: "none" }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center",
                    fontSize: 12, fontWeight: 600,
                    background: i < step ? "var(--accent)" : i === step ? "var(--accent-bg)" : "var(--bg-panel-2)",
                    color: i < step ? "#fff" : i === step ? "var(--accent)" : "var(--text-3)",
                    border: "0.5px solid " + (i <= step ? "var(--accent)" : "var(--border)"),
                  }}>{i < step ? <span style={{ display: "inline-flex" }}>{I.check}</span> : i + 1}</div>
                  <span style={{ fontSize: 11, color: i === step ? "var(--text-1)" : "var(--text-3)", fontWeight: i === step ? 500 : 400 }}>{s}</span>
                </div>
                {i < steps.length - 1 && <div style={{ flex: 1, height: 0.5, background: i < step ? "var(--accent)" : "var(--border)", margin: "0 8px", marginBottom: 18 }} />}
              </React.Fragment>
            ))}
          </div>

          {/* panel */}
          <div className="card" style={{ padding: 24, minHeight: 220, display: "flex", flexDirection: "column" }}>
            {step === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>选择行情数据源</div>
                {[["tushare", "Tushare Pro", "推荐 · 社区数据接口,覆盖全 A 股"], ["akshare", "AkShare", "开源免费 · 适合入门"], ["local", "本地数据目录", "已有 CSV / Parquet 数据"]].map(([id, n, d]) => (
                  <button key={id} onClick={() => setProvider(id)} style={{
                    textAlign: "left", cursor: "pointer", padding: "12px 14px", borderRadius: "var(--r-md)",
                    background: provider === id ? "var(--accent-bg)" : "var(--bg-panel-2)",
                    border: "0.5px solid " + (provider === id ? "var(--accent)" : "var(--border)"),
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <span style={{ color: provider === id ? "var(--accent)" : "var(--text-3)" }}>{I.db}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{n}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 2 }}>{d}</div>
                    </div>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid " + (provider === id ? "var(--accent)" : "var(--border-strong)"), display: "grid", placeItems: "center" }}>
                      {provider === id && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {step === 1 && (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>填写 API Token</div>
                <label className="field-label">从数据源官网获取的访问令牌</label>
                <input className="input mono" placeholder="粘贴你的 token…" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
                <div style={{ marginTop: 14, padding: 12, background: "var(--status-ok-bg)", borderRadius: "var(--r-sm)", fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.6 }}>
                  <span style={{ color: "var(--status-ok)" }}>ⓘ</span> Token 仅保存在本机配置中,司南<b style={{ color: "var(--text-1)", fontWeight: 500 }}>不会</b>将其上传至任何服务器。
                </div>
              </div>
            )}
            {step === 2 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14 }}>
                {test === "idle" && <>
                  <span style={{ color: "var(--text-3)" }}><Compass size={36} color="var(--text-3)" /></span>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>点击下方按钮验证数据源连通性</div>
                  <Button variant="primary" onClick={() => { setTest("testing"); setTimeout(() => setTest("ok"), 1300); }}>开始测试</Button>
                </>}
                {test === "testing" && <>
                  <div className="spin" style={{ width: 30, height: 30, border: "2.5px solid var(--border-strong)", borderTopColor: "var(--accent)", borderRadius: "50%" }} />
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>正在连接 · 校验权限…</div>
                </>}
                {test === "ok" && <>
                  <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--status-ok-bg)", color: "var(--status-ok)", display: "grid", placeItems: "center" }}>{I.check}</span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>连接成功</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>日线 / 分钟 / 财务 / 复权因子 均可用 · 延迟 118ms</div>
                </>}
              </div>
            )}
            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, gap: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{cache < 100 ? "正在建立本地缓存…" : "缓存建立完成"}</div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-2)", marginBottom: 6 }}>
                    <span>下载沪深A股近 5 年日线 + 基本面</span>
                    <span className="mono">{cache}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--bg-input)", overflow: "hidden" }}>
                    <div style={{ width: cache + "%", height: "100%", background: "var(--accent)", borderRadius: 3, transition: "width 0.2s linear" }} />
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)" }} className="mono">{Math.round(cache / 100 * 4832)} / 4,832 标的 · {Math.round(cache / 100 * 1.8 * 10) / 10} GB</div>
              </div>
            )}
          </div>

          {/* footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
            <Button variant="ghost" onClick={step === 0 ? onDone : back}>{step === 0 ? "跳过" : "上一步"}</Button>
            {step < 3 && <Button variant="primary" onClick={next} disabled={(step === 1 && !token) || (step === 2 && test !== "ok")}>下一步</Button>}
            {step === 3 && <Button variant="primary" onClick={onDone} disabled={cache < 100}>进入司南</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Compass({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill={color} stroke="none" />
    </svg>
  );
}

Object.assign(window, { Onboarding, Compass });
