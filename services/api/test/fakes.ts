import type {
  CacheBuildRequest,
  EngineClient,
  PaperRunRequest,
  PricesRequest,
  PricesResult,
  ProviderTestResult,
  Quote,
} from '../src/engine/engine.client.js';

/** 离线假 engine 客户端:连通测试返回固定结果,建缓存按预设事件回放。 */
export class FakeEngineClient implements EngineClient {
  constructor(
    private readonly testResult: ProviderTestResult | null,
    private readonly events: any[] = [],
    private readonly paperResult: any = null,
    private readonly quotesResult: Record<string, Quote> = {},
    private readonly pricesResult: Record<string, PricesResult> = {},
  ) {}

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
