/** 行情页纯逻辑(便于单测)。涨跌走盈亏色;K 线用轻量 SVG 蜡烛图,几何映射在此计算,
 * 不引第三方图表库(更易测、零额外依赖)。 */

export interface QuoteRow {
  stock_code: string;
  name: string | null;
  price: number | null;
  prev_close: number | null;
  open: number | null;
  source?: string | null;
}

export interface KBar {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  amount?: number | null;
}

export interface QuoteChange {
  abs: number | null; // 现价 − 昨收
  pct: number | null; // 现价/昨收 − 1
}

/** 涨跌额/幅(null 安全:缺价或昨收 0 → null)。 */
export function quoteChange(price?: number | null, prevClose?: number | null): QuoteChange {
  if (price == null || prevClose == null || prevClose === 0) return { abs: null, pct: null };
  return { abs: price - prevClose, pct: price / prevClose - 1 };
}

/** 简单移动平均;前 n-1 个点为 null。MA(t) 只用 <=t 的收盘,无未来泄漏。 */
export function movingAverage(closes: number[], n: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export interface ChartLayout {
  width: number;
  height: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
}

export interface Candle {
  x: number; // 中心 x
  bodyX: number; // 实体左缘
  bodyW: number; // 实体宽(>=1)
  bodyY: number; // 实体上缘 = scaleY(max(open,close))
  bodyH: number; // 实体高(>=1,平盘也有 1px)
  highY: number; // 影线上端
  lowY: number; // 影线下端
  up: boolean; // 收 >= 开 为涨
}

export interface CandleChart {
  candles: Candle[];
  xs: number[]; // 各 K 中心 x(供 MA 折线对齐)
  yMin: number;
  yMax: number;
  scaleY: (v: number) => number;
}

/** 把日 K 序列映射为 SVG 蜡烛几何。y 轴范围取 [min(low), max(high)],无额外缩放(可预测、易测)。 */
export function buildCandleChart(bars: KBar[], layout: ChartLayout): CandleChart {
  const plotW = layout.width - layout.padLeft - layout.padRight;
  const plotH = layout.height - layout.padTop - layout.padBottom;
  const n = bars.length;
  if (n === 0) {
    return { candles: [], xs: [], yMin: 0, yMax: 0, scaleY: () => layout.padTop + plotH / 2 };
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const b of bars) {
    if (b.low < yMin) yMin = b.low;
    if (b.high > yMax) yMax = b.high;
  }
  const range = yMax - yMin;
  const scaleY = (v: number): number =>
    range === 0 ? layout.padTop + plotH / 2 : layout.padTop + ((yMax - v) / range) * plotH;

  const slot = plotW / n;
  const bodyW = Math.max(slot * 0.6, 1);
  const candles: Candle[] = [];
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const x = layout.padLeft + slot * (i + 0.5);
    const top = scaleY(Math.max(b.open, b.close));
    const bottom = scaleY(Math.min(b.open, b.close));
    xs.push(x);
    candles.push({
      x,
      bodyX: x - bodyW / 2,
      bodyW,
      bodyY: top,
      bodyH: Math.max(bottom - top, 1),
      highY: scaleY(b.high),
      lowY: scaleY(b.low),
      up: b.close >= b.open,
    });
  }
  return { candles, xs, yMin, yMax, scaleY };
}

/** MA 序列 → SVG polyline points(跳过 null 段;不足窗口期的前缀不画)。 */
export function maPoints(ma: Array<number | null>, chart: CandleChart): string {
  const pts: string[] = [];
  for (let i = 0; i < ma.length; i++) {
    const v = ma[i];
    if (v == null) continue;
    pts.push(`${chart.xs[i].toFixed(2)},${chart.scaleY(v).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** 当前主源是否具备某能力(免费源缺北向/财务时据此置灰)。 */
export function capEnabled(
  providers: Array<{ id: string; caps?: Record<string, boolean> }>,
  activeId: string | null,
  cap: string,
): boolean {
  const p = providers.find((x) => x.id === activeId);
  return Boolean(p?.caps?.[cap]);
}
