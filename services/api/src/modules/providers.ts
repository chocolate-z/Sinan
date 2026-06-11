/** 数据源:列表 / 切换主源 / 凭据 CRUD / 连通测试。红线#4:凭据响应永不含明文。 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CredentialPutReqSchema, PROVIDERS } from '@sinan/shared-contracts';
import { BadRequestException } from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { CredentialService } from '../secrets/credential.service.js';
import { Inject } from '@nestjs/common';
import { ENGINE_CLIENT, type EngineClient } from '../engine/engine.client.js';

function assertProvider(id: string): void {
  if (!(PROVIDERS as readonly string[]).includes(id)) {
    throw new BadRequestException(`unknown provider ${id}`);
  }
}

@Controller()
export class ProvidersController {
  constructor(
    private readonly repo: Repository,
    private readonly creds: CredentialService,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Get('providers')
  list(): any {
    return this.repo.providersList();
  }

  @Put('providers/active')
  setActive(@Body() body: { provider?: string }): any {
    const provider = body?.provider ?? '';
    assertProvider(provider);
    this.repo.setActiveProvider(provider);
    return { active_provider: provider };
  }

  @Get('providers/:id/credential')
  getCredential(@Param('id') id: string): any {
    assertProvider(id);
    // 仅返回 {configured, fingerprint} —— 绝无 token。
    return this.creds.info(id);
  }

  @Put('providers/:id/credential')
  putCredential(@Param('id') id: string, @Body() body: unknown): any {
    assertProvider(id);
    const { token } = CredentialPutReqSchema.parse(body);
    // 立即加密落钥匙串;返回不含明文。
    return this.creds.put(id, token);
  }

  @Delete('providers/:id/credential')
  deleteCredential(@Param('id') id: string): any {
    assertProvider(id);
    this.creds.delete(id);
    return { configured: false, fingerprint: null };
  }

  @Post('providers/:id/test')
  async test(@Param('id') id: string): Promise<any> {
    assertProvider(id);
    const token = this.creds.getToken(id) ?? undefined; // 内存转发,用完即弃
    const result = await this.engine.providerTest(id, token);
    this.repo.setProviderStatus(id, result.status === 'ok' ? 'ok' : 'error', result.caps);
    return result;
  }

  /** GET /stocks/search?q= — 按代码/名称搜股(用激活源的 stock_list)。
   * 红线#4:token 仅内存转发 engine,绝不入响应;无 token/不可达 → 诚实空。 */
  @Get('stocks/search')
  async stocksSearch(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<{ stocks: { code: string; name: string }[] }> {
    const provider = (this.repo.settingGet('active_provider') as string) || 'tushare';
    const token = this.creds.getToken(provider) ?? undefined;
    if (!token && provider === 'tushare') return { stocks: [] }; // 历史源无 token → 诚实空
    let n = 20;
    if (limit) {
      const p = Number.parseInt(limit, 10);
      if (Number.isFinite(p)) n = Math.min(Math.max(p, 1), 50);
    }
    try {
      return await this.engine.stocksSearch(provider, q ?? '', token, n);
    } catch {
      return { stocks: [] };
    }
  }

  /** GET /market/snapshot — 全市场快照(板块视角)。用激活源 stock_list 建行业映射;不可达→诚实空。 */
  @Get('market/snapshot')
  async marketSnapshot(): Promise<any> {
    const provider = (this.repo.settingGet('active_provider') as string) || 'tushare';
    const token = this.creds.getToken(provider) ?? undefined;
    try {
      return await this.engine.marketSnapshot(provider, token);
    } catch {
      return { asof: null, breadth: null, sectors: [] };
    }
  }

  /** GET /market/sector?industry= — 板块成分股。 */
  @Get('market/sector')
  async marketSector(@Query('industry') industry?: string): Promise<any> {
    if (!industry) throw new BadRequestException('industry 必填');
    const provider = (this.repo.settingGet('active_provider') as string) || 'tushare';
    const token = this.creds.getToken(provider) ?? undefined;
    try {
      return await this.engine.marketSector(provider, industry, token);
    } catch {
      return { industry, asof: null, constituents: [] };
    }
  }
}
