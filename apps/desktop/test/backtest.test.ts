import { describe, it, expect } from 'vitest';
import {
  areaPath,
  buildNavCharts,
  drawdownSeries,
  honestyBadges,
  linePoints,
  monthlyGrid,
  monthlyReturns,
  tradeMarkers,
  type ChartBox,
  type NavPoint,
} from '../src/lib/backtest';

const BOX: ChartBox = { width: 100, height: 100, padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 };

describe('drawdownSeries', () => {
  it('峰值随时间只增,回撤为 nav/峰值-1(≤0)', () => {
    expect(drawdownSeries([1, 1.2, 0.9, 1.5])).toEqual([0, 0, 0.9 / 1.2 - 1, 0]);
  });
  it('单调上升无回撤', () => {
    expect(drawdownSeries([1, 2, 3])).toEqual([0, 0, 0]);
  });
});

describe('monthlyReturns / monthlyGrid', () => {
  const pts: NavPoint[] = [
    { date: '2024-01-05', nav: 100 },
    { date: '2024-01-25', nav: 110 }, // 1 月末 110
    { date: '2024-02-10', nav: 121 }, // 2 月末 121
    { date: '2025-01-10', nav: 121 },
  ];
  it('按月末链式相除;首月用月内首值', () => {
    const m = monthlyReturns(pts);
    expect(m[0]).toEqual({ year: 2024, month: 1, ret: 110 / 100 - 1 }); // 月内 100→110
    expect(m[1]).toEqual({ year: 2024, month: 2, ret: 121 / 110 - 1 }); // 上月末 110→121
    expect(m[2].year).toBe(2025);
  });
  it('整理为 年×12 网格,缺失月为 null', () => {
    const grid = monthlyGrid(monthlyReturns(pts));
    expect(grid.map((r) => r.year)).toEqual([2024, 2025]);
    expect(grid[0].cells.length).toBe(12);
    expect(grid[0].cells[2]).toBeNull(); // 2024-03 无数据
    expect(grid[0].cells[0]).toBeCloseTo(0.1); // 1 月
  });
  it('空输入安全', () => {
    expect(monthlyReturns([])).toEqual([]);
    expect(monthlyGrid([])).toEqual([]);
  });
});

describe('linePoints / areaPath', () => {
  it('值越大 y 越小(顶部);等距 x', () => {
    const pts = linePoints([0, 1, 2], 0, 2, BOX).split(' ');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toBe('0.00,100.00'); // 最小值 → 底
    expect(pts[2]).toBe('100.00,0.00'); // 最大值 → 顶,x 到右端
  });
  it('null 跳过', () => {
    expect(linePoints([1, null, 2], 0, 2, BOX).split(' ')).toHaveLength(2);
  });
  it('areaPath 闭合(M…L…Z)', () => {
    const d = areaPath([0, -0.1, -0.05], -0.1, 0, BOX);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });
});

describe('buildNavCharts', () => {
  const pts: NavPoint[] = [
    { date: '2024-01-01', nav: 1_000_000, benchmark: 4000 },
    { date: '2024-01-02', nav: 1_100_000, benchmark: 4200 },
    { date: '2024-01-03', nav: 990_000, benchmark: 4100 },
  ];
  it('组合与基准各自归一化到起点=1,坐标统一', () => {
    const c = buildNavCharts(pts, BOX, BOX);
    expect(c.hasBenchmark).toBe(true);
    expect(c.portfolio.split(' ')).toHaveLength(3);
    expect(c.benchmark.split(' ')).toHaveLength(3);
    expect(c.ddMin).toBeLessThan(0); // 第三日回撤
    expect(c.yMax).toBeGreaterThanOrEqual(1.1); // 组合峰 1.1
  });
  it('无基准时 benchmark 为空串', () => {
    const c = buildNavCharts(
      [
        { date: '2024-01-01', nav: 100 },
        { date: '2024-01-02', nav: 101 },
      ],
      BOX,
      BOX,
    );
    expect(c.hasBenchmark).toBe(false);
    expect(c.benchmark).toBe('');
  });
  it('空输入安全', () => {
    const c = buildNavCharts([], BOX, BOX);
    expect(c.portfolio).toBe('');
  });
});

describe('tradeMarkers 买卖点映射', () => {
  const nav: NavPoint[] = [
    { date: 'd1', nav: 100 },
    { date: 'd2', nav: 110 },
    { date: 'd3', nav: 99 },
  ];
  it('成交按日期落到曲线索引,坐标与组合线同尺度', () => {
    const mk = tradeMarkers(
      [
        { trade_date: 'd2', code: 'A', side: 'buy', shares: 100, price: 10 },
        { trade_date: 'd3', code: 'A', side: 'sell', shares: 100, price: 9 },
      ],
      nav,
      BOX,
      0.99,
      1.1, // 归一化 yMin/yMax(99/100, 110/100)
    );
    expect(mk).toHaveLength(2);
    expect(mk[0].side).toBe('buy');
    expect(mk[0].x).toBeCloseTo(50); // idx1 / (3-1) * 100
    expect(mk[1].x).toBeCloseTo(100); // idx2 末端
    // d2 归一化 1.1 = yMax → y 到顶 0
    expect(mk[0].y).toBeCloseTo(0);
  });
  it('成交日不在曲线上则跳过;空输入安全', () => {
    expect(
      tradeMarkers(
        [{ trade_date: 'zzz', code: 'A', side: 'buy', shares: 1, price: 1 }],
        nav,
        BOX,
        0,
        2,
      ),
    ).toEqual([]);
    expect(tradeMarkers([], nav, BOX, 0, 2)).toEqual([]);
  });
});

describe('honestyBadges 诚实口径', () => {
  it('含成本时四项齐备', () => {
    expect(honestyBadges(5, true)).toEqual([
      '信号滞后 1 日',
      'purge 5 日',
      '仅测训练截止后',
      '含交易成本',
    ]);
  });
  it('未含成本时标警', () => {
    expect(honestyBadges(3, false)[3]).toBe('⚠ 未含成本');
  });
});
