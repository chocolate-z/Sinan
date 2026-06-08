import { describe, it, expect } from 'vitest';
import {
  buildCandleChart,
  capEnabled,
  maPoints,
  movingAverage,
  quoteChange,
  type ChartLayout,
  type KBar,
} from '../src/lib/market';

describe('quoteChange 涨跌额/幅', () => {
  it('正常计算', () => {
    const c = quoteChange(11, 10);
    expect(c.abs).toBe(1);
    expect(c.pct).toBeCloseTo(0.1);
  });
  it('缺价或昨收为 0 → null(不臆造)', () => {
    expect(quoteChange(null, 10)).toEqual({ abs: null, pct: null });
    expect(quoteChange(11, null)).toEqual({ abs: null, pct: null });
    expect(quoteChange(11, 0)).toEqual({ abs: null, pct: null });
  });
});

describe('movingAverage', () => {
  it('前 n-1 个为 null,其后为窗口均值', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('只用当期及之前的收盘(无未来泄漏)', () => {
    const ma = movingAverage([10, 20, 30], 2);
    // MA(t=1) 只含 10,20 → 15;与 t=2 的 30 无关
    expect(ma).toEqual([null, 15, 25]);
  });
});

const LAYOUT: ChartLayout = {
  width: 100,
  height: 100,
  padTop: 0,
  padBottom: 0,
  padLeft: 0,
  padRight: 0,
};

describe('buildCandleChart 几何映射', () => {
  const bars: KBar[] = [
    { trade_date: 'd1', open: 2, high: 10, low: 0, close: 8 }, // 涨
    { trade_date: 'd2', open: 8, high: 9, low: 1, close: 4 }, // 跌
  ];
  const chart = buildCandleChart(bars, LAYOUT);

  it('每根 K 一个蜡烛;涨跌方向正确', () => {
    expect(chart.candles).toHaveLength(2);
    expect(chart.candles[0].up).toBe(true);
    expect(chart.candles[1].up).toBe(false);
  });

  it('y 轴:最高价映射到顶(0),最低价到底(height)', () => {
    expect(chart.yMax).toBe(10);
    expect(chart.yMin).toBe(0);
    expect(chart.scaleY(10)).toBeCloseTo(0); // 顶
    expect(chart.scaleY(0)).toBeCloseTo(100); // 底
    expect(chart.scaleY(5)).toBeCloseTo(50); // 价越高 y 越小
  });

  it('涨 K 实体上缘在收盘(更高价),实体高 >= 1', () => {
    const up = chart.candles[0];
    expect(up.bodyY).toBeCloseTo(chart.scaleY(8)); // max(open,close)=close=8
    expect(up.bodyH).toBeGreaterThanOrEqual(1);
    expect(up.highY).toBeCloseTo(0);
    expect(up.lowY).toBeCloseTo(100);
  });

  it('平盘也给 1px 实体高,空序列不报错', () => {
    const flat = buildCandleChart(
      [{ trade_date: 'x', open: 5, high: 5, low: 5, close: 5 }],
      LAYOUT,
    );
    expect(flat.candles[0].bodyH).toBe(1);
    const empty = buildCandleChart([], LAYOUT);
    expect(empty.candles).toEqual([]);
    expect(empty.scaleY(123)).toBe(50); // 退化为中线,不抛
  });
});

describe('maPoints', () => {
  it('跳过 null,输出 x,y 点串', () => {
    const bars: KBar[] = [
      { trade_date: 'd1', open: 1, high: 1, low: 1, close: 1 },
      { trade_date: 'd2', open: 1, high: 1, low: 1, close: 1 },
    ];
    const chart = buildCandleChart(bars, LAYOUT);
    const pts = maPoints([null, 1], chart);
    expect(pts.split(' ')).toHaveLength(1); // 仅第二个点
    expect(pts).toContain(',');
  });
});

describe('capEnabled 免费源置灰', () => {
  const providers = [
    { id: 'tushare', caps: { NORTHBOUND: true, DAILY_OHLCV: true } },
    { id: 'akshare', caps: { NORTHBOUND: false, DAILY_OHLCV: true } },
  ];
  it('按主源能力位判定', () => {
    expect(capEnabled(providers, 'tushare', 'NORTHBOUND')).toBe(true);
    expect(capEnabled(providers, 'akshare', 'NORTHBOUND')).toBe(false);
    expect(capEnabled(providers, null, 'NORTHBOUND')).toBe(false);
    expect(capEnabled(providers, 'akshare', 'DAILY_OHLCV')).toBe(true);
  });
});
