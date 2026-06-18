// 按 ICIR 自动定权的纯函数(给指标页用):用质检报告里每个因子的 ICIR 定权重。
// 质检面板已 ×direction(反向因子取负),所以正 ICIR = 真有稳定预测力 → w = max(ICIR,0);
// 归一到均值 1.0(对齐手动默认的全 1.0)。全 ≤0 或没报告 → 不改、如实说明,绝不硬凑(红线#3)。
// ⚠ 据历史 IC 定权非样本外,拿去回测重叠区间会偏乐观 —— 由调用方在 UI 如实提醒。

export interface BuiltinRow {
  name: string;
  enabled?: boolean;
}
export interface CustomRow {
  id: string;
  name: string;
  enabled?: boolean;
}
export interface ReportFactor {
  name: string;
  icir: number;
}
export interface WeightTarget {
  kind: 'builtin' | 'custom';
  name: string;
  id?: string;
  weight: number;
}
export interface WeightPlan {
  ok: boolean;
  targets: WeightTarget[];
  note?: string;
}

export function icirWeightPlan(
  builtin: BuiltinRow[],
  custom: CustomRow[],
  reportFactors: ReportFactor[] | null | undefined,
): WeightPlan {
  if (!reportFactors?.length) {
    return { ok: false, targets: [], note: '先跑一次因子质检 —— 自动定权要用质检算出的 ICIR' };
  }
  const icir = new Map(reportFactors.map((f) => [f.name, Number(f.icir) || 0]));
  // 只给「在质检报告里、且当前启用」的因子定权。
  const raw: Array<{ kind: 'builtin' | 'custom'; name: string; id?: string; pos: number }> = [];
  for (const f of builtin) {
    if (f.enabled === false || !icir.has(f.name)) continue;
    raw.push({ kind: 'builtin', name: f.name, pos: Math.max(0, icir.get(f.name) ?? 0) });
  }
  for (const c of custom) {
    if (!c.enabled || !icir.has(c.name)) continue;
    raw.push({ kind: 'custom', name: c.name, id: c.id, pos: Math.max(0, icir.get(c.name) ?? 0) });
  }
  if (!raw.length) {
    return { ok: false, targets: [], note: '质检报告里没有当前启用的因子,无从定权' };
  }
  const sum = raw.reduce((s, t) => s + t.pos, 0);
  if (sum <= 0) {
    return {
      ok: false,
      targets: [],
      note: '所有启用因子在这段区间 ICIR 都 ≤ 0(没有稳定预测力),没改权重 —— 不给你硬凑',
    };
  }
  const scale = raw.length / sum; // 归一:权重和 = 因子数,均值 1.0
  return {
    ok: true,
    targets: raw.map((t) => ({
      kind: t.kind,
      name: t.name,
      id: t.id,
      weight: Math.round(t.pos * scale * 100) / 100,
    })),
  };
}
