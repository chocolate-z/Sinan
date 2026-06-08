/** 核心端点:健康 / 引导状态机 / 设置 / 日志 / 缓存覆盖。 */
import { Body, Controller, Get, Param, Post, Put, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import * as config from '../config.js';
import { Repository } from '../db/repository.js';
import { LogBus } from '../bus/log-bus.js';

@Controller()
export class HealthController {
  constructor(private readonly repo: Repository) {}

  @Get('health')
  async health(): Promise<any> {
    let dbOk = true;
    try {
      this.repo.settingsAll();
    } catch {
      dbOk = false;
    }
    let engineOk = false;
    try {
      const r = await fetch(`${config.engineBaseUrl()}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      engineOk = r.ok;
    } catch {
      // engine 不可达 → engineOk 保持 false
    }
    return {
      status: dbOk && engineOk ? 'ok' : dbOk ? 'degraded' : 'down',
      db_ok: dbOk,
      engine_ok: engineOk,
    };
  }
}

@Controller()
export class OnboardingController {
  constructor(private readonly repo: Repository) {}

  @Get('onboarding/state')
  state(): any {
    return this.repo.onboardingState();
  }

  @Post('onboarding/complete')
  complete(): any {
    this.repo.completeOnboarding();
    return this.repo.onboardingState();
  }

  @Put('onboarding/step')
  step(@Body() body: { step?: string }): any {
    if (body?.step) this.repo.setOnboardingStep(body.step);
    return this.repo.onboardingState();
  }
}

@Controller()
export class SettingsController {
  constructor(private readonly repo: Repository) {}

  @Get('settings')
  all(): any {
    return this.repo.settingsAll();
  }

  @Put('settings/:key')
  put(@Param('key') key: string, @Body() body: { value: unknown }): any {
    this.repo.settingPut(key, body?.value);
    return { key, value: this.repo.settingGet(key) };
  }
}

@Controller()
export class LogsController {
  constructor(
    private readonly repo: Repository,
    private readonly bus: LogBus,
  ) {}

  @Get('logs')
  list(): any {
    return this.repo.logsList();
  }

  /** 统一日志总线 SSE → 日志页实时跟随。 */
  @Sse('logs/stream')
  stream(): Observable<{ data: unknown }> {
    return this.bus.observable().pipe(map((entry) => ({ data: entry })));
  }
}

@Controller()
export class CoverageController {
  constructor(private readonly repo: Repository) {}

  @Get('data/coverage')
  coverage(): any {
    return this.repo.coverageSummary();
  }
}
