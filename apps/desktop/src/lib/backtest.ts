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

/** 诚实评估口径标签(顶部恒显提示条用)。purge 由回测参数传入。 */
export function honestyBadges(purge: number, costIncluded: boolean): string[] {
  return [
    '信号滞后 1 日',
    `purge ${purge} 日`,
    '仅测训练截止后',
    costIncluded ? '含交易成本' : '⚠ 未含成本',
  ];
}
