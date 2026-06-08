/**
 * M0 数据传输对象(Zod schema + 推导类型)。
 * 红线#4:凭据相关响应 schema 永不含明文 token —— CredentialInfoSchema 只暴露
 * configured / fingerprint;PUT 请求体的 token 仅入参,绝不出现在任何响应/SSE schema。
 */
import { z } from 'zod';
import { CAPABILITIES } from './capabilities.js';
import {
  PROVIDERS,
  PROVIDER_STATUSES,
  DATASETS,
  JOB_TYPES,
  JOB_STATUSES,
  JOB_TRIGGERS,
  BOARDS,
  ONBOARDING_STEPS,
} from './enums.js';

const ProviderEnum = z.enum(PROVIDERS);
const CapabilityEnum = z.enum(CAPABILITIES);

/** 能力声明 schema(对前端/DB 的 caps_json 形态)。类型 CapsRecord 由 capabilities.ts 统一导出。 */
export const CapsRecordSchema = z.record(CapabilityEnum, z.boolean());

// ── 健康 ────────────────────────────────────────────────────────────────
export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  db_ok: z.boolean(),
  engine_ok: z.boolean(),
  gpu: z.boolean().optional(),
  version: z.string().optional(),
});
export type Health = z.infer<typeof HealthSchema>;

// ── 引导 ────────────────────────────────────────────────────────────────
export const OnboardingStateSchema = z.object({
  done: z.boolean(),
  step: z.enum(ONBOARDING_STEPS),
  active_provider: ProviderEnum.optional(),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

// ── 数据源 ──────────────────────────────────────────────────────────────
export const RateLimitSchema = z.object({
  per_min: z.number().int().positive(),
  concurrency: z.number().int().positive().optional(),
});
export type RateLimit = z.infer<typeof RateLimitSchema>;

export const ProviderInfoSchema = z.object({
  id: ProviderEnum,
  display_name: z.string(),
  caps: CapsRecordSchema,
  needs_token: z.boolean(),
  rate_limit: RateLimitSchema.optional(),
  priority: z.number().int(),
  status: z.enum(PROVIDER_STATUSES),
  last_check_at: z.string().nullable().optional(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

/** PUT /providers/:id/credential 请求体。token 仅入参 —— 立即加密,绝不回显。 */
export const CredentialPutReqSchema = z.object({
  token: z.string().min(1),
});
export type CredentialPutReq = z.infer<typeof CredentialPutReqSchema>;

/** 凭据信息响应 —— 红线:永不含明文 token。 */
export const CredentialInfoSchema = z.object({
  configured: z.boolean(),
  /** 明文 token 的 SHA-256 前 8 位,仅供 UI 显示「已配置 ****a1b2」,不可逆。 */
  fingerprint: z.string().nullable(),
});
export type CredentialInfo = z.infer<typeof CredentialInfoSchema>;

/** POST /providers/:id/test 结果。 */
export const ProviderTestResultSchema = z.object({
  status: z.enum(PROVIDER_STATUSES),
  latency_ms: z.number().optional(),
  caps: CapsRecordSchema,
  rate_limit: RateLimitSchema.optional(),
  /** Tushare 积分提示(探测得到的近似值)。 */
  points_hint: z.number().nullable().optional(),
  /** 降级说明(非空即提示用户预期更低)。 */
  degraded: z.array(z.string()),
  message: z.string().optional(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;

// ── 作业 / 建缓存 ───────────────────────────────────────────────────────
export const CacheBuildParamsSchema = z.object({
  universe: z.object({
    boards: z.array(z.enum(BOARDS)).min(1),
    liq_min_amount_yi: z.number().nonnegative().optional(),
    codes: z.array(z.string()).optional(),
  }),
  years: z.number().int().positive().optional(),
  start_year: z.number().int().optional(),
  datasets: z.array(z.enum(DATASETS)).min(1),
  rate: RateLimitSchema.optional(),
  resume: z.boolean().optional(),
});
export type CacheBuildParams = z.infer<typeof CacheBuildParamsSchema>;

export const JobCreateReqSchema = z.object({
  type: z.enum(JOB_TYPES),
  trigger: z.enum(JOB_TRIGGERS).optional(),
  provider: ProviderEnum.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type JobCreateReq = z.infer<typeof JobCreateReqSchema>;

export const JobPatchReqSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
});
export type JobPatchReq = z.infer<typeof JobPatchReqSchema>;

export const JobInfoSchema = z.object({
  id: z.string(),
  type: z.enum(JOB_TYPES),
  provider: ProviderEnum.nullable().optional(),
  status: z.enum(JOB_STATUSES),
  trigger: z.enum(JOB_TRIGGERS),
  total: z.number().int().nonnegative(),
  done_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  cursor: z.record(z.string(), z.unknown()).nullable().optional(),
  rate_limit: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobInfo = z.infer<typeof JobInfoSchema>;

/** SSE 进度事件(GET /events/jobs/:id)。 */
export const JobProgressEventSchema = z.object({
  job_id: z.string(),
  status: z.enum(JOB_STATUSES),
  progress: z.number().min(0).max(1),
  total: z.number().int().nonnegative(),
  done_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative().optional(),
  stage: z.string().optional(),
  message: z.string().optional(),
  /** 限流冷却剩余秒数,UI 显示「限流中,预计 x 秒后继续」。 */
  rate_cooldown_s: z.number().nonnegative().optional(),
  ts: z.string(),
});
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;

// ── 缓存覆盖台账 ────────────────────────────────────────────────────────
export const CoverageRowSchema = z.object({
  stock_code: z.string(),
  dataset: z.enum(DATASETS),
  provider: ProviderEnum,
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  rows: z.number().int().nonnegative(),
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

export const CoverageSummarySchema = z.object({
  stock_count: z.number().int().nonnegative(),
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
  total_rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative().optional(),
  by_dataset: z.array(CoverageRowSchema).optional(),
});
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

// ── 统一错误体 ──────────────────────────────────────────────────────────
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
    job_id: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
