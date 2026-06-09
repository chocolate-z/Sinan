import {
  EngineError,
  type BacktestRequest,
  type CacheBuildRequest,
  type EngineClient,
  type PaperRunRequest,
  type PricesRequest,
  type PricesResult,
  type ProviderTestResult,
  type Quote,
  type TrainRequest,
} from '../src/engine/engine.client.js';

/** 离线假 engine 客户端:连通测试返回固定结果,建缓存按预设事件回放。 */
export class FakeEngineClient implements EngineClient {
  constructor(
    private readonly testResult: ProviderTestResult | null,
    private readonly events: any[] = [],
    private readonly paperResult: any = null,
    private readonly quotesResult: Record<string, Quote> = {},
    private readonly pricesResult: Record<string, PricesResult> = {},
    private readonly backtestResult: any = null,
    private readonly trainResult: any = null,
  ) {}

  async train(req: TrainRequest): Promise<any> {
    // 测试守卫转发:trainResult 形如 {__error:{status,detail}} → 抛 EngineError。
    if (this.trainResult && this.trainResult.__error) {
      throw new EngineError(this.trainResult.__error.status, this.trainResult.__error.detail);
    }
    return (
      this.trainResult ?? {
        model_type: req.model_type ?? 'elasticnet',
        train_start: req.train_start,
        train_end: req.train_end,
        label_horizon: req.label_horizon ?? 5,
        purge: req.purge ?? req.label_horizon ?? 5,
        embargo: req.embargo ?? 0,
        n_folds: 3,
        n_samples: 360,
        feature_cols: ['f_ep', 'f_bp', 'f_roe', 'f_mom20'],
        ic_is: 0.12,
        ic_oos: 0.08,
        icir_is: 0.9,
        icir_oos: 0.6,
        layered_sharpe_oos: 0.7,
        layered_annual_return_oos: 0.05,
        top_quantile: 0.2,
        feature_importance: [{ feature: 'f_mom20', weight: 0.6 }],
        fold_metrics: [{ index: 0, n_train: 120, n_test: 60, ic_oos: 0.08 }],
        model: { type: 'elasticnet', feature_cols: ['f_mom20'], coef: [0.1], intercept: 0.0 },
        degraded: [],
        oos_clean: true,
        metrics_note: '分层口径,非完整回测',
      }
    );
  }

  async backtest(req: BacktestRequest): Promise<any> {
    // 测试守卫转发:backtestResult 形如 {__error:{status,detail}} → 抛 EngineError。
    if (this.backtestResult && this.backtestResult.__error) {
      throw new EngineError(this.backtestResult.__error.status, this.backtestResult.__error.detail);
    }
    return (
      this.backtestResult ?? {
        backtest_start: req.backtest_start,
        backtest_end: req.backtest_end,
        train_end: req.train_end,
        purge: req.purge ?? 5,
        benchmark: req.benchmark ?? '000300.SH',
        initial_cash: req.initial_cash ?? 1_000_000,
        n_days: 2,
        n_trades: 1,
        total_cost: 12.3,
        cost_included: true,
        nav_curve: [{ date: req.backtest_start, nav: 1_000_000, benchmark: 1_000_000 }],
        metrics: { annual_return: 0.1 },
        degraded: [],
      }
    );
  }

  async quotes(codes: string[]): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    for (const c of codes) if (this.quotesResult[c]) out[c] = this.quotesResult[c];
    return out;
  }

  async prices(req: PricesRequest): Promise<PricesResult> {
    return (
      this.pricesResult[req.code] ?? {
        code: req.code,
        adjust: req.adjust ?? 'qfq',
        rows: [],
        degraded: false,
      }
    );
  }

  async providerTest(): Promise<ProviderTestResult> {
    return this.testResult ?? { status: 'ok', caps: {}, degraded: [] };
  }

  async cacheBuild(req: CacheBuildRequest, onEvent: (ev: any) => void): Promise<void> {
    for (const ev of this.events) onEvent({ ...ev, job_id: req.job_id });
  }

  async paperRun(req: PaperRunRequest): Promise<any> {
    return (
      this.paperResult ?? {
        trade_date: req.today,
        effective_date: req.effective_date,
        market_open: true,
        coverage: 1.0,
        degraded: [],
        benchmark_pct: 0.001,
        signals: [],
        trades: [],
        positions: [],
        account: {
          cash: req.account.cash,
          market_value: 0,
          nav: req.account.cash,
          daily_return: null,
          drawdown: 0,
        },
      }
    );
  }
}
