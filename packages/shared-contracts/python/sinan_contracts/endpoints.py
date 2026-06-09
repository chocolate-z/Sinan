"""端点常量 Python 绑定 —— 镜像自 spec/endpoints.json。"""

from __future__ import annotations

import re
from typing import Mapping

API_BASE = "/api/v1"

HEADERS = {
    "session_token": "X-Sinan-Token",
    "internal": "X-Sinan-Internal",
}

API_ENDPOINTS: dict[str, dict[str, str]] = {
    "health": {"method": "GET", "path": "/health"},
    "onboarding_state": {"method": "GET", "path": "/onboarding/state"},
    "onboarding_complete": {"method": "POST", "path": "/onboarding/complete"},
    "onboarding_step": {"method": "PUT", "path": "/onboarding/step"},
    "providers_list": {"method": "GET", "path": "/providers"},
    "providers_active": {"method": "PUT", "path": "/providers/active"},
    "credential_get": {"method": "GET", "path": "/providers/:id/credential"},
    "credential_put": {"method": "PUT", "path": "/providers/:id/credential"},
    "credential_delete": {"method": "DELETE", "path": "/providers/:id/credential"},
    "provider_test": {"method": "POST", "path": "/providers/:id/test"},
    "jobs_create": {"method": "POST", "path": "/jobs"},
    "jobs_list": {"method": "GET", "path": "/jobs"},
    "jobs_get": {"method": "GET", "path": "/jobs/:id"},
    "jobs_patch": {"method": "PATCH", "path": "/jobs/:id"},
    "jobs_events": {"method": "GET", "path": "/events/jobs/:id"},
    "data_coverage": {"method": "GET", "path": "/data/coverage"},
    "settings_list": {"method": "GET", "path": "/settings"},
    "settings_put": {"method": "PUT", "path": "/settings/:key"},
    "logs_list": {"method": "GET", "path": "/logs"},
    "logs_stream": {"method": "GET", "path": "/logs/stream"},
    "signals_list": {"method": "GET", "path": "/signals"},
    "signals_generate": {"method": "POST", "path": "/signals/generate"},
    "paper_run": {"method": "POST", "path": "/paper/run"},
    "portfolios_model_holdings": {"method": "GET", "path": "/portfolios/model/holdings"},
    "portfolios_personal_holdings": {"method": "GET", "path": "/portfolios/personal/holdings"},
    "portfolios_personal_add": {"method": "POST", "path": "/portfolios/personal/holdings"},
    "portfolios_personal_delete": {"method": "DELETE", "path": "/portfolios/personal/holdings/:code"},
    "trades_list": {"method": "GET", "path": "/trades"},
    "pnl_daily": {"method": "GET", "path": "/pnl/daily"},
    "pnl_today": {"method": "GET", "path": "/pnl/today"},
    "quotes_list": {"method": "GET", "path": "/quotes"},
    "prices_get": {"method": "GET", "path": "/prices/:code"},
}

ENGINE_ENDPOINTS: dict[str, dict[str, str]] = {
    "health": {"method": "GET", "path": "/healthz"},
    "provider_test": {"method": "POST", "path": "/engine/provider/test"},
    "cache_build": {"method": "POST", "path": "/engine/cache/build"},
    "cache_incremental": {"method": "POST", "path": "/engine/cache/incremental"},
    "cache_coverage": {"method": "GET", "path": "/engine/cache/coverage"},
    "quotes": {"method": "POST", "path": "/engine/quotes"},
    "prices": {"method": "POST", "path": "/engine/prices"},
    "calendar_is_trade_day": {"method": "GET", "path": "/engine/calendar/is-trade-day"},
    "indicators_validate": {"method": "POST", "path": "/engine/indicators/validate"},
    "device": {"method": "GET", "path": "/engine/device"},
    "paper_run": {"method": "POST", "path": "/engine/paper/run"},
    "backtest": {"method": "POST", "path": "/engine/backtest"},
}

_PARAM_RE = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")


def build_path(template: str, params: Mapping[str, object]) -> str:
    """把含 :param 的路径模板填充为具体路径。"""

    def repl(m: "re.Match[str]") -> str:
        key = m.group(1)
        if key not in params:
            raise KeyError(f'build_path: missing param ":{key}" for "{template}"')
        return str(params[key])

    return _PARAM_RE.sub(repl, template)
