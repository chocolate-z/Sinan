/* ============================================================
   司南 Sinan — 策略 / 模型 Strategy
   ============================================================ */
function Strategy() {
  const [modelId, setModelId] = React.useState("v24");
  const model = MODELS.find((m) => m.id === modelId) || MODELS[0];
  const enabled = FACTORS.filter((f) => f.on).sort((a, b) => b.weight - a.weight);
  const statusMap = { running: ["ok", "运行中"], archived: ["idle", "已归档"], draft: ["warn", "验证中"] };

  return (
    <>
      <PageHero title="策略 · 模型" sub="多因子选股模型的构成、股票池与纪律化规则"
        right={<div style={{ display: "flex", gap: 10 }}>
          <Button sm icon={I.refresh}>样本外回测</Button>
          <Button sm variant="primary" icon={I.plus}>克隆为新模型</Button>
        </div>} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 模型选择 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {MODELS.map((m) => {
            const active = m.id === modelId;
            const [sk, sl] = statusMap[m.status];
            return (
              <button key={m.id} onClick={() => setModelId(m.id)} style={{
                textAlign: "left", cursor: "pointer", padding: 18, borderRadius: "var(--r-lg)",
                background: active ? "var(--accent-bg)" : "var(--glass-card)",
                WebkitBackdropFilter: "var(--glass-blur)", backdropFilter: "var(--glass-blur)",
                border: "0.5px solid " + (active ? "var(--accent)" : "var(--border)"),
                boxShadow: active ? "var(--accent-glow)" : "var(--hi-edge), var(--shadow-card)",
                display: "flex", flexDirection: "column", gap: 12, transition: "all .14s",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{m.name}</span>
                  <Badge kind={sk}>{sl}</Badge>
                </div>
                <div style={{ display: "flex", gap: 22 }}>
                  <KV k="样本外 IC" v={m.oosIC.toFixed(3)} />
                  <KV k="夏普" v={m.sharpe.toFixed(2)} />
                  <KV k="年化" v={"+" + m.ann + "%"} cls="pnl-up" />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{m.note} · 上线 {m.since}</div>
              </button>
            );
          })}
        </div>

        {/* 流水线 */}
        <Card title="模型流水线" sub="每个交易日收盘后自动执行" pad>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {PIPELINE.map((s, i) => (
              <React.Fragment key={i}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "4px 8px" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "var(--r-md)", display: "grid", placeItems: "center",
                    background: "var(--accent-bg)", color: "var(--accent)", border: "0.5px solid var(--border)" }}>{I[s.icon]}</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{s.k}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3, lineHeight: 1.45 }}>{s.d}</div>
                  </div>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 14, color: "var(--text-3)" }}>{I.chevR}</div>
                )}
              </React.Fragment>
            ))}
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
          {/* 因子构成 */}
          <Card title="因子构成" sub={`${enabled.length} 个启用因子 · ICIR 加权`}
            right={<span className="ch-tag"><i style={{ background: "var(--accent)" }} />权重=Accent</span>}>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {enabled.map((f) => (
                <div key={f.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-1)" }}>{f.name}
                      <span className="chip" style={{ marginLeft: 8 }}>{f.cat}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{(f.weight * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: "var(--bg-input)", overflow: "hidden" }}>
                    <div style={{ width: f.weight / 0.16 * 100 + "%", height: "100%", background: "var(--accent-grad)", borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* 股票池与规则 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card title="股票池与规则" pad={false}>
              <div className="glist" style={{ boxShadow: "none", borderRadius: 0, background: "transparent" }}>
                <RuleRow k="股票池" v="沪深300 + 中证500" />
                <RuleRow k="排除" v="ST / 停牌 / 上市<1年" />
                <RuleRow k="调仓频率" v="每周五收盘" />
                <RuleRow k="持仓数" v="Top 20 · 等权" />
                <RuleRow k="中性化" v="行业 + 市值" />
                <RuleRow k="单票上限" v="15%" />
                <RuleRow k="换手约束" v="单边 ≤ 30% / 周" />
              </div>
            </Card>

            <Card title="风控约束" sub="组合级 · 与回测一致" right={<Badge kind="ok">已启用</Badge>} pad>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <RiskBar label="单票集中度上限" used={15} limit={15} unit="%" />
                <RiskBar label="单行业暴露上限" used={30} limit={30} unit="%" />
                <RiskBar label="组合波动率(年化)" used={18.6} limit={25} />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function KV({ k, v, cls }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 3 }}>{k}</div>
      <div className={"mono " + (cls || "")} style={{ fontSize: 14, fontWeight: 600, color: cls ? undefined : "var(--text-1)" }}>{v}</div>
    </div>
  );
}
function RuleRow({ k, v }) {
  return (
    <div className="grow" style={{ padding: "12px 4px" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{k}</span>
      <span className="mono" style={{ fontSize: 12.5, color: "var(--text-1)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

window.Strategy = Strategy;
