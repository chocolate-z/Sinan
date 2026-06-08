/** api 客户端:前端只与 api(127.0.0.1:apiPort/api/v1)对话,永不直连 engine(红线#6)。 */
import {
  API_BASE,
  API_ENDPOINTS,
  HEADERS,
  buildPath,
  type EndpointDef,
} from '@sinan/shared-contracts';

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
  const headers: Record<string, string> = { 'content-type': 'application/json' };
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
  providers: () => request<any[]>(API_ENDPOINTS.providers_list),
  setActiveProvider: (provider: string) =>
    request<any>(API_ENDPOINTS.providers_active, { body: { provider } }),
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
  generateSignals: (body: unknown) => request<any>(API_ENDPOINTS.signals_generate, { body }),
  paperRun: (body: unknown) => request<any>(API_ENDPOINTS.paper_run, { body }),
  modelHoldings: () => request<any[]>(API_ENDPOINTS.portfolios_model_holdings),
  personalHoldings: () => request<any[]>(API_ENDPOINTS.portfolios_personal_holdings),
  addPersonalHolding: (body: unknown) =>
    request<any[]>(API_ENDPOINTS.portfolios_personal_add, { body }),
  deletePersonalHolding: (code: string) =>
    request<any[]>(API_ENDPOINTS.portfolios_personal_delete, { params: { code } }),
  trades: (portfolio: 'model' | 'personal' = 'model', from?: string, to?: string) =>
    request<any[]>(API_ENDPOINTS.trades_list, { query: { portfolio, from, to } }),
  pnlDaily: (portfolio: 'model' | 'personal' = 'model') =>
    request<any[]>(API_ENDPOINTS.pnl_daily, { query: { portfolio } }),
  pnlToday: (portfolio: 'model' | 'personal' = 'model') =>
    request<any>(API_ENDPOINTS.pnl_today, { query: { portfolio } }),

  // ── 行情域 ───────────────────────────────────────────────────────────────
  quotes: (codes: string[]) =>
    request<{ degraded: boolean; quotes: any[] }>(API_ENDPOINTS.quotes_list, {
      query: { codes: codes.join(',') },
    }),
  prices: (
    code: string,
    opts: { adjust?: 'qfq' | 'none'; limit?: number; start?: string; end?: string } = {},
  ) => request<any>(API_ENDPOINTS.prices_get, { params: { code }, query: { ...opts } }),
};
