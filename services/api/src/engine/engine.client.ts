/** engine 客户端:api→engine 内部调用(X-Sinan-Internal)。前端永不直连 engine(红线#6)。 */
import { Injectable } from '@nestjs/common';
import * as config from '../config.js';

export interface ProviderTestResult {
  status: string;
  latency_ms?: number | null;
  caps: Record<string, boolean>;
  rate_limit?: { per_min: number; concurrency?: number };
  points_hint?: number | null;
  degraded: string[];
  message?: string | null;
}

export interface CacheBuildRequest {
  job_id: string;
  params: Record<string, unknown>;
  tokens: Record<string, string>;
  cursor?: Record<string, unknown> | null;
  end_date?: string | null;
}

export interface PaperRunRequest {
  strategy_id: string;
  today: string;
  effective_date: string;
  codes?: string[];
  account: { cash: number; positions: any[] };
  params?: Record<string, unknown>;
  prev_nav?: number | null;
  peak_nav?: number | null;
  benchmark?: string;
  fill?: boolean;
  model?: Record<string, unknown> | null; // 激活的 ML 模型系数;在场则模型打分(M3)
}

export interface Quote {
  name?: string | null;
  price?: number | null;
  prev_close?: number | null;
  open?: number | null;
  source?: string | null;
}

export interface KBar {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  amount?: number | null;
}

export interface PricesRequest {
  code: string;
  start?: string;
  end?: string;
  limit?: number;
  adjust?: 'qfq' | 'none';
}

export interface PricesResult {
  code: string;
  adjust: string;
  rows: KBar[];
  degraded: boolean;
}

export interface BacktestRequest {
  backtest_start: string;
  backtest_end: string;
  train_end: string;
  codes?: string[];
  benchmark?: string;
  purge?: number;
  params?: Record<string, unknown>;
  initial_cash?: number;
}

export interface TrainRequest {
  train_start: string;
  train_end: string;
  label_horizon?: number;
  purge?: number;
  embargo?: number;
  train_span?: number;
  test_span?: number;
  codes?: string[];
  model_type?: string;
  alpha?: number;
  l1_ratio?: number;
  top_quantile?: number;
  train_threads?: string;
  device?: string;
}

export interface FactorQualityRequest {
  start: string;
  end: string;
  label_horizon?: number;
  n_deciles?: number;
  codes?: string[];
}

/** engine 返回非 2xx 时抛出,携带状态码与 detail,供 api 决定转发何种 HTTP 错误。 */
export class EngineError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`engine error ${status}`);
  }
}

export interface EngineClient {
  providerTest(provider: string, token?: string): Promise<ProviderTestResult>;
  /** 连接 engine cache/build SSE,逐事件回调。完成时 resolve。 */
  cacheBuild(req: CacheBuildRequest, onEvent: (ev: any) => void): Promise<void>;
  /** 盘后:出信号 + 模拟盘撮合记账(engine 计算,api 落库)。 */
  paperRun(req: PaperRunRequest): Promise<any>;
  /** 实时报价(新浪→腾讯),供当日收益与行情页。 */
  quotes(codes: string[]): Promise<Record<string, Quote>>;
  /** 历史日 K(本地 parquet,PIT 安全),供行情页 KLineChart。 */
  prices(req: PricesRequest): Promise<PricesResult>;
  /** 回测(逐日撮合 + 硬守卫 + 含成本)。守卫违反抛 EngineError(422)。 */
  backtest(req: BacktestRequest): Promise<any>;
  /** 训练(walk-forward + 样本内外 IC)。purge<label_horizon 抛 EngineError(422)。 */
  train(req: TrainRequest): Promise<any>;
  /** 因子质检(真实 IC/ICIR/覆盖度 + IC 时序 + 十分位分层)。无缓存/区间过短抛 EngineError(400)。 */
  factorQuality(req: FactorQualityRequest): Promise<any>;
  /** 自定义因子 DSL 校验(白名单 + 回看算子,结构上防未来函数)。返回 ok/errors/fields/functions。 */
  indicatorsValidate(expr: string): Promise<any>;
}

export const ENGINE_CLIENT = Symbol('ENGINE_CLIENT');

@Injectable()
export class HttpEngineClient implements EngineClient {
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const tok = config.internalToken();
    if (tok) h['X-Sinan-Internal'] = tok;
    return h;
  }

  async providerTest(provider: string, token?: string): Promise<ProviderTestResult> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/provider/test`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ provider, token }),
    });
    if (!res.ok) throw new Error(`engine provider/test ${res.status}`);
    return (await res.json()) as ProviderTestResult;
  }

  async cacheBuild(req: CacheBuildRequest, onEvent: (ev: any) => void): Promise<void> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/cache/build`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.body) throw new Error(`engine cache/build ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }

  async paperRun(req: PaperRunRequest): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/paper/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`engine paper/run ${res.status}`);
    return res.json();
  }

  async quotes(codes: string[]): Promise<Record<string, Quote>> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/quotes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ codes }),
    });
    if (!res.ok) throw new Error(`engine quotes ${res.status}`);
    return (await res.json()) as Record<string, Quote>;
  }

  async prices(req: PricesRequest): Promise<PricesResult> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/prices`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`engine prices ${res.status}`);
    return (await res.json()) as PricesResult;
  }

  async backtest(req: BacktestRequest): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/backtest`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = ((await res.json()) as { detail?: unknown }).detail;
      } catch {
        detail = await res.text();
      }
      throw new EngineError(res.status, detail);
    }
    return res.json();
  }

  async train(req: TrainRequest): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/train`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = ((await res.json()) as { detail?: unknown }).detail;
      } catch {
        detail = await res.text();
      }
      throw new EngineError(res.status, detail);
    }
    return res.json();
  }

  async factorQuality(req: FactorQualityRequest): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/factors/quality`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = ((await res.json()) as { detail?: unknown }).detail;
      } catch {
        detail = await res.text();
      }
      throw new EngineError(res.status, detail);
    }
    return res.json();
  }

  async indicatorsValidate(expr: string): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/indicators/validate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ expr }),
    });
    if (!res.ok) throw new EngineError(res.status, await res.text());
    return res.json();
  }
}
