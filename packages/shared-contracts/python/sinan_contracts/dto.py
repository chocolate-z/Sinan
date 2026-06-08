"""M0 DTO Python 绑定(pydantic v2)—— 与 TS Zod schema 对齐。

红线#4:凭据响应模型 CredentialInfo 永不含明文 token,只暴露 configured/fingerprint。
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .enums import (
    Board,
    Dataset,
    JobStatus,
    JobTrigger,
    JobType,
    OnboardingStep,
    Provider,
    ProviderStatus,
)

CapsRecord = dict[str, bool]


class Health(BaseModel):
    status: Literal["ok", "degraded", "down"]
    db_ok: bool
    engine_ok: bool
    gpu: Optional[bool] = None
    version: Optional[str] = None


class OnboardingStateDTO(BaseModel):
    done: bool
    step: OnboardingStep
    active_provider: Optional[Provider] = None


class RateLimit(BaseModel):
    per_min: int = Field(gt=0)
    concurrency: Optional[int] = Field(default=None, gt=0)


class ProviderInfo(BaseModel):
    id: Provider
    display_name: str
    caps: CapsRecord
    needs_token: bool
    rate_limit: Optional[RateLimit] = None
    priority: int
    status: ProviderStatus
    last_check_at: Optional[str] = None


class CredentialPutReq(BaseModel):
    token: str = Field(min_length=1)


class CredentialInfo(BaseModel):
    """红线:永不含明文 token。"""

    configured: bool
    fingerprint: Optional[str] = None


class ProviderTestResult(BaseModel):
    status: ProviderStatus
    latency_ms: Optional[float] = None
    caps: CapsRecord
    rate_limit: Optional[RateLimit] = None
    points_hint: Optional[int] = None
    degraded: list[str] = Field(default_factory=list)
    message: Optional[str] = None


class CacheBuildUniverse(BaseModel):
    boards: list[Board] = Field(min_length=1)
    liq_min_amount_yi: Optional[float] = Field(default=None, ge=0)
    codes: Optional[list[str]] = None


class CacheBuildParams(BaseModel):
    universe: CacheBuildUniverse
    years: Optional[int] = Field(default=None, gt=0)
    start_year: Optional[int] = None
    datasets: list[Dataset] = Field(min_length=1)
    rate: Optional[RateLimit] = None
    resume: bool = True


class JobCreateReq(BaseModel):
    type: JobType
    trigger: Optional[JobTrigger] = None
    provider: Optional[Provider] = None
    params: Optional[dict[str, Any]] = None


class JobPatchReq(BaseModel):
    action: Literal["pause", "resume", "cancel"]


class JobInfo(BaseModel):
    id: str
    type: JobType
    provider: Optional[Provider] = None
    status: JobStatus
    trigger: JobTrigger
    total: int = 0
    done_count: int = 0
    failed_count: int = 0
    progress: float = 0.0
    cursor: Optional[dict[str, Any]] = None
    rate_limit: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    created_at: str
    updated_at: str


class JobProgressEvent(BaseModel):
    job_id: str
    status: JobStatus
    progress: float = Field(ge=0, le=1)
    total: int = 0
    done_count: int = 0
    failed_count: Optional[int] = None
    stage: Optional[str] = None
    message: Optional[str] = None
    rate_cooldown_s: Optional[float] = None
    ts: str


class CoverageRow(BaseModel):
    stock_code: str
    dataset: Dataset
    provider: Provider
    first_date: Optional[str] = None
    last_date: Optional[str] = None
    rows: int = 0


class CoverageSummary(BaseModel):
    stock_count: int = 0
    first_date: Optional[str] = None
    last_date: Optional[str] = None
    total_rows: int = 0
    bytes: Optional[int] = None
    by_dataset: Optional[list[CoverageRow]] = None
