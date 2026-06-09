/* ============================================================
   司南 Sinan — 信号 Signals
   方向 = Status 通道(买=蓝 卖=橙 持有=灰),综合分 = 中性
   ============================================================ */
function DirTag({ dir }) {
  const map = {
    buy:  { k: "ok",   t: "买入", icon: "▲" },
    sell: { k: "warn", t: "卖出", icon: "▼" },
    hold: { k: "idle", t: "持有", icon: "—" },
  };
  const m = map[dir];
  return (
    <span className={`badge badge-${m.k}`} style={{ height: 20, fontSize: 11.5, paddingInline: 8 }}>
      <span style={{ fontSize: 9 }}>{m.icon}</span>{m.t}
    </span>
  );
}

function ScoreBar({ score }) {
  // 综合分用中性灰阶,不占用任何颜色通道
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", width: 22 }}>{score}</span>
      <div style={{ width: 56, height: 5, borderRadius: 3, background: "var(--bg-input)", overflow: "hidden" }}>
        <div style={{ width: score + "%", height: "100%", background: score >= 70 ? "var(--text-1)" : "var(--text-3)", borderRadius: 3 }} />
      </div>
    </div>
  );
}

function Signals() {
  const [tab, setTab] = React.useState("通过");
  return (
    <>
      <PageHero title="信号" sub="基于多因子模型 · 2026-06-09 收盘后生成 · 全市场 4,832 只股票"
        right={<Button sm variant="primary" icon={I.refresh}>重新运行</Button>} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Segmented options={[{ value: "通过", label: "入选信号 · 7" }, { value: "拦截", label: "被风控拦截 · 3" }]} value={tab} onChange={setTab} />
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-3)" }}>
            <span className="ch-tag"><i style={{ background: "var(--status-ok)" }} />方向=Status</span>
            <span className="ch-tag"><i style={{ background: "var(--text-2)" }} />综合分=中性</span>
            <span className="ch-tag"><i style={{ background: "var(--pnl-up)" }} />因子贡献=PnL</span>
          </div>
        </div>

        {tab === "通过" ? (
          <Card pad={false}>
            <table className="dt">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>标的</th>
                  <th style={{ width: 78 }}>方向</th>
                  <th style={{ width: 120 }}>综合分</th>
                  <th>因子贡献</th>
                  <th>入选原因</th>
                </tr>
              </thead>
              <tbody>
                {SIGNALS.map((s) => (
                  <SignalRow key={s.code} s={s} />
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card pad={false}>
            <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--status-warn)", display: "inline-flex" }}>{I.shield}</span>
              <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>以下标的初选入围,但被风控闸拦截,不进入交易候选。风控规则可在<b style={{ color: "var(--text-1)", fontWeight: 500 }}>设置 · 风控</b>中调整。</span>
            </div>
            <table className="dt">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>标的</th>
                  <th style={{ width: 78 }}>初选方向</th>
                  <th style={{ width: 120 }}>综合分</th>
                  <th style={{ width: 230 }}>拦截规则</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {SIGNALS_BLOCKED.map((s) => (
                  <tr key={s.code} style={{ opacity: 0.92 }}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontWeight: 500, textDecoration: "line-through", textDecorationColor: "var(--text-3)" }}>{s.name}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{s.code}</span>
                      </div>
                    </td>
                    <td><DirTag dir={s.dir} /></td>
                    <td><ScoreBar score={s.score} /></td>
                    <td><span className="badge badge-warn" style={{ height: 20, fontSize: 11 }}><span className="dot" />{s.blockedBy}</span></td>
                    <td style={{ color: "var(--text-2)", fontSize: 12 }}>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}

function SignalRow({ s }) {
  return (
    <tr>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontWeight: 500, color: "var(--text-1)" }}>{s.name}</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{s.code}</span>
        </div>
      </td>
      <td><DirTag dir={s.dir} /></td>
      <td><ScoreBar score={s.score} /></td>
      <td>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {s.factors.map((f, i) => <Chip key={i} label={f[0]} value={f[1]} />)}
        </div>
      </td>
      <td style={{ color: "var(--text-2)", fontSize: 12, maxWidth: 280, whiteSpace: "normal" }}>{s.reason}</td>
    </tr>
  );
}

window.Signals = Signals;
