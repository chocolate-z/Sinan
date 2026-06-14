/** 单一写者仓储:所有 SQLite 读写经此。engine 只读、绝不写(红线#6)。 */
import { randomUUID } from 'node:crypto';
import { ONBOARDING_STEPS } from '@sinan/shared-contracts';
import type { Db } from './sqlite.js';
import type { LogBus } from '../bus/log-bus.js';

const now = () => new Date().toISOString();
const FIRST_STEP = ONBOARDING_STEPS[0];
const LAST_STEP = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];

export interface JobRow {
  id: string;
  type: string;
  provider: string | null;
  status: string;
  trigger: string;
  params_json: string | null;
  total: number;
  done_count: number;
  failed_count: number;
  cursor_json: string | null;
  progress: number;
  rate_limit_json: string | null;
  lineage_json: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export class Repository {
  constructor(
    private readonly db: Db,
    private readonly logBus?: LogBus,
  ) {}

  // ── settings ──────────────────────────────────────────────────────────
  settingGet(key: string): unknown {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    return row ? JSON.parse(row.value) : undefined;
  }

  settingsAll(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.all<{ key: string; value: string }>('SELECT key,value FROM settings')) {
      out[r.key] = JSON.parse(r.value);
    }
    return out;
  }

  settingPut(key: string, value: unknown, scope = 'app'): void {
    this.db.run(
      `INSERT INTO settings(key,value,scope,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, scope=excluded.scope, updated_at=excluded.updated_at`,
      key,
      JSON.stringify(value),
      scope,
      now(),
    );
  }

  // ── onboarding(存于 settings)─────────────────────────────────────────
  onboardingState(): { done: boolean; step: string; active_provider?: string } {
    return {
      done: Boolean(this.settingGet('onboarding.done')),
      step: (this.settingGet('onboarding.step') as string) ?? FIRST_STEP,
      active_provider: this.settingGet('active_provider') as string | undefined,
    };
  }

  setOnboardingStep(step: string): void {
    this.settingPut('onboarding.step', step);
  }

  completeOnboarding(): void {
    this.db.tx(() => {
      this.settingPut('onboarding.done', true);
      this.settingPut('onboarding.step', LAST_STEP);
    });
  }

  // ── providers ─────────────────────────────────────────────────────────
  seedProviders(
    seed: Array<{ id: string; display_name: string; needs_token: boolean; priority: number }>,
  ): void {
    for (const p of seed) {
      this.db.run(
        `INSERT INTO providers(id,display_name,caps_json,needs_token,priority,status)
         VALUES (?,?,?,?,?, 'unknown')
         ON CONFLICT(id) DO NOTHING`,
        p.id,
        p.display_name,
        '{}',
        p.needs_token ? 1 : 0,
        p.priority,
      );
    }
  }

  providersList(): any[] {
    return this.db.all<any>('SELECT * FROM providers ORDER BY priority').map((r) => ({
      id: r.id,
      display_name: r.display_name,
      caps: JSON.parse(r.caps_json || '{}'),
      needs_token: Boolean(r.needs_token),
      rate_limit: r.rate_limit_json ? JSON.parse(r.rate_limit_json) : undefined,
      priority: r.priority,
      status: r.status,
      last_check_at: r.last_check_at ?? null,
    }));
  }

  setProviderStatus(id: string, status: string, caps?: Record<string, boolean>): void {
    this.db.run(
      'UPDATE providers SET status=?, caps_json=COALESCE(?,caps_json), last_check_at=? WHERE id=?',
      status,
      caps ? JSON.stringify(caps) : null,
      now(),
      id,
    );
  }

  setActiveProvider(provider: string): void {
    this.settingPut('active_provider', provider);
  }

