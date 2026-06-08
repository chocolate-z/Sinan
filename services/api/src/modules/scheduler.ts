/** 盘后自动调度:工作日 daily_run_time 触发模拟盘一轮。逻辑在 api(不依赖前端在线)。
 * 用自管定时器(unref,不阻塞进程/测试退出),按 settings 热重排;幂等靠唯一约束。 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { PaperService } from './trading.js';
import { isWeekday, msUntilNextRun, nextTradeDate, tradeDateOf } from '../lib/schedule.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repo: Repository,
    private readonly paper: PaperService,
  ) {}

  onModuleInit(): void {
    if (process.env.SINAN_DISABLE_SCHEDULER === '1') return;
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private runTime(): string {
    return (this.repo.settingGet('daily_run_time') as string) ?? '15:30';
  }

  /** (重新)排定下一次触发。设置变更(daily_run_time / auto_signal)后调用。 */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const ms = msUntilNextRun(new Date(), this.runTime());
    this.timer = setTimeout(() => {
      void this.runDaily().finally(() => this.schedule());
    }, ms);
    // 不让定时器单独把进程/测试拖住存活;真实运行由 HTTP server 维持事件循环。
    this.timer.unref?.();
  }

  reschedule(): void {
    this.schedule();
  }

  /** 盘后主流程:auto_signal 关 / 非交易日则跳过;否则对默认策略跑一轮(T → T+1)。 */
  async runDaily(now: Date = new Date()): Promise<{ ran: boolean; skipped?: string }> {
    if (this.repo.settingGet('auto_signal') === false)
      return { ran: false, skipped: 'auto_signal off' };
    if (!isWeekday(now)) return { ran: false, skipped: 'not a weekday' };
    const today = tradeDateOf(now);
    const effective = nextTradeDate(now);
    try {
      await this.paper.run({ today, effective_date: effective });
      this.repo.logInsert({
        level: 'info',
        source: 'scheduler',
        message: `盘后自动跑一轮 ${today} → 生效 ${effective}`,
      });
      return { ran: true };
    } catch (e) {
      this.repo.logInsert({ level: 'error', source: 'scheduler', message: `盘后自动失败:${e}` });
      return { ran: false, skipped: String(e) };
    }
  }
}
