/**
 * 端点常量 — 单一真相源镜像自 spec/endpoints.json。
 * 前端只与 api(API_BASE)对话;engine 仅 api 可达(HEADERS.internal)。
 */

export const API_BASE = '/api/v1';

export const HEADERS = {
  /** 会话随机 token,所有 sidecar 校验,防本机跨站。 */
  sessionToken: 'X-Sinan-Token',
  /** engine 仅接受带此头的来自 api 的请求。 */
  internal: 'X-Sinan-Internal',
} as const;

export interface EndpointDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
}

/** 前端 ↔ api(/api/v1)。 */
export const API_ENDPOINTS = {
  health: { method: 'GET', path: '/health' },
  onboarding_state: { method: 'GET', path: '/onboarding/state' },
  onboarding_complete: { method: 'POST', path: '/onboarding/complete' },
  onboarding_step: { method: 'PUT', path: '/onboarding/step' },
  providers_list: { method: 'GET', path: '/providers' },
  providers_active: { method: 'PUT', path: '/providers/active' },
  credential_get: { method: 'GET', path: '/providers/:id/credential' },
  credential_put: { method: 'PUT', path: '/providers/:id/credential' },
  credential_delete: { method: 'DELETE', path: '/providers/:id/credential' },
  provider_test: { method: 'POST', path: '/providers/:id/test' },
  jobs_create: { method: 'POST', path: '/jobs' },
  jobs_list: { method: 'GET', path: '/jobs' },
  jobs_get: { method: 'GET', path: '/jobs/:id' },
  jobs_patch: { method: 'PATCH', path: '/jobs/:id' },
  jobs_events: { method: 'GET', path: '/events/jobs/:id' },
  data_coverage: { method: 'GET', path: '/data/coverage' },
  settings_list: { method: 'GET', path: '/settings' },
  settings_put: { method: 'PUT', path: '/settings/:key' },
  logs_list: { method: 'GET', path: '/logs' },
  logs_stream: { method: 'GET', path: '/logs/stream' },
  signals_list: { method: 'GET', path: '/signals' },
  signals_generate: { method: 'POST', path: '/signals/generate' },
  paper_run: { method: 'POST', path: '/paper/run' },
  portfolios_model_holdings: { method: 'GET', path: '/portfolios/model/holdings' },
  portfolios_personal_holdings: { method: 'GET', path: '/portfolios/personal/holdings' },
  portfolios_personal_add: { method: 'POST', path: '/portfolios/personal/holdings' },
  portfolios_personal_delete: { method: 'DELETE', path: '/portfolios/personal/holdings/:code' },
  trades_list: { method: 'GET', path: '/trades' },
  pnl_daily: { method: 'GET', path: '/pnl/daily' },
  pnl_today: { method: 'GET', path: '/pnl/today' },
  quotes_list: { method: 'GET', path: '/quotes' },
  prices_get: { method: 'GET', path: '/prices/:code' },
  backtests_create: { method: 'POST', path: '/backtests' },
  backtests_list: { method: 'GET', path: '/backtests' },
  backtests_get: { method: 'GET', path: '/backtests/:id' },
  models_train: { method: 'POST', path: '/models/train' },
  models_list: { method: 'GET', path: '/models' },
  models_get: { method: 'GET', path: '/models/:id' },
  models_activate: { method: 'POST', path: '/models/:id/activate' },
} as const satisfies Record<string, EndpointDef>;

/** api ↔ engine 内部(:59915,X-Sinan-Internal)。 */
export const ENGINE_ENDPOINTS = {
  health: { method: 'GET', path: '/healthz' },
  provider_test: { method: 'POST', path: '/engine/provider/test' },
  cache_build: { method: 'POST', path: '/engine/cache/build' },
  cache_incremental: { method: 'POST', path: '/engine/cache/incremental' },
  cache_coverage: { method: 'GET', path: '/engine/cache/coverage' },
  quotes: { method: 'POST', path: '/engine/quotes' },
  prices: { method: 'POST', path: '/engine/prices' },
  calendar_is_trade_day: { method: 'GET', path: '/engine/calendar/is-trade-day' },
  indicators_validate: { method: 'POST', path: '/engine/indicators/validate' },
  device: { method: 'GET', path: '/engine/device' },
  paper_run: { method: 'POST', path: '/engine/paper/run' },
  backtest: { method: 'POST', path: '/engine/backtest' },
  train: { method: 'POST', path: '/engine/train' },
} as const satisfies Record<string, EndpointDef>;

/** 把含 :param 的路径模板填充为具体路径。 */
export function buildPath(template: string, params: Record<string, string | number>): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`buildPath: missing param ":${key}" for "${template}"`);
    return encodeURIComponent(String(v));
  });
}
