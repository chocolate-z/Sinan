/** 盘后调度纯逻辑(本地时间,工作日)。节假日表缺失时降级为「仅排除周末」(沿用原型策略)。 */

export function isWeekday(d: Date): boolean {
  const g = d.getDay();
  return g >= 1 && g <= 5; // 1=周一 … 5=周五
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 信号所属交易日:当前日期(调用方应在交易日盘后触发)。 */
export function tradeDateOf(d: Date): string {
  return isoDate(d);
}

/** 信号生效日(T+1):严格晚于 from 的下一个工作日。 */
export function nextTradeDate(from: Date): string {
  const d = new Date(from);
  do {
    d.setDate(d.getDate() + 1);
  } while (!isWeekday(d));
  return isoDate(d);
}

/** 下一次运行时刻:从 now 起、严格在未来、且落在工作日的 hh:mm。 */
export function nextRunAt(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  while (t <= now || !isWeekday(t)) {
    t.setDate(t.getDate() + 1);
    t.setHours(h, m, 0, 0);
  }
  return t;
}

/** now → 距下次运行的毫秒数(钳到 [1, 2^31-1] 以适配 setTimeout)。 */
export function msUntilNextRun(now: Date, hhmm: string): number {
  const delta = nextRunAt(now, hhmm).getTime() - now.getTime();
  return Math.min(Math.max(delta, 1), 2 ** 31 - 1);
}
