/** 回测页纯逻辑(便于单测):净值曲线 / 回撤序列与阴影 / 月度收益热力图 + 轻量 SVG 几何。
 * 净值与收益走盈亏色(pnl-*),诚实口径提示条走系统色,二者解耦(红线)。 */

export interface NavPoint {
  date: string; // YYYY-MM-DD
  nav: number;
  benchmark?: number | null;
}

export interface ChartBox {
  width: number;
  height: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
}

/** 回撤序列:drawdown[i] = nav[i]/峰值 − 1(≤0;峰值随时间只增)。 */
export function drawdownSeries(navs: number[]): number[] {
  let peak = -Infinity;
  return navs.map((v) => {
    if (v > peak) peak = v;
    return peak > 0 ? v / peak - 1 : 0;
  });
}

export interface MonthReturn {
  year: number;
  month: number; // 1–12
  ret: number;
}

/** 月度收益:按 YYYY-MM 取月末净值,链式相除(首月用月内首值作基)。 */
export function monthlyReturns(points: NavPoint[]): MonthReturn[] {
  if (!points.length) return [];
  const byMonth = new Map<string, { first: number; last: number; y: number; m: number }>();
  for (const p of points) {
    const y = Number(p.date.slice(0, 4));
    const m = Number(p.date.slice(5, 7));
    const key = `${y}-${m}`;
    const e = byMonth.get(key);
    if (!e) byMonth.set(key, { first: p.nav, last: p.nav, y, m });
    else e.last = p.nav;
  }
  const months = [...byMonth.values()].sort((a, b) => a.y - b.y || a.m - b.m);
  const out: MonthReturn[] = [];
  let prevLast: number | undefined;
  for (const mm of months) {
    const base = prevLast ?? mm.first;
    out.push({ year: mm.y, month: mm.m, ret: base ? mm.last / base - 1 : 0 });
    prevLast = mm.last;
  }
  return out;
}

/** 把月度收益整理成「年×12月」网格(缺失月为 null),供热力图渲染。 */
export function monthlyGrid(
  months: MonthReturn[],
): { year: number; cells: Array<number | null> }[] {
  const byYear = new Map<number, Array<number | null>>();
  for (const m of months) {
    if (!byYear.has(m.year)) byYear.set(m.year, Array(12).fill(null));
    byYear.get(m.year)![m.month - 1] = m.ret;
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, cells]) => ({ year, cells }));
}

function plot(box: ChartBox) {
  return { w: box.width - box.padLeft - box.padRight, h: box.height - box.padTop - box.padBottom };
}

/** 折线 points 串(等距 x;null 跳过)。yMin/yMax 由调用方统一,保证多线同坐标。 */
export function linePoints(
  values: Array<number | null>,
  yMin: number,
  yMax: number,
  box: ChartBox,
): string {
  const n = values.length;
  if (!n) return '';
  const { w, h } = plot(box);
  const range = yMax - yMin || 1;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null) continue;
    const x = box.padLeft + (n === 1 ? 0 : (w * i) / (n - 1));
    const y = box.padTop + ((yMax - v) / range) * h;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/** 回撤阴影 path:从基线(0)填充到回撤曲线并闭合。yMax=0、yMin=min(drawdown)。 */
export function areaPath(values: number[], yMin: number, yMax: number, box: ChartBox): string {
  const n = values.length;
  if (!n) return '';
  const { w, h } = plot(box);
  const range = yMax - yMin || 1;
  const x = (i: number) => box.padLeft + (n === 1 ? 0 : (w * i) / (n - 1));
  const y = (v: number) => box.padTop + ((yMax - v) / range) * h;
  let d = `M ${x(0).toFixed(2)} ${y(0).toFixed(2)}`;
  for (let i = 0; i < n; i++) d += ` L ${x(i).toFixed(2)} ${y(values[i]).toFixed(2)}`;
  d += ` L ${x(n - 1).toFixed(2)} ${y(0).toFixed(2)} Z`;
  return d;
}

