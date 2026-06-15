/** engine 客户端:api→engine 内部调用(X-Sinan-Internal)。前端永不直连 engine(红线#6)。 */
import { Injectable } from '@nestjs/common';
import * as http from 'node:http';
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
  custom?: Array<{ name: string; expr: string; group?: string; weight?: number }>; // 启用的自定义因子(无模型时进等权,M4 v3;weight 合成加权)
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
  /** 样本外边界(开区间,不含该日);守卫拒跑 backtest_start ≤ train_end + purge 个交易日。ISO YYYY-MM-DD。 */
  train_end: string;
  codes?: string[];
  benchmark?: string;
  purge?: number;
  params?: Record<string, unknown>;
  initial_cash?: number;
  model?: Record<string, unknown> | null; // 激活/指定模型系数;在场则模型线性打分(口径与实盘一致)
  custom?: Array<{ name: string; expr: string; group?: string; weight?: number }>; // 启用的自定义因子(无模型时进等权;weight 合成加权)
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
  feature_workers?: number | null; // 特征面板多核数;省略/null → engine 'auto'(min(核-1,4));1=串行
}

export interface FactorQualityRequest {
  start: string;
  end: string;
  label_horizon?: number;
  n_deciles?: number;
  codes?: string[];
  custom?: Array<{ name: string; expr: string; group?: string; weight?: number }>; // 自定义 DSL 因子(M4 v3;weight 合成加权,质检忽略)
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

export interface StockHit {
  code: string;
  name: string;
}

export interface EngineClient {
  providerTest(provider: string, token?: string): Promise<ProviderTestResult>;
  /** 股票搜索(代码/名称补全)。无 token/网络不可达 → 空列表(诚实)。 */
  stocksSearch(
    provider: string,
    q: string,
    token?: string,
    limit?: number,
  ): Promise<{ stocks: StockHit[] }>;
  /** code→name 映射(信号/持仓展示用)。无 token/不可达 → {}(诚实)。 */
  stockNames(
    provider: string,
    token?: string,
    codes?: string[],
  ): Promise<{ names: Record<string, string> }>;
  /** 行情页全市场快照(全A广度 + 板块卡)。无缓存/无行业 → 诚实空。 */
  marketSnapshot(provider: string, token?: string, sparkDays?: number): Promise<any>;
  /** 行情页板块成分股。 */
  marketSector(provider: string, industry: string, token?: string): Promise<any>;
  /** 行情页实时快照(当日涨跌取自实时报价;盘后/源不可达 → engine 诚实回落收盘快照 live=false)。 */
  marketLive(provider: string, token?: string, sparkDays?: number): Promise<any>;
  /** 通达信公式静态校验(语法/白名单/无未来函数)。 */
  tdxValidate(src: string): Promise<any>;
  /** 通达信公式全市场检测扫描(asof 当日触发信号的股票)。无缓存 → 诚实空;非法 → EngineError 422。 */
  tdxScan(req: { src: string; asof?: string; signal?: string; codes?: string[] }): Promise<any>;
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
  /** 训练(walk-forward + 样本内外 IC)。SSE 流式:onEvent 收特征/逐折进度;purge<label_horizon 抛 EngineError(422)。 */
  train(req: TrainRequest, onEvent?: (ev: any) => void): Promise<any>;
  /** 因子质检(真实 IC/ICIR/覆盖度 + IC 时序 + 十分位分层)。SSE 流式:onEvent 收逐因子进度;无缓存/区间过短抛 EngineError(400)。 */
  factorQuality(req: FactorQualityRequest, onEvent?: (ev: any) => void): Promise<any>;
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

