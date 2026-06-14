import { describe, it, expect } from 'vitest';
import {
  areaPath,
  buildNavCharts,
  compareBacktests,
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

describe('compareBacktests 模型 vs 等权基线', () => {
  const model = {
    annual_return: 0.18,
    excess_return: 0.06,
    sharpe: 1.4,
    information_ratio: 0.8,
    max_drawdown: 0.12,
    win_rate: 0.56,
    turnover: 1.2,
  };
  const equal = {
    annual_return: 0.1,
    excess_return: 0.0,
    sharpe: 0.9,
    information_ratio: 0.4,
    max_drawdown: 0.18,
    win_rate: 0.5,
    turnover: 1.0,
  };

  it('模型明显更好 → tone=good,逐项 diff/方向正确', () => {
    const c = compareBacktests(model, equal);
    expect(c.verdict.tone).toBe('good');
    const ann = c.metrics.find((m) => m.key === 'annual_return')!;
    expect(ann.diff).toBeCloseTo(0.08);
    expect(ann.modelBetter).toBe(true);
    // 最大回撤越低越优:模型 0.12 < 等权 0.18 → diff 负但模型更优
    const dd = c.metrics.find((m) => m.key === 'max_drawdown')!;
    expect(dd.betterIsHigher).toBe(false);
    expect(dd.diff).toBeCloseTo(-0.06);
    expect(dd.modelBetter).toBe(true);
    expect(c.verdict.detail).toContain('非未来收益保证');
  });

  it('模型更差(年化更低)→ tone=bad', () => {
    const c = compareBacktests(equal, model); // 反过来
    expect(c.verdict.tone).toBe('bad');
    expect(c.metrics.find((m) => m.key === 'annual_return')!.modelBetter).toBe(false);
  });

  it('基本持平 → tone=neutral', () => {
    const c = compareBacktests(
      { annual_return: 0.101, sharpe: 0.91 },
      { annual_return: 0.1, sharpe: 0.9 },
    );
    expect(c.verdict.tone).toBe('neutral');
  });

  it('换手率越低越优:模型换手更高 → 该项 modelBetter=false', () => {
    const c = compareBacktests(model, equal);
    const to = c.metrics.find((m) => m.key === 'turnover')!;
    expect(to.betterIsHigher).toBe(false);
    expect(to.diff).toBeCloseTo(0.2); // 模型换手更高
    expect(to.modelBetter).toBe(false);
  });

  it('缺指标安全:diff 为 null,主信号全缺 → 数据不足', () => {
    const c = compareBacktests({}, {});
    expect(c.metrics.every((m) => m.diff === null && m.modelBetter === null)).toBe(true);
    expect(c.verdict.headline).toContain('数据不足');
  });
});
