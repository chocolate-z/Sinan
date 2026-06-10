/**
 * 跨服务枚举 — 单一真相源镜像自 spec/enums.json。
 * consistency 测试校验本文件与 spec、Python 绑定三者一致。
 */

export const PROVIDERS = ['tushare', 'akshare', 'realtime_sina', 'realtime_tencent'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_STATUSES = ['ok', 'error', 'unknown'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const DATASETS = [
  'price',
  'adj_factor',
  'daily_basic',
  'fundamental',
  'fina_indicator',
  'northbound',
  'index_ohlcv',
  'index_weight',
  'sw_industry',
] as const;
export type Dataset = (typeof DATASETS)[number];

export const JOB_TYPES = [
  'cache_build',
  'incremental',
  'train',
  'signal_gen',
  'paper_run',
  'news_fetch',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['queued', 'running', 'paused', 'done', 'failed', 'canceled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGERS = ['manual', 'schedule', 'onboarding'] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const BOARDS = ['sh', 'sz', 'bj'] as const;
export type Board = (typeof BOARDS)[number];

export const PORTFOLIOS = ['model', 'personal'] as const;
export type Portfolio = (typeof PORTFOLIOS)[number];

export const SIGNAL_ACTIONS = ['buy', 'sell', 'hold'] as const;
export type SignalAction = (typeof SIGNAL_ACTIONS)[number];

export const TRADE_SIDES = ['buy', 'sell'] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export const TRADE_REASONS = [
  'signal',
  'stop_loss',
  'take_profit',
  'rank_out',
  'market_filter',
  'manual',
] as const;
export type TradeReason = (typeof TRADE_REASONS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const ONBOARDING_STEPS = [
  'welcome',
  'select_source',
  'credential',
  'test',
  'build_cache',
  'done',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MODEL_TYPES = ['elasticnet'] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export const MODEL_STATUSES = ['draft', 'running', 'archived'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

// 回测打分口径:auto=镜像实盘(有激活模型用模型,否则启用的自定义因子,再否则等权);
// equal_weight/model/custom 为强制档。落库的 scoring 为解析后的实际口径(engine 永不回传 auto)。
export const BACKTEST_SCORINGS = ['auto', 'equal_weight', 'model', 'custom'] as const;
export type BacktestScoring = (typeof BACKTEST_SCORINGS)[number];

/** 镜像所有枚举,供 consistency 测试逐项与 spec/enums.json 比对。 */
export const ENUM_MIRROR: Record<string, readonly string[]> = {
  Provider: PROVIDERS,
  ProviderStatus: PROVIDER_STATUSES,
  Dataset: DATASETS,
  JobType: JOB_TYPES,
  JobStatus: JOB_STATUSES,
  JobTrigger: JOB_TRIGGERS,
  Board: BOARDS,
  Portfolio: PORTFOLIOS,
  SignalAction: SIGNAL_ACTIONS,
  TradeSide: TRADE_SIDES,
  TradeReason: TRADE_REASONS,
  LogLevel: LOG_LEVELS,
  OnboardingStep: ONBOARDING_STEPS,
  ModelType: MODEL_TYPES,
  ModelStatus: MODEL_STATUSES,
  BacktestScoring: BACKTEST_SCORINGS,
};
