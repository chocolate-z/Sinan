import type {
  CacheBuildRequest,
  EngineClient,
  ProviderTestResult,
} from '../src/engine/engine.client.js';

/** 离线假 engine 客户端:连通测试返回固定结果,建缓存按预设事件回放。 */
export class FakeEngineClient implements EngineClient {
  constructor(
    private readonly testResult: ProviderTestResult | null,
    private readonly events: any[] = [],
  ) {}

  async providerTest(): Promise<ProviderTestResult> {
    return this.testResult ?? { status: 'ok', caps: {}, degraded: [] };
  }

  async cacheBuild(req: CacheBuildRequest, onEvent: (ev: any) => void): Promise<void> {
    for (const ev of this.events) onEvent({ ...ev, job_id: req.job_id });
  }
}