  /**
   * 长耗时计算(训练/回测/质检/盘后)走 node:http —— **绝不设超时**。
   * 全局 fetch(undici)默认 headersTimeout=300s:大区间训练(逐日特征面板)可达数分钟,
   * 到点即 `UND_ERR_HEADERS_TIMEOUT` → api 收到 fetch failed → 通用 500(引擎其实还在算)。
   * node:http 默认无响应超时,等到引擎算完为止。返回非 2xx 抛 EngineError(转发 status+detail)。
   */
  private slowPost(path: string, payload: unknown): Promise<unknown> {
    const data = JSON.stringify(payload ?? {});
    const u = new URL(`${config.engineBaseUrl()}${path}`);
    const headers = { ...this.headers(), 'content-length': String(Buffer.byteLength(data)) };
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: `${u.pathname}${u.search}`,
          method: 'POST',
          headers,
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              let detail: unknown;
              try {
                detail = (JSON.parse(buf) as { detail?: unknown }).detail;
              } catch {
                detail = buf;
              }
              reject(new EngineError(status, detail));
              return;
            }
            try {
              resolve(buf ? JSON.parse(buf) : null);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      // 故意不调 req.setTimeout —— 长计算不应被杀。
      req.write(data);
      req.end();
    });
  }

  /**
   * 长耗时计算的 **SSE 流式** 版(训练/质检)——同样走 node:http 绝不设超时。
   * 引擎逐进度吐 `data: {...}\n\n`:进度事件回调给 onEvent;末尾 `{stage:'done', result}` resolve;
   * `{stage:'error', status, detail}` → EngineError(转发 422/400)。
   * 相比一次性 slowPost:① 持续数据流保活长连接,根治 4 小时空闲被对端重置(ECONNRESET);
   * ② 进度可观测(api 据此写统一日志)。预检失败(非 2xx,如无缓存 400)按普通错误读 body 抛 EngineError。
   */
  private slowPostStream(
    path: string,
    payload: unknown,
    onEvent?: (ev: any) => void,
  ): Promise<unknown> {
    const data = JSON.stringify(payload ?? {});
    const u = new URL(`${config.engineBaseUrl()}${path}`);
    const headers = { ...this.headers(), 'content-length': String(Buffer.byteLength(data)) };
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: `${u.pathname}${u.search}`,
          method: 'POST',
          headers,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          res.setEncoding('utf8');
          // 预检失败:开流前抛的非 2xx(如本地无缓存 400)。读 body → EngineError,语义同 slowPost。
          if (status < 200 || status >= 300) {
            let buf = '';
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
              let detail: unknown;
              try {
                detail = (JSON.parse(buf) as { detail?: unknown }).detail;
              } catch {
                detail = buf;
              }
              reject(new EngineError(status, detail));
            });
            return;
          }
          // 2xx → SSE:逐 `data:` 块解析。
          let buf = '';
          let settled = false;
          let finalResult: unknown = undefined;
          let gotDone = false;
          res.on('data', (chunk) => {
            buf += chunk;
            let nl: number;
            while ((nl = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, nl);
              buf = buf.slice(nl + 2);
              const line = block.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              let ev: any;
              try {
                ev = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              if (ev?.stage === 'error') {
                settled = true;
                req.destroy();
                reject(new EngineError(typeof ev.status === 'number' ? ev.status : 500, ev.detail));
                return;
              }
              if (ev?.stage === 'done') {
                gotDone = true;
                finalResult = ev.result;
                continue;
              }
              if (onEvent) {
                try {
                  onEvent(ev);
                } catch {
                  /* 进度回调异常绝不影响主流程 */
                }
              }
            }
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            if (gotDone) resolve(finalResult);
            // 流意外中断却没收到 done/error(对端重置/进程死)→ 诚实报错,不静默当成功。
            else reject(new Error('engine stream ended without a result'));
          });
          res.on('error', (e) => {
            if (settled) return;
            settled = true;
            reject(e);
          });
        },
      );
      req.on('error', reject);
      // 故意不调 req.setTimeout —— 长计算不应被杀。
      req.write(data);
      req.end();
    });
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

  async stocksSearch(
    provider: string,
    q: string,
    token?: string,
    limit = 20,
  ): Promise<{ stocks: StockHit[] }> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/stocks/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ provider, token, q, limit }),
    });
    if (!res.ok) throw new Error(`engine stocks/search ${res.status}`);
    return (await res.json()) as { stocks: StockHit[] };
  }

  async stockNames(
    provider: string,
    token?: string,
    codes?: string[],
  ): Promise<{ names: Record<string, string> }> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/stocks/names`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ provider, token, codes }),
    });
    if (!res.ok) throw new Error(`engine stocks/names ${res.status}`);
    return (await res.json()) as { names: Record<string, string> };
  }

  async marketSnapshot(provider: string, token?: string, sparkDays = 20): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/market/snapshot`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ provider, token, spark_days: sparkDays }),
    });
    if (!res.ok) throw new Error(`engine market/snapshot ${res.status}`);
    return res.json();
  }

  async marketSector(provider: string, industry: string, token?: string): Promise<any> {
    const res = await fetch(`${config.engineBaseUrl()}/engine/market/sector`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ provider, token, industry }),
    });
    if (!res.ok) throw new Error(`engine market/sector ${res.status}`);
    return res.json();
  }

  async marketLive(provider: string, token?: string, sparkDays = 20): Promise<any> {
    // 全市场实时(~5200 只分批拉报价)约 2s → slowPost 无超时,稳妥。
    return this.slowPost('/engine/market/live', { provider, token, spark_days: sparkDays });
  }

  async tdxValidate(src: string): Promise<any> {
    return this.slowPost('/engine/tdx/validate', { src });
  }

  async tdxScan(req: {
    src: string;
    asof?: string;
    signal?: string;
    codes?: string[];
  }): Promise<any> {
    // 全市场扫描可达十余秒 → slowPost(无超时);非法公式 engine 422 → EngineError 转发。
    return this.slowPost('/engine/tdx/scan', req);
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
    return this.slowPost('/engine/paper/run', req); // 无超时:盘后含特征面板计算
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
    return this.slowPost('/engine/backtest', req); // 无超时:逐日撮合回测可达数分钟
  }

  async train(req: TrainRequest, onEvent?: (ev: any) => void): Promise<any> {
    // SSE 流式:特征面板 + 逐折 IC 进度 → onEvent;无超时,持续数据流保活长连接。
    return this.slowPostStream('/engine/train', req, onEvent);
  }

  async factorQuality(req: FactorQualityRequest, onEvent?: (ev: any) => void): Promise<any> {
    // SSE 流式:特征面板 + 逐因子 IC 进度 → onEvent;无超时。
    return this.slowPostStream('/engine/factors/quality', req, onEvent);
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
