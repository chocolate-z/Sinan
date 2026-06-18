import { describe, it, expect } from 'vitest';
import { icirWeightPlan } from '../src/lib/factorWeights';

describe('icirWeightPlan(按 ICIR 自动定权)', () => {
  it('没有质检报告 → 不改、如实说明(要先跑质检拿 ICIR)', () => {
    const p = icirWeightPlan([{ name: 'ep' }], [], null);
    expect(p.ok).toBe(false);
    expect(p.targets).toEqual([]);
    expect(p.note).toContain('因子质检');
  });

  it('正 ICIR 按比例定权,归一到均值 1.0(权重和=因子数)', () => {
    const p = icirWeightPlan(
      [{ name: 'ep' }, { name: 'bp' }, { name: 'mom20' }],
      [],
      [
        { name: 'ep', icir: 0.6 },
        { name: 'bp', icir: 0.3 },
        { name: 'mom20', icir: 0.3 },
      ],
    );
    expect(p.ok).toBe(true);
    const w = Object.fromEntries(p.targets.map((t) => [t.name, t.weight]));
    // 总和 1.2,scale=3/1.2=2.5 → ep=1.5, bp=0.75, mom20=0.75;和=3,均值=1
    expect(w).toEqual({ ep: 1.5, bp: 0.75, mom20: 0.75 });
    expect(p.targets.reduce((s, t) => s + t.weight, 0)).toBeCloseTo(3, 6);
  });

  it('ICIR ≤ 0 的因子拿 0 权(反向/无预测力,不硬凑、不二次翻向)', () => {
    const p = icirWeightPlan(
      [{ name: 'ep' }, { name: 'bad' }],
      [],
      [
        { name: 'ep', icir: 0.5 },
        { name: 'bad', icir: -0.4 },
      ],
    );
    expect(p.ok).toBe(true);
    const w = Object.fromEntries(p.targets.map((t) => [t.name, t.weight]));
    expect(w.bad).toBe(0);
    expect(w.ep).toBeGreaterThan(0);
  });

  it('所有启用因子 ICIR 都 ≤ 0 → 不改权重(诚实,不凭空造)', () => {
    const p = icirWeightPlan(
      [{ name: 'ep' }, { name: 'bp' }],
      [],
      [
        { name: 'ep', icir: -0.1 },
        { name: 'bp', icir: 0 },
      ],
    );
    expect(p.ok).toBe(false);
    expect(p.note).toContain('ICIR');
  });

  it('禁用的因子 / 不在报告里的因子都跳过;自定义因子按 id 纳入', () => {
    const p = icirWeightPlan(
      [
        { name: 'ep', enabled: true },
        { name: 'bp', enabled: false }, // 禁用 → 跳过
        { name: 'roe', enabled: true }, // 不在报告 → 跳过
      ],
      [{ id: 'c1', name: 'myfac', enabled: true }],
      [
        { name: 'ep', icir: 0.4 },
        { name: 'bp', icir: 0.9 },
        { name: 'myfac', icir: 0.4 },
      ],
    );
    expect(p.ok).toBe(true);
    expect(p.targets.map((t) => t.name).sort()).toEqual(['ep', 'myfac']);
    const cust = p.targets.find((t) => t.kind === 'custom');
    expect(cust?.id).toBe('c1');
    // ep 与 myfac 同 ICIR → 同权,各 1.0
    expect(p.targets.every((t) => t.weight === 1)).toBe(true);
  });
});