export interface NavCharts {
  portfolio: string; // polyline points(组合,归一化到 1)
  benchmark: string; // polyline points(基准,归一化到 1)
  drawdown: string; // area path(回撤阴影)
  yMin: number;
  yMax: number;
  ddMin: number; // 最深回撤(负)
  hasBenchmark: boolean;
}

/** 组合 vs 基准净值(各自归一化到起点=1)+ 回撤阴影,统一坐标。 */
export function buildNavCharts(points: NavPoint[], navBox: ChartBox, ddBox: ChartBox): NavCharts {
  if (!points.length) {
    return {
      portfolio: '',
      benchmark: '',
      drawdown: '',
      yMin: 1,
      yMax: 1,
      ddMin: 0,
      hasBenchmark: false,
    };
  }
  const navs = points.map((p) => p.nav);
  const base = navs[0] || 1;
  const port = navs.map((v) => v / base);

  const benchRaw = points.map((p) => p.benchmark ?? null);
  const hasBenchmark = benchRaw.some((v) => v != null);
  const b0 = benchRaw.find((v) => v != null) ?? null;
  const bench = benchRaw.map((v) => (v != null && b0 ? v / b0 : null));

  const all = [...port, ...bench.filter((v): v is number => v != null)];
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);

  const dd = drawdownSeries(navs);
  const ddMin = Math.min(0, ...dd);

  return {
    portfolio: linePoints(port, yMin, yMax, navBox),
    benchmark: hasBenchmark ? linePoints(bench, yMin, yMax, navBox) : '',
    drawdown: areaPath(dd, ddMin, 0, ddBox),
    yMin,
    yMax,
    ddMin,
    hasBenchmark,
  };
}

export interface TradeLite {
  trade_date: string;
  code: string;
  side: string; // buy / sell
  shares: number;
  price: number;
  reason?: string;
}

export interface TradeMarker {
  x: number;
  y: number;
  side: string;
  date: string;
  code: string;
  shares: number;
  price: number;
  reason: string;
}

/** 把逐笔成交映射到净值曲线坐标(买卖点)。成交日须落在 nav 曲线日期上;坐标与组合线同尺度。 */
export function tradeMarkers(
  trades: TradeLite[],
  navCurve: NavPoint[],
  box: ChartBox,
  yMin: number,
  yMax: number,
): TradeMarker[] {
  if (!navCurve.length || !trades.length) return [];
  const base = navCurve[0].nav || 1;
  const idxByDate = new Map<string, number>();
  navCurve.forEach((p, i) => idxByDate.set(p.date, i));
  const { w, h } = plot(box);
  const n = navCurve.length;
  const range = yMax - yMin || 1;
  const out: TradeMarker[] = [];
  for (const t of trades) {
    const idx = idxByDate.get(t.trade_date);
    if (idx == null) continue;
    const norm = navCurve[idx].nav / base;
    const x = box.padLeft + (n === 1 ? 0 : (w * idx) / (n - 1));
    const y = box.padTop + ((yMax - norm) / range) * h;
    out.push({
      x,
      y,
      side: t.side,
      date: t.trade_date,
      code: t.code,
      shares: t.shares,
      price: t.price,
      reason: t.reason ?? '',
    });
  }
  return out;
}

/** 诚实评估口径标签(顶部恒显提示条用)。purge 由回测参数传入。 */
export function honestyBadges(purge: number, costIncluded: boolean): string[] {
  return [
    '信号滞后 1 日',
    `purge ${purge} 日`,
    '仅测训练截止后',
    costIncluded ? '含交易成本' : '⚠ 未含成本',
  ];
}

// ── 模型 vs 等权基线对比(回答「模型有没有用」;纯逻辑,便于单测)──────────────────
// 调用方须保证两次回测同窗口/同成本(以等权回测复用模型回测的生效 train_end)——否则非公平对比。
// 红线#3 诚实:判定只读两份样本外 metrics,不夸大;持平/跑输如实说,且永远附「非未来收益保证」。

