/** 数据源:列表 / 切换主源 / 凭据 CRUD / 连通测试。红线#4:凭据响应永不含明文。 */
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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
}
