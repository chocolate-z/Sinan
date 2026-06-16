import {
  EngineError,
  type BacktestRequest,
  type CacheBuildRequest,
  type EngineClient,
  type FactorQualityRequest,
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
    private readonly qualityResult: any = null,
  ) {}

  async stocksSearch(
    provider: string,
    q: string,
    _token?: string,
    limit = 20,
  ): Promise<{ stocks: { code: string; name: string }[] }> {
    void provider;
    const all = [
      { code: '600519.SH', name: '贵州茅台' },
      { code: '000858.SZ', name: '五粮液' },
      { code: '600036.SH', name: '招商银行' },
    ];
    const ql = q.trim().toLowerCase();
    const hit = ql
      ? all.filter((s) => s.code.toLowerCase().includes(ql) || s.name.includes(q.trim()))
      : all;
    return { stocks: hit.slice(0, limit) };
  }

  async stockNames(
    _provider: string,
    _token?: string,
    codes?: string[],
  ): Promise<{ names: Record<string, string> }> {
    const all: Record<string, string> = {
      '600519.SH': '贵州茅台',
      '000858.SZ': '五粮液',
      '600036.SH': '招商银行',
    };
    if (!codes) return { names: all };
    const names: Record<string, string> = {};
    for (const c of codes) if (all[c]) names[c] = all[c];
    return { names };
  }

  async marketSnapshot(_provider: string, _token?: string, _sparkDays?: number): Promise<any> {
    return {
      asof: '2024-01-03',
      breadth: { total: 2, up: 1, down: 1, flat: 0, avg_chg: 0.0 },
      sectors: [
        {
          name: '银行',
          chg: 2.0,
          count: 1,
          up: 1,
          down: 0,
          lead: '招商银行',
          lead_chg: 2.0,
          spark: [1.0, 1.02],
        },
      ],
      spark_days: 20,
    };
  }

  async marketSector(_provider: string, industry: string, _token?: string): Promise<any> {
    return {
      industry,
      asof: '2024-01-03',
      constituents: [
        { stock_code: '600036.SH', name: '招商银行', price: 35.0, chg: 2.0, turnover: 1.2 },
      ],
    };
  }

  async marketLive(_provider: string, _token?: string, _sparkDays?: number): Promise<any> {
    return {
      asof: '2024-01-03 14:30:00',
      live: true,
      breadth: { total: 2, up: 2, down: 0, flat: 0, avg_chg: 1.5 },
      sectors: [
        {
          name: '银行',
          chg: 1.5,
          count: 2,
          up: 2,
          down: 0,
          lead: '招商银行',
          lead_chg: 2.0,
          spark: [1.0, 1.01],
        },
      ],
      spark_days: 20,
    };
  }

  async tdxValidate(src: string): Promise<any> {
    const bad = /-\s*\d/.test(src) && /REF/i.test(src); // 粗模拟:REF 负参 → 不合法
    return {
      ok: !bad,
      errors: bad ? ['负向引用会引入未来函数(红线#1),拒绝'] : [],
      outputs: bad ? [] : ['建仓'],
      temps: [],
      signals: bad ? [] : ['建仓'],
    };
  }

  async tdxScan(req: { src: string; signal?: string }): Promise<any> {
    return {
      asof: '2024-01-03',
      signal: req.signal ?? '建仓',
      outputs: ['建仓'],
      scanned: 2,
      hits: [{ stock_code: '600000.SH', date: '2024-01-03', value: true }],
    };
  }

  async tdxEvaluate(req: { code: string; src: string }): Promise<any> {
    return {
      code: req.code,
      asof: '2024-01-04',
      bars: [
        { trade_date: '2024-01-03', open: 9, high: 12, low: 8, close: 11, volume: 1 },
        { trade_date: '2024-01-04', open: 11, high: 11, low: 9, close: 10, volume: 1 },
      ],
      lines: { 线: [10, 10.5], 建仓: [true, false] },
      outputs: ['线', '建仓'],
      signal_outputs: ['建仓'],
    };
  }

  async indicatorsValidate(expr: string): Promise<any> {
    const banned = expr.includes('__');
    return {
      ok: !banned,
      errors: banned ? ['不安全表达式'] : [],
      lookahead_ok: null,
      fields: ['close', 'pe_ttm', 'roe', 'north_hold_ratio'],
      functions: ['zscore', 'rank', 'ma', 'delay', 'ts_std', 'rsi'],
    };
  }

  async factorQuality(req: FactorQualityRequest, onEvent?: (ev: any) => void): Promise<any> {
    // 回放几条 SSE 流式进度(供「确定式进度条 + ETA」路径测试):特征面板 → 逐因子。
    onEvent?.({ stage: 'features', done: 1, total: 2, date: req.start });
    onEvent?.({ stage: 'features', done: 2, total: 2, date: req.end });
    onEvent?.({ stage: 'scoring', n_factors: 1 });
    onEvent?.({ stage: 'factor', name: 'mom20' });
    if (this.qualityResult && this.qualityResult.__error) {
      throw new EngineError(this.qualityResult.__error.status, this.qualityResult.__error.detail);
    }
    return (
      this.qualityResult ?? {
        start: req.start,
        end: req.end,
        label_horizon: req.label_horizon ?? 5,
        n_dates: 100,
        n_codes: 6,
        factors: [
          {
            name: 'mom20',
            group: 'momentum',
            ic_mean: 0.061,
            icir: 0.52,
            coverage: 0.92,
            ic_series: [0.05, 0.07, 0.06],
            deciles: [-0.012, 0.001, 0.014],
          },
        ],
        degraded: ['north_chg5:100/100 天降级(数据缺失)'],
      }
    );
  }

  async train(req: TrainRequest, onEvent?: (ev: any) => void): Promise<any> {
    // 回放几条 SSE 流式进度(供「确定式进度条 + ETA」路径测试):特征面板 → 折。
    onEvent?.({ stage: 'features', done: 1, total: 2, date: req.train_start });
    onEvent?.({ stage: 'features', done: 2, total: 2, date: req.train_end });
    onEvent?.({ stage: 'folds', n_folds: 3 });
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

  /** 记录最近一次 backtest 请求,供测试断言下发了模型系数 / 自定义因子 / 诚实 train_end。 */
  lastBacktestReq: BacktestRequest | null = null;

  async backtest(req: BacktestRequest): Promise<any> {
    this.lastBacktestReq = req;
    // 测试守卫转发:backtestResult 形如 {__error:{status,detail}} → 抛 EngineError。
    if (this.backtestResult && this.backtestResult.__error) {
      throw new EngineError(this.backtestResult.__error.status, this.backtestResult.__error.detail);
    }
    return (
      this.backtestResult ?? {
        backtest_start: req.backtest_start,
        backtest_end: req.backtest_end,
        train_end: req.train_end, // 回显 api 传入的(可能被抬高的)诚实样本外边界
        purge: req.purge ?? 5,
        benchmark: req.benchmark ?? '000300.SH',
        initial_cash: req.initial_cash ?? 1_000_000,
        // 实际口径:与 engine run_backtest 同语义(model 优先,空 custom 退化等权)。
        scoring: req.model ? 'model' : req.custom && req.custom.length ? 'custom' : 'equal_weight',
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

  /** 记录最近一次 paper/run 请求,供测试断言「模型出信号」下发了激活模型系数。 */
  lastPaperReq: PaperRunRequest | null = null;

  async paperRun(req: PaperRunRequest): Promise<any> {
    this.lastPaperReq = req;
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
