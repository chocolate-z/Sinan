/** api 客户端:前端只与 api(127.0.0.1:apiPort/api/v1)对话,永不直连 engine(红线#6)。 */
import {
  API_BASE,
  API_ENDPOINTS,
  HEADERS,
  buildPath,
  type EndpointDef,
} from '@sinan/shared-contracts';
import type {
  BacktestResult,
  Holding,
  MarketSnapshot,
  ModelVersion,
  PricesResult,
  QuotesResult,
  SectorConstituents,
  Trade,
} from './types';

export interface Runtime {
  api: number;
  engine: number;
  token: string;
}

let runtime: Runtime = { api: 59914, engine: 59915, token: '' };

/** 启动期解析端口/会话 token:Tauri 下发(get_runtime_info),浏览器开发回退默认。 */
export async function initRuntime(): Promise<Runtime> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const info = await invoke<Runtime | null>('get_runtime_info');
    if (info && info.api) runtime = info;
  } catch {
    // 非 Tauri 环境(浏览器开发):用默认端口。
  }
  return runtime;
}

export function apiBaseUrl(): string {
  return `http://127.0.0.1:${runtime.api}${API_BASE}`;
}

interface RequestOpts {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

async function request<T>(def: EndpointDef, opts: RequestOpts = {}): Promise<T> {
  let path = def.path;
  if (opts.params) path = buildPath(path, opts.params);
  const url = new URL(apiBaseUrl() + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {};
  // 仅在确有 body 时才声明 JSON content-type:否则 Fastify 对「content-type=json 但 body 为空」
  // 的无 body POST(如 provider/test、onboarding/complete、models/activate)报 400「Body cannot be empty」。
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (runtime.token) headers[HEADERS.sessionToken] = runtime.token;
  const res = await fetch(url.toString(), {
    method: def.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`api error ${status}`);
  }
}

/** SSE 订阅:返回取消函数。用于建缓存进度(/events/jobs/:id)。 */
export function subscribeJob(
  jobId: string,
  onEvent: (ev: any) => void,
  onError?: (e: Event) => void,
): () => void {
  const url = apiBaseUrl() + buildPath(API_ENDPOINTS.jobs_events.path, { id: jobId });
  const es = new EventSource(url);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore malformed */
    }
  };
  if (onError) es.onerror = onError;
  return () => es.close();
}