  // ── credentials(红线:无明文/无 token 返回)──────────────────────────
  credentialUpsert(
    provider: string,
    keyRef: string,
    keyringRef: string | null,
    fingerprint: string,
  ): void {
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM credentials WHERE provider=?',
      provider,
    );
    const ts = now();
    if (existing) {
      this.db.run(
        'UPDATE credentials SET key_ref=?, keyring_ref=?, fingerprint=?, updated_at=? WHERE provider=?',
        keyRef,
        keyringRef,
        fingerprint,
        ts,
        provider,
      );
    } else {
      this.db.run(
        `INSERT INTO credentials(id,provider,key_ref,keyring_ref,fingerprint,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        randomUUID(),
        provider,
        keyRef,
        keyringRef,
        fingerprint,
        ts,
        ts,
      );
    }
  }

  credentialInfo(provider: string): { configured: boolean; fingerprint: string | null } {
    const row = this.db.get<{ fingerprint: string | null }>(
      'SELECT fingerprint FROM credentials WHERE provider=?',
      provider,
    );
    return { configured: Boolean(row), fingerprint: row?.fingerprint ?? null };
  }

  credentialDelete(provider: string): void {
    this.db.run('DELETE FROM credentials WHERE provider=?', provider);
  }

  // ── jobs ──────────────────────────────────────────────────────────────
  jobCreate(input: {
    type: string;
    provider?: string | null;
    trigger: string;
    params?: unknown;
  }): JobRow {
    const id = randomUUID();
    const ts = now();
    this.db.run(
      `INSERT INTO data_jobs(id,type,provider,status,trigger,params_json,created_at,updated_at)
       VALUES (?,?,?, 'queued', ?,?,?,?)`,
      id,
      input.type,
      input.provider ?? null,
      input.trigger,
      input.params ? JSON.stringify(input.params) : null,
      ts,
      ts,
    );
    return this.jobGet(id)!;
  }

  jobGet(id: string): JobRow | undefined {
    return this.db.get<JobRow>('SELECT * FROM data_jobs WHERE id=?', id);
  }

  jobsList(): JobRow[] {
    return this.db.all<JobRow>('SELECT * FROM data_jobs ORDER BY created_at DESC');
  }

  jobUpdate(
    id: string,
    patch: Partial<{
      status: string;
      total: number;
      done_count: number;
      failed_count: number;
      progress: number;
      cursor: unknown;
      rate_limit: unknown;
      error: string | null;
      started_at: string;
      finished_at: string;
    }>,
  ): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      status: 'status',
      total: 'total',
      done_count: 'done_count',
      failed_count: 'failed_count',
      progress: 'progress',
      error: 'error',
      started_at: 'started_at',
      finished_at: 'finished_at',
    };
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as any)[k];
      if (v !== undefined) {
        sets.push(`${col}=?`);
        vals.push(v);
      }
    }
    if (patch.cursor !== undefined) {
      sets.push('cursor_json=?');
      vals.push(patch.cursor === null ? null : JSON.stringify(patch.cursor));
    }
    if (patch.rate_limit !== undefined) {
      sets.push('rate_limit_json=?');
      vals.push(patch.rate_limit === null ? null : JSON.stringify(patch.rate_limit));
    }
    sets.push('updated_at=?');
    vals.push(now());
    vals.push(id);
    this.db.run(`UPDATE data_jobs SET ${sets.join(', ')} WHERE id=?`, ...vals);
  }

  jobToInfo(row: JobRow): any {
    return {
      id: row.id,
      type: row.type,
      provider: row.provider,
      status: row.status,
      trigger: row.trigger,
      total: row.total,
      done_count: row.done_count,
      failed_count: row.failed_count,
      progress: row.progress,
      cursor: row.cursor_json ? JSON.parse(row.cursor_json) : null,
      rate_limit: row.rate_limit_json ? JSON.parse(row.rate_limit_json) : null,
      error: row.error,
      started_at: row.started_at,
      finished_at: row.finished_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ── data_coverage(engine 回传结果由 api 落库)─────────────────────────
  coverageUpsert(
    rows: Array<{
      stock_code: string;
      dataset: string;
      provider: string;
      first_date: string | null;
      last_date: string | null;
      rows: number;
    }>,
  ): void {
    this.db.tx(() => {
      for (const r of rows) {
        this.db.run(
          `INSERT INTO data_coverage(stock_code,dataset,provider,first_date,last_date,rows,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(stock_code,dataset) DO UPDATE SET
             provider=excluded.provider, first_date=excluded.first_date,
             last_date=excluded.last_date, rows=excluded.rows, updated_at=excluded.updated_at`,
          r.stock_code,
          r.dataset,
          r.provider,
          r.first_date,
          r.last_date,
          r.rows,
          now(),
        );
      }
    });
  }

  coverageSummary(): any {
    const agg = this.db.get<{
      stock_count: number;
      first_date: string | null;
      last_date: string | null;
      total_rows: number;
    }>(
      `SELECT COUNT(DISTINCT stock_code) AS stock_count, MIN(first_date) AS first_date,
              MAX(last_date) AS last_date, COALESCE(SUM(rows),0) AS total_rows FROM data_coverage`,
    );
    return {
      stock_count: agg?.stock_count ?? 0,
      first_date: agg?.first_date ?? null,
      last_date: agg?.last_date ?? null,
      total_rows: agg?.total_rows ?? 0,
    };
  }

  // ── logs ──────────────────────────────────────────────────────────────
  /** 滚动清理计数:训练/质检 SSE 会写大量日志,累计若干条触发一次裁剪(防 logs 表无界增长)。 */
  private logsSinceTrim = 0;

  logInsert(entry: {
    level: string;
    source?: string;
    job_id?: string;
    message: string;
    context?: unknown;
  }): void {
    const id = randomUUID();
    const ts = now();
    this.db.run(
      'INSERT INTO logs(id,ts,level,source,job_id,message,context_json) VALUES (?,?,?,?,?,?,?)',
      id,
      ts,
      entry.level,
      entry.source ?? null,
      entry.job_id ?? null,
      entry.message,
      entry.context ? JSON.stringify(entry.context) : null,
    );
    // 实时推送到日志总线(SSE /logs/stream)。
    this.logBus?.emit({
      id,
      ts,
      level: entry.level,
      source: entry.source ?? null,
      job_id: entry.job_id ?? null,
      message: entry.message,
    });
    // 滚动清理:每 500 条裁剪一次,只保留最近 5000 条(评审项:logs 表无界增长)。
    if (++this.logsSinceTrim >= 500) {
      this.logsSinceTrim = 0;
      this.db.run(
        'DELETE FROM logs WHERE rowid NOT IN (SELECT rowid FROM logs ORDER BY ts DESC LIMIT ?)',
        5000,
      );
    }
  }

  logsList(limit = 200): any[] {
    return this.db.all<any>('SELECT * FROM logs ORDER BY ts DESC LIMIT ?', limit);
  }

  // ── strategies ──────────────────────────────────────────────────────────
  ensureDefaultStrategy(): string {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM strategies WHERE name = '默认因子策略'",
    );
    if (row) return row.id;
    const id = randomUUID();
    const ts = now();
    this.db.run(
      `INSERT INTO strategies(id,name,kind,params_json,status,created_at,updated_at)
       VALUES (?,?, 'factor_score', ?, 'active', ?, ?)`,
      id,
      '默认因子策略',
      JSON.stringify({ initial_cash: 1_000_000 }),
      ts,
      ts,
    );
    return id;
  }

  strategyParams(id: string): any {
    const row = this.db.get<{ params_json: string }>(
      'SELECT params_json FROM strategies WHERE id=?',
      id,
    );
    return row ? JSON.parse(row.params_json) : {};
  }

  /** 给 engine 的模型账户快照(现金/持仓/上一净值)。 */
  modelAccountSnapshot(strategyId: string): {
    cash: number;
    positions: any[];
    prev_nav: number | null;
    peak_nav: number | null;
  } {
    const last = this.db.get<{ cash: number; nav: number }>(
      'SELECT cash,nav FROM sim_account WHERE strategy_id=? ORDER BY trade_date DESC LIMIT 1',
      strategyId,
    );
    const peak = this.db.get<{ m: number | null }>(
      'SELECT MAX(nav) AS m FROM sim_account WHERE strategy_id=?',
      strategyId,
    );
    const holds = this.db.all<any>(
      'SELECT stock_code,shares,avg_cost,buy_date,last_buy_date FROM holdings_model WHERE strategy_id=?',
      strategyId,
    );
    const initial = this.strategyParams(strategyId)?.initial_cash ?? 1_000_000;
    return {
      cash: last?.cash ?? initial,
      positions: holds.map((h) => ({
        code: h.stock_code,
        shares: h.shares,
        avg_cost: h.avg_cost,
        open_date: h.buy_date,
        last_buy_date: h.last_buy_date ?? h.buy_date,
      })),
      prev_nav: last?.nav ?? null,
      peak_nav: peak?.m ?? null,
    };
  }

  /** engine 回传结果落库(仅模型盘)。signals 含被拦截组;trades 含成本明细;holdings 全量替换。 */
  persistPaperResult(
    strategyId: string,
    result: any,
    opts: { persistTrades?: boolean } = {},
  ): void {
    const ts = now();
    const tradeDate: string = result.trade_date;
    const persistTrades = opts.persistTrades !== false;
    this.db.tx(() => {
      for (const s of result.signals ?? []) {
        this.db.run(
          `INSERT INTO signals(id,strategy_id,trade_date,stock_code,action,score,factor_breakdown_json,reason,blocked,effective_date,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(strategy_id,trade_date,stock_code) DO UPDATE SET
             action=excluded.action, score=excluded.score, factor_breakdown_json=excluded.factor_breakdown_json,
             reason=excluded.reason, blocked=excluded.blocked, effective_date=excluded.effective_date`,
          randomUUID(),
          strategyId,
          tradeDate,
          s.stock_code,
          s.action,
          s.score ?? null,
          s.factor_breakdown ? JSON.stringify(s.factor_breakdown) : null,
          s.reason ?? null,
          s.blocked ? 1 : 0,
          result.effective_date ?? null,
          ts,
        );
      }
      if (persistTrades) {
        for (const t of result.trades ?? []) {
          this.db.run(
            `INSERT INTO trades(id,portfolio,strategy_id,stock_code,side,shares,price,amount,commission,stamp_tax,transfer_fee,impact,reason,trade_date,created_at)
             VALUES (?, 'model', ?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            randomUUID(),
            strategyId,
            t.code,
            t.side,
            t.shares,
            t.price,
            t.amount,
            t.commission ?? 0,
            t.stamp_tax ?? 0,
            t.transfer_fee ?? 0,
            t.impact ?? 0,
            t.reason ?? 'signal',
            t.trade_date ?? result.effective_date,
            ts,
          );
        }
        // 持仓全量替换(模型盘自动维护)。
        this.db.run('DELETE FROM holdings_model WHERE strategy_id=?', strategyId);
        for (const p of result.positions ?? []) {
          this.db.run(
            `INSERT INTO holdings_model(id,strategy_id,stock_code,shares,avg_cost,buy_date,last_buy_date,updated_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            randomUUID(),
            strategyId,
            p.code,
            p.shares,
            p.avg_cost,
            p.open_date,
            p.last_buy_date ?? p.open_date,
            ts,
          );
        }
        const a = result.account ?? {};
        this.db.run(
          `INSERT INTO sim_account(strategy_id,trade_date,cash,market_value,nav,daily_return,drawdown)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(strategy_id,trade_date) DO UPDATE SET
             cash=excluded.cash, market_value=excluded.market_value, nav=excluded.nav,
             daily_return=excluded.daily_return, drawdown=excluded.drawdown`,
          strategyId,
          tradeDate,
          a.cash ?? 0,
          a.market_value ?? 0,
          a.nav ?? 0,
          a.daily_return ?? null,
          a.drawdown ?? null,
        );
        const dr: number | null = a.daily_return ?? null;
        const nav: number = a.nav ?? 0;
        const dayPnl = dr != null && dr !== -1 ? nav - nav / (1 + dr) : 0;
        const benchPct: number | null = result.benchmark_pct ?? null;
        const excess = dr != null && benchPct != null ? dr - benchPct : null;
        this.db.run(
          `INSERT INTO daily_pnl(id,portfolio,strategy_id,trade_date,total_assets,cash,holding_value,day_pnl,day_pnl_pct,drawdown,benchmark_pct,excess_pct,degraded,created_at)
           VALUES (?, 'model', ?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(portfolio,strategy_id,trade_date) DO UPDATE SET
             total_assets=excluded.total_assets, cash=excluded.cash, holding_value=excluded.holding_value,
             day_pnl=excluded.day_pnl, day_pnl_pct=excluded.day_pnl_pct, drawdown=excluded.drawdown,
             benchmark_pct=excluded.benchmark_pct, excess_pct=excluded.excess_pct, degraded=excluded.degraded`,
          randomUUID(),
          strategyId,
          tradeDate,
          nav,
          a.cash ?? 0,
          a.market_value ?? 0,
          dayPnl,
          dr ?? 0,
          a.drawdown ?? null,
          benchPct,
          excess,
          (result.degraded?.length ?? 0) > 0 ? 1 : 0,
          ts,
        );
      }
    });
  }

  signalsByDate(date: string): any[] {
    return this.db
      .all<any>('SELECT * FROM signals WHERE trade_date=? ORDER BY blocked ASC, score DESC', date)
      .map((s) => ({
        ...s,
        factor_breakdown: s.factor_breakdown_json ? JSON.parse(s.factor_breakdown_json) : null,
      }));
  }

  modelHoldings(): any[] {
    return this.db.all<any>('SELECT * FROM holdings_model ORDER BY stock_code');
  }

  tradesList(portfolio: string, from?: string, to?: string): any[] {
    const where: string[] = ['portfolio=?'];
    const vals: unknown[] = [portfolio];
    if (from) {
      where.push('trade_date>=?');
      vals.push(from);
    }
    if (to) {
      where.push('trade_date<=?');
      vals.push(to);
    }
    return this.db.all<any>(
      `SELECT * FROM trades WHERE ${where.join(' AND ')} ORDER BY trade_date DESC, created_at DESC`,
      ...vals,
    );
  }

  pnlDaily(portfolio: string, strategyId?: string): any[] {
    if (strategyId !== undefined) {
      return this.db.all<any>(
        'SELECT * FROM daily_pnl WHERE portfolio=? AND strategy_id=? ORDER BY trade_date',
        portfolio,
        strategyId,
      );
    }
    return this.db.all<any>(
      'SELECT * FROM daily_pnl WHERE portfolio=? ORDER BY trade_date',
      portfolio,
    );
  }

  /** 某账本的持仓(给实时当日收益用)。portfolio 由调用方校验。 */
  holdingsFor(
    portfolio: string,
  ): Array<{ stock_code: string; shares: number; avg_cost: number; stock_name?: string | null }> {
    const table = portfolio === 'personal' ? 'holdings_personal' : 'holdings_model';
    return this.db.all<any>(`SELECT stock_code, shares, avg_cost, stock_name FROM ${table}`);
  }

  // ── 个人持仓(手动维护)──────────────────────────────────────────────
  personalList(): any[] {
    return this.db.all<any>('SELECT * FROM holdings_personal ORDER BY stock_code');
  }

  personalUpsert(input: {
    stock_code: string;
    stock_name?: string;
    shares: number;
    avg_cost: number;
    note?: string;
  }): void {
    const ts = now();
    this.db.run(
      `INSERT INTO holdings_personal(id,stock_code,stock_name,shares,avg_cost,buy_date,note,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(stock_code) DO UPDATE SET
         stock_name=excluded.stock_name, shares=excluded.shares, avg_cost=excluded.avg_cost,
         note=excluded.note, updated_at=excluded.updated_at`,
      randomUUID(),
      input.stock_code,
      input.stock_name ?? null,
      input.shares,
      input.avg_cost,
      ts.slice(0, 10),
      input.note ?? null,
      ts,
    );
  }

  personalDelete(code: string): void {
    this.db.run('DELETE FROM holdings_personal WHERE stock_code=?', code);
  }

  /** 加/减/建仓(移动加权成本)。
   * - add:有现有 → 新均价 = (旧股数×旧均价 + 加仓股数×加仓价)/总股数;无现有 → 以 price 建仓。
   * - reduce:减股数(均价不变);减到 ≤0 自动清仓(删除)。
   * - set:直接以 price 为均价覆盖(兼容旧入口)。 */
  personalAdjust(input: {
    stock_code: string;
    stock_name?: string | null;
    shares: number;
    price: number;
    op: 'set' | 'add' | 'reduce';
    note?: string | null;
  }): void {
    const code = input.stock_code;
    const existing = this.db.get<{ shares: number; avg_cost: number; stock_name: string | null }>(
      'SELECT shares, avg_cost, stock_name FROM holdings_personal WHERE stock_code=?',
      code,
    );
    if (input.op === 'reduce') {
      if (!existing) return; // 无持仓可减
      const newShares = existing.shares - input.shares;
      if (newShares <= 0) {
        this.personalDelete(code); // 减完清仓
        return;
      }
      this.db.run(
        'UPDATE holdings_personal SET shares=?, updated_at=? WHERE stock_code=?',
        newShares,
        now(),
        code,
      );
      return;
    }
    if (input.op === 'add' && existing) {
      const newShares = existing.shares + input.shares;
      const newCost =
        (existing.shares * existing.avg_cost + input.shares * input.price) / newShares;
      this.personalUpsert({
        stock_code: code,
        stock_name: input.stock_name ?? existing.stock_name ?? undefined,
        shares: newShares,
        avg_cost: newCost,
        note: input.note ?? undefined,
      });
      return;
    }
    // set,或 add 但无现有 → 以 price 为均价建仓
    this.personalUpsert({
      stock_code: code,
      stock_name: input.stock_name ?? undefined,
      shares: input.shares,
      avg_cost: input.price,
      note: input.note ?? undefined,
    });
  }

  // ── 回测(engine 计算,api 落库展示;红线#6:engine 不写 SQLite)─────────────
  insertBacktest(
    input: {
      strategy_id?: string | null;
      backtest_start: string;
      backtest_end: string;
      train_end: string;
      purge: number;
      benchmark: string;
      initial_cash: number;
      scoring?: string | null;
      model_id?: string | null;
    },
    result: {
      n_days: number;
      n_trades: number;
      total_cost: number;
      cost_included: boolean;
      metrics: unknown;
      nav_curve: unknown;
      trades?: unknown;
      degraded?: unknown;
    },
  ): string {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO backtests(id,strategy_id,backtest_start,backtest_end,train_end,purge,benchmark,
         initial_cash,scoring,model_id,n_days,n_trades,total_cost,cost_included,metrics_json,
         nav_curve_json,trades_json,degraded_json,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.strategy_id ?? null,
      input.backtest_start,
      input.backtest_end,
      input.train_end,
      input.purge,
      input.benchmark,
      input.initial_cash,
      input.scoring ?? null,
      input.model_id ?? null,
      result.n_days,
      result.n_trades,
      result.total_cost,
      result.cost_included ? 1 : 0,
      JSON.stringify(result.metrics ?? null),
      JSON.stringify(result.nav_curve ?? []),
      JSON.stringify(result.trades ?? []),
      JSON.stringify(result.degraded ?? []),
      'done',
      now(),
    );
    return id;
  }

  backtestsList(): any[] {
    return this.db
      .all<any>(
        `SELECT id,strategy_id,backtest_start,backtest_end,train_end,purge,benchmark,initial_cash,
           scoring,model_id,n_days,n_trades,total_cost,cost_included,metrics_json,status,created_at
         FROM backtests ORDER BY created_at DESC`,
      )
      .map((r) => ({
        ...r,
        cost_included: !!r.cost_included,
        metrics: r.metrics_json ? JSON.parse(r.metrics_json) : null,
        metrics_json: undefined,
      }));
  }

  backtestGet(id: string): any | null {
    const r = this.db.get<any>('SELECT * FROM backtests WHERE id=?', id);
    if (!r) return null;
    return {
      ...r,
      cost_included: !!r.cost_included,
      metrics: r.metrics_json ? JSON.parse(r.metrics_json) : null,
      nav_curve: r.nav_curve_json ? JSON.parse(r.nav_curve_json) : [],
      trades: r.trades_json ? JSON.parse(r.trades_json) : [],
      degraded: r.degraded_json ? JSON.parse(r.degraded_json) : [],
      metrics_json: undefined,
      nav_curve_json: undefined,
      trades_json: undefined,
      degraded_json: undefined,
    };
  }

  // ── 模型版本库(engine 训练,api 落库;红线#6:engine 不写 SQLite)─────────────
  insertModelVersion(
    input: { strategy_id?: string | null; name?: string | null },
    result: {
      model_type: string;
      train_start: string;
      train_end: string;
      label_horizon: number;
      purge: number;
      embargo: number;
      n_folds: number;
      n_samples: number;
      ic_is: number;
      ic_oos: number;
      icir_is: number;
      icir_oos: number;
      layered_sharpe_oos: number;
      layered_annual_return_oos: number;
      oos_clean: boolean;
      metrics_note?: string;
      feature_cols?: unknown;
      feature_importance?: unknown;
      fold_metrics?: unknown;
      model?: unknown;
      degraded?: unknown;
    },
  ): string {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO model_versions(id,strategy_id,name,model_type,status,train_start,train_end,
         label_horizon,purge,embargo,n_folds,n_samples,ic_is,ic_oos,icir_is,icir_oos,
         layered_sharpe_oos,layered_annual_return_oos,oos_clean,metrics_note,feature_cols_json,
         feature_importance_json,fold_metrics_json,model_json,degraded_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      input.strategy_id ?? null,
      input.name ?? null,
      result.model_type,
      'draft',
      result.train_start,
      result.train_end,
      result.label_horizon,
      result.purge,
      result.embargo,
      result.n_folds,
      result.n_samples,
      result.ic_is,
      result.ic_oos,
      result.icir_is,
      result.icir_oos,
      result.layered_sharpe_oos,
      result.layered_annual_return_oos,
      result.oos_clean ? 1 : 0,
      result.metrics_note ?? null,
      JSON.stringify(result.feature_cols ?? []),
      JSON.stringify(result.feature_importance ?? []),
      JSON.stringify(result.fold_metrics ?? []),
      JSON.stringify(result.model ?? null),
      JSON.stringify(result.degraded ?? []),
      now(),
    );
    return id;
  }

  modelVersionsList(): any[] {
    return this.db
      .all<any>(
        `SELECT id,strategy_id,name,model_type,status,train_start,train_end,label_horizon,
           purge,embargo,n_folds,n_samples,ic_is,ic_oos,icir_is,icir_oos,
           layered_sharpe_oos,layered_annual_return_oos,oos_clean,created_at
         FROM model_versions ORDER BY created_at DESC`,
      )
      .map((r) => ({ ...r, oos_clean: !!r.oos_clean }));
  }

  modelVersionGet(id: string): any | null {
    const r = this.db.get<any>('SELECT * FROM model_versions WHERE id=?', id);
    if (!r) return null;
    return {
      ...r,
      oos_clean: !!r.oos_clean,
      feature_cols: r.feature_cols_json ? JSON.parse(r.feature_cols_json) : [],
      feature_importance: r.feature_importance_json ? JSON.parse(r.feature_importance_json) : [],
      fold_metrics: r.fold_metrics_json ? JSON.parse(r.fold_metrics_json) : [],
      model: r.model_json ? JSON.parse(r.model_json) : null,
      degraded: r.degraded_json ? JSON.parse(r.degraded_json) : [],
      feature_cols_json: undefined,
      feature_importance_json: undefined,
      fold_metrics_json: undefined,
      model_json: undefined,
      degraded_json: undefined,
    };
  }

  // ── 自定义因子(M4 v3:DSL 定义,api 落库,engine 与内置并列计算;M4 权重:weight 合成加权)─────
  customFactorCreate(input: {
    name: string;
    expr: string;
    group?: string;
    weight?: number;
  }): string {
    const id = randomUUID();
    this.db.run(
      'INSERT INTO custom_factors(id,name,expr,factor_group,enabled,weight,created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      input.name,
      input.expr,
      input.group ?? 'custom',
      1,
      input.weight ?? 1.0,
      now(),
    );
    return id;
  }

  /** 部分更新自定义因子的合成权重 / 启用态(表达式不可改:改公式请删后重建,经沙箱校验)。 */
  customFactorUpdate(id: string, patch: { weight?: number; enabled?: boolean }): boolean {
    const before = this.db.get<any>('SELECT id FROM custom_factors WHERE id=?', id);
    if (!before) return false;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.weight !== undefined) {
      sets.push('weight=?');
      vals.push(patch.weight);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled=?');
      vals.push(patch.enabled ? 1 : 0);
    }
    if (!sets.length) return true; // 无字段变更:幂等成功
    vals.push(id);
    this.db.run(`UPDATE custom_factors SET ${sets.join(',')} WHERE id=?`, ...vals);
    return true;
  }

  customFactorsList(): any[] {
    return this.db
      .all<any>(
        'SELECT id,name,expr,factor_group,enabled,weight,created_at FROM custom_factors ORDER BY created_at DESC',
      )
      .map((r) => ({ ...r, enabled: !!r.enabled }));
  }

  /** 启用的自定义因子,形如 engine 期望的 [{name, expr, group, weight}](供质检/打分/回测下发)。 */
  customFactorsForQuality(): Array<{
    name: string;
    expr: string;
    group: string;
    weight: number;
  }> {
    return this.db
      .all<any>('SELECT name,expr,factor_group,weight FROM custom_factors WHERE enabled=1')
      .map((r) => ({ name: r.name, expr: r.expr, group: r.factor_group, weight: r.weight }));
  }

  customFactorDelete(id: string): boolean {
    const before = this.db.get<any>('SELECT id FROM custom_factors WHERE id=?', id);
    if (!before) return false;
    this.db.run('DELETE FROM custom_factors WHERE id=?', id);
    return true;
  }

  /** 当前激活(running)模型的系数 JSON,供「模型出信号」;无激活模型则 null(退回等权因子)。 */
  activeModel(): Record<string, unknown> | null {
    const r = this.db.get<any>(
      "SELECT model_json FROM model_versions WHERE status='running' ORDER BY created_at DESC LIMIT 1",
    );
    return r?.model_json ? JSON.parse(r.model_json) : null;
  }

  /** 激活模型的系数 + 训练截止 + 版本 id,供回测(口径与实盘一致 + 红线#2 诚实样本外守卫)。
   * train_end 用于把回测 train_end 抬到不早于训练截止,确保回测绝不踩进该模型的训练窗口。 */
  activeModelMeta(): { id: string; train_end: string; model: Record<string, unknown> } | null {
    const r = this.db.get<any>(
      "SELECT id,train_end,model_json FROM model_versions WHERE status='running' ORDER BY created_at DESC LIMIT 1",
    );
    if (!r?.model_json) return null;
    return { id: r.id, train_end: r.train_end, model: JSON.parse(r.model_json) };
  }

  /** 指定模型版本的系数 + 训练截止(供「先回测再激活」:回测任一 draft/archived 版本)。 */
  modelVersionForBacktest(
    id: string,
  ): { id: string; train_end: string; model: Record<string, unknown> } | null {
    const r = this.db.get<any>('SELECT id,train_end,model_json FROM model_versions WHERE id=?', id);
    if (!r) return null;
    return {
      id: r.id,
      train_end: r.train_end,
      model: r.model_json ? JSON.parse(r.model_json) : {},
    };
  }

  /** 激活某模型版本:置为 running,其余 running 降级 archived;若挂策略则回写 active_model_id。 */
  modelVersionActivate(id: string): any | null {
    const target = this.db.get<any>('SELECT id, strategy_id FROM model_versions WHERE id=?', id);
    if (!target) return null;
    this.db.tx(() => {
      this.db.run("UPDATE model_versions SET status='archived' WHERE status='running'");
      this.db.run("UPDATE model_versions SET status='running' WHERE id=?", id);
      if (target.strategy_id) {
        this.db.run('UPDATE strategies SET active_model_id=? WHERE id=?', id, target.strategy_id);
      }
    });
    return this.modelVersionGet(id);
  }
}
