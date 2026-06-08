/** 作业编排:创建 cache_build → 调 engine SSE → 落库进度/覆盖 → 经 JobBus 广播 SSE。 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable, ReplaySubject, map } from 'rxjs';
import { JobCreateReqSchema, JobPatchReqSchema, JOB_TRIGGERS } from '@sinan/shared-contracts';
import { Repository } from '../db/repository.js';
import { CredentialService } from '../secrets/credential.service.js';
import { ENGINE_CLIENT, type EngineClient } from '../engine/engine.client.js';

@Injectable()
export class JobBus {
  private subjects = new Map<string, ReplaySubject<any>>();
  private subject(id: string): ReplaySubject<any> {
    let s = this.subjects.get(id);
    if (!s) {
      s = new ReplaySubject<any>(1);
      this.subjects.set(id, s);
    }
    return s;
  }
  emit(id: string, ev: any): void {
    this.subject(id).next(ev);
  }
  complete(id: string): void {
    this.subject(id).complete();
  }
  observable(id: string): Observable<any> {
    return this.subject(id).asObservable();
  }
}

@Injectable()
export class JobsService {
  /** 协作式取消标志(被 PATCH cancel 置位)。 */
  private canceled = new Set<string>();

  constructor(
    private readonly repo: Repository,
    private readonly creds: CredentialService,
    private readonly bus: JobBus,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  create(input: { type: string; trigger?: string; provider?: string; params?: any }): any {
    const job = this.repo.jobCreate({
      type: input.type,
      provider: input.provider ?? null,
      trigger: input.trigger ?? JOB_TRIGGERS[0],
      params: input.params,
    });
    if (input.type === 'cache_build') {
      // 异步执行,不阻塞响应(失败写入 job.error)。
      void this.runCacheBuild(job.id, input.params ?? {}).catch((e) => {
        this.repo.jobUpdate(job.id, {
          status: 'failed',
          error: String(e),
          finished_at: new Date().toISOString(),
        });
        this.bus.emit(job.id, { job_id: job.id, status: 'failed', message: String(e) });
        this.bus.complete(job.id);
      });
    }
    return this.repo.jobToInfo(job);
  }

  async runCacheBuild(jobId: string, params: any): Promise<void> {
    this.repo.jobUpdate(jobId, { status: 'running', started_at: new Date().toISOString() });
    // 收集 BYO token(仅内存,转发 engine,绝不落库/日志)。
    // 历史源(tushare)需 token;实时源免 token。active 决定主历史源。
    const active =
      (this.repo.settingGet('active_provider') as string) ?? params.provider ?? 'tushare';
    const tokenProviders = active === 'tushare' ? ['tushare'] : [];
    const tokens: Record<string, string> = {};
    for (const p of tokenProviders) {
      const t = this.creds.getToken(p);
      if (t) tokens[p] = t;
    }
    let lastStatus = 'running';
    await this.engine.cacheBuild(
      {
        job_id: jobId,
        params,
        tokens,
        cursor: params.cursor ?? null,
        end_date: params.end_date ?? null,
      },
      (ev) => {
        if (this.canceled.has(jobId)) return;
        if (typeof ev.progress === 'number' || ev.done_count != null) {
          this.repo.jobUpdate(jobId, {
            status: ev.status ?? 'running',
            progress: ev.progress ?? undefined,
            done_count: ev.done_count ?? undefined,
            total: ev.total ?? undefined,
            failed_count: ev.failed_count ?? undefined,
            cursor: ev.cursor ?? undefined,
          });
        }
        if (Array.isArray(ev.coverage) && ev.coverage.length) {
          this.repo.coverageUpsert(ev.coverage);
        }
        if (Array.isArray(ev.degraded)) {
          for (const d of ev.degraded)
            this.repo.logInsert({
              level: 'warn',
              source: 'engine',
              job_id: jobId,
              message: `降级:${d}`,
            });
        }
        if (ev.status) lastStatus = ev.status;
        this.bus.emit(jobId, ev);
      },
    );
    const finalStatus = this.canceled.has(jobId)
      ? 'canceled'
      : lastStatus === 'failed'
        ? 'failed'
        : 'done';
    this.repo.jobUpdate(jobId, {
      status: finalStatus,
      progress: finalStatus === 'done' ? 1 : undefined,
      finished_at: new Date().toISOString(),
    });
    this.bus.emit(jobId, { job_id: jobId, status: finalStatus, ts: new Date().toISOString() });
    this.bus.complete(jobId);
    this.canceled.delete(jobId);
  }

  patch(jobId: string, action: 'pause' | 'resume' | 'cancel'): any {
    const job = this.repo.jobGet(jobId);
    if (!job) throw new NotFoundException('job not found');
    if (action === 'cancel') {
      this.canceled.add(jobId);
      this.repo.jobUpdate(jobId, { status: 'canceled' });
    } else if (action === 'pause') {
      this.repo.jobUpdate(jobId, { status: 'paused' });
    } else if (action === 'resume') {
      this.repo.jobUpdate(jobId, { status: 'running' });
    }
    return this.repo.jobToInfo(this.repo.jobGet(jobId)!);
  }
}

@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly repo: Repository,
    private readonly bus: JobBus,
  ) {}

  @Post('jobs')
  create(@Body() body: unknown): any {
    const parsed = JobCreateReqSchema.parse(body);
    return this.jobs.create(parsed);
  }

  @Get('jobs')
  list(): any {
    return this.repo.jobsList().map((j) => this.repo.jobToInfo(j));
  }

  @Get('jobs/:id')
  get(@Param('id') id: string): any {
    const job = this.repo.jobGet(id);
    if (!job) throw new NotFoundException('job not found');
    return this.repo.jobToInfo(job);
  }

  @Patch('jobs/:id')
  patch(@Param('id') id: string, @Body() body: unknown): any {
    const { action } = JobPatchReqSchema.parse(body);
    return this.jobs.patch(id, action);
  }

  @Sse('events/jobs/:id')
  stream(@Param('id') id: string): Observable<{ data: any }> {
    return this.bus.observable(id).pipe(map((ev) => ({ data: ev })));
  }
}