export interface CompareMetric {
  key: string;
  label: string;
  model: number | null;
  equal: number | null;
  diff: number | null; // model − equal(原始单位)
  unit: 'pct' | 'num'; // pct=百分数(×100)·num=两位小数
  betterIsHigher: boolean; // 该指标越高越好(回撤/换手为 false)
  modelBetter: boolean | null; // 模型在该指标是否更优;null=持平或缺失
}

export interface BacktestComparison {
  metrics: CompareMetric[];
  verdict: { tone: 'good' | 'neutral' | 'bad'; headline: string; detail: string };
}

const COMPARE_SPEC: Array<{ key: string; label: string; unit: 'pct' | 'num'; higher: boolean }> = [
  { key: 'annual_return', label: '年化收益', unit: 'pct', higher: true },
  { key: 'excess_return', label: '超额收益(vs 基准)', unit: 'pct', higher: true },
  { key: 'sharpe', label: '夏普比率', unit: 'num', higher: true },
  { key: 'information_ratio', label: '信息比率', unit: 'num', higher: true },
  { key: 'max_drawdown', label: '最大回撤', unit: 'pct', higher: false },
  { key: 'win_rate', label: '胜率', unit: 'pct', higher: true },
  { key: 'turnover', label: '区间换手', unit: 'pct', higher: false },
];

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function signedPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}
function signedNum(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** 模型 metrics 与等权 metrics 逐项对比 + 综合判定。 */
export function compareBacktests(
  modelMetrics: Record<string, unknown> | null | undefined,
  equalMetrics: Record<string, unknown> | null | undefined,
): BacktestComparison {
  const mm = modelMetrics ?? {};
  const em = equalMetrics ?? {};
  const metrics: CompareMetric[] = COMPARE_SPEC.map((s) => {
    const model = finiteNum(mm[s.key]);
    const equal = finiteNum(em[s.key]);
    const diff = model != null && equal != null ? model - equal : null;
    let modelBetter: boolean | null = null;
    if (diff != null && diff !== 0) modelBetter = s.higher ? diff > 0 : diff < 0;
    return {
      key: s.key,
      label: s.label,
      model,
      equal,
      diff,
      unit: s.unit,
      betterIsHigher: s.higher,
      modelBetter,
    };
  });

  // 综合判定:以年化(annual delta)与夏普 delta 为主信号(阈值避免噪声当真增益)。
  const annDiff = pairDiff(mm.annual_return, em.annual_return);
  const shDiff = pairDiff(mm.sharpe, em.sharpe);
  const exDiff = pairDiff(mm.excess_return, em.excess_return);

  let tone: 'good' | 'neutral' | 'bad' = 'neutral';
  let headline = '模型与等权基线基本持平,增益不显著'; // 中性默认(下方仅在 good/bad/缺数据时改写)
  if (annDiff == null && shDiff == null) {
    headline = '数据不足,无法判定';
  } else {
    const ad = annDiff ?? 0;
    const sd = shDiff ?? 0;
    if (ad >= 0.005 && sd >= -0.05) {
      tone = 'good';
      headline = '模型跑赢等权基线';
    } else if (ad <= -0.005 || sd <= -0.2) {
      tone = 'bad';
      headline = '模型跑输等权基线';
    }
  }
  const parts: string[] = [];
  if (annDiff != null) parts.push(`年化 ${signedPct(annDiff)}`);
  if (shDiff != null) parts.push(`夏普 ${signedNum(shDiff)}`);
  if (exDiff != null) parts.push(`超额 ${signedPct(exDiff)}`);
  const detail = (parts.length ? parts.join(' · ') + '。' : '') + '单次样本外对比,非未来收益保证。';
  return { metrics, verdict: { tone, headline, detail } };
}

function pairDiff(a: unknown, b: unknown): number | null {
  const x = finiteNum(a);
  const y = finiteNum(b);
  return x != null && y != null ? x - y : null;
}
