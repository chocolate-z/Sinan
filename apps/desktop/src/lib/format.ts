/** 数字/百分比格式化(迁移自设计稿 ui.jsx)。数字一律配等宽 .mono 使用。 */
export function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}
export function fmtInt(n: number | null | undefined): string {
  return n == null ? '—' : Number(n).toLocaleString('en-US');
}
/** n 为「百分数值」(如 1.82 表示 +1.82%)。 */
export function fmtPct(n: number | null | undefined, dec = 2, sign = true): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = sign && n > 0 ? '+' : '';
  return s + Number(n).toFixed(dec) + '%';
}
export function fmtSigned(n: number | null | undefined, dec = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = n > 0 ? '+' : '';
  return s + fmt(n, dec);
}