export const api = {
  health: () => request<any>(API_ENDPOINTS.health),
  onboardingState: () => request<any>(API_ENDPOINTS.onboarding_state),
  onboardingComplete: () => request<any>(API_ENDPOINTS.onboarding_complete, { body: {} }),
  // providers/logs/signals/pnl 由各自 store 用更严类型(action 联合/必填字段)narrowing,client 保持宽松不冲突。
  providers: () => request<any[]>(API_ENDPOINTS.providers_list),
  setActiveProvider: (provider: string) =>
    request<{ ok?: boolean }>(API_ENDPOINTS.providers_active, { body: { provider } }),
  getCredential: (id: string) => request<any>(API_ENDPOINTS.credential_get, { params: { id } }),
  putCredential: (id: string, token: string) =>
    request<any>(API_ENDPOINTS.credential_put, { params: { id }, body: { token } }),
  deleteCredential: (id: string) =>
    request<any>(API_ENDPOINTS.credential_delete, { params: { id } }),
  testProvider: (id: string) => request<any>(API_ENDPOINTS.provider_test, { params: { id } }),
  createJob: (body: unknown) => request<any>(API_ENDPOINTS.jobs_create, { body }),
  getJob: (id: string) => request<any>(API_ENDPOINTS.jobs_get, { params: { id } }),
  patchJob: (id: string, action: 'pause' | 'resume' | 'cancel') =>
    request<any>(API_ENDPOINTS.jobs_patch, { params: { id }, body: { action } }),
  coverage: () => request<any>(API_ENDPOINTS.data_coverage),
  logs: () => request<any[]>(API_ENDPOINTS.logs_list),
  settings: () => request<Record<string, unknown>>(API_ENDPOINTS.settings_list),

  // ── M1 交易域 ──────────────────────────────────────────────────────────
  signals: (date: string) => request<any[]>(API_ENDPOINTS.signals_list, { query: { date } }),
  generateSignals: (body: unknown) => request<unknown>(API_ENDPOINTS.signals_generate, { body }),
  paperRun: (body: unknown) => request<unknown>(API_ENDPOINTS.paper_run, { body }),
  modelHoldings: () => request<Holding[]>(API_ENDPOINTS.portfolios_model_holdings),
  personalHoldings: () => request<Holding[]>(API_ENDPOINTS.portfolios_personal_holdings),
  addPersonalHolding: (body: unknown) =>
    request<Holding[]>(API_ENDPOINTS.portfolios_personal_add, { body }),
  deletePersonalHolding: (code: string) =>
    request<Holding[]>(API_ENDPOINTS.portfolios_personal_delete, { params: { code } }),
  trades: (portfolio: 'model' | 'personal' = 'model', from?: string, to?: string) =>
    request<Trade[]>(API_ENDPOINTS.trades_list, { query: { portfolio, from, to } }),
  pnlDaily: (portfolio: 'model' | 'personal' = 'model') =>
    request<any[]>(API_ENDPOINTS.pnl_daily, { query: { portfolio } }),
  pnlToday: (portfolio: 'model' | 'personal' = 'model') =>
    request<any>(API_ENDPOINTS.pnl_today, { query: { portfolio } }),

  // ── 行情域 ───────────────────────────────────────────────────────────────
  quotes: (codes: string[]) =>
    request<QuotesResult>(API_ENDPOINTS.quotes_list, {
      query: { codes: codes.join(',') },
    }),
  prices: (
    code: string,
    opts: { adjust?: 'qfq' | 'none'; limit?: number; start?: string; end?: string } = {},
  ) => request<PricesResult>(API_ENDPOINTS.prices_get, { params: { code }, query: { ...opts } }),
  searchStocks: (q: string, limit = 20) =>
    request<{ stocks: { code: string; name: string }[] }>(API_ENDPOINTS.stocks_search, {
      query: { q, limit },
    }),

  // ── 行情域:全市场快照(板块视角)──────────────────────────────────────────
  marketSnapshot: () => request<MarketSnapshot>(API_ENDPOINTS.market_snapshot),
  marketLive: () => request<MarketSnapshot>(API_ENDPOINTS.market_live),
  marketSector: (industry: string) =>
    request<SectorConstituents>(API_ENDPOINTS.market_sector, { query: { industry } }),

  // ── 回测域(M2)────────────────────────────────────────────────────────────
  createBacktest: (body: unknown) =>
    request<BacktestResult>(API_ENDPOINTS.backtests_create, { body }),
  backtests: () => request<BacktestResult[]>(API_ENDPOINTS.backtests_list),
  backtest: (id: string) =>
    request<BacktestResult>(API_ENDPOINTS.backtests_get, { params: { id } }),

  // ── 模型域(M3)────────────────────────────────────────────────────────────
  trainModel: (body: unknown) => request<ModelVersion>(API_ENDPOINTS.models_train, { body }),
  models: () => request<ModelVersion[]>(API_ENDPOINTS.models_list),
  model: (id: string) => request<ModelVersion>(API_ENDPOINTS.models_get, { params: { id } }),
  activateModel: (id: string) =>
    request<{ ok?: boolean }>(API_ENDPOINTS.models_activate, { params: { id } }),

  // ── 指标 / 因子质检域(M4)──────────────────────────────────────────────────
  indicatorsQuality: (q: {
    start: string;
    end: string;
    label_horizon?: number;
    n_deciles?: number;
    progress_id?: string; // 进度通道 id(api 据此把 engine 流式进度广播回前端);非取数参数
  }) => request<any>(API_ENDPOINTS.indicators_quality, { query: q }),
  validateIndicator: (expr: string) =>
    request<any>(API_ENDPOINTS.indicators_validate, { body: { expr } }),
  createCustomFactor: (body: { name: string; expr: string; group?: string; weight?: number }) =>
    request<any>(API_ENDPOINTS.custom_factors_create, { body }),
  customFactors: () => request<any[]>(API_ENDPOINTS.custom_factors_list),
  updateCustomFactor: (id: string, body: { weight?: number; enabled?: boolean }) =>
    request<any>(API_ENDPOINTS.custom_factors_update, { params: { id }, body }),
  deleteCustomFactor: (id: string) =>
    request<any>(API_ENDPOINTS.custom_factors_delete, { params: { id } }),

  // ── 通达信/同花顺公式域(检测扫描 + 保存)────────────────────────────────────
  tdxValidate: (src: string) => request<any>(API_ENDPOINTS.tdx_validate, { body: { src } }),
  tdxScan: (body: { src: string; asof?: string; signal?: string; codes?: string[] }) =>
    request<any>(API_ENDPOINTS.tdx_scan, { body }),
  tdxFormulasList: () => request<any[]>(API_ENDPOINTS.tdx_formulas_list),
  tdxFormulaCreate: (body: { name: string; src: string; signal?: string | null }) =>
    request<any>(API_ENDPOINTS.tdx_formulas_create, { body }),
  tdxFormulaUpdate: (id: string, body: { name?: string; src?: string; signal?: string | null }) =>
    request<any>(API_ENDPOINTS.tdx_formulas_update, { params: { id }, body }),
  tdxFormulaDelete: (id: string) =>
    request<any>(API_ENDPOINTS.tdx_formulas_delete, { params: { id } }),
  tdxEvaluate: (body: { code: string; src: string; asof?: string; bars?: number }) =>
    request<any>(API_ENDPOINTS.tdx_evaluate, { body }),
};
