/** 通达信(TDX)公式域(MVP:检测/扫描):engine 解析+求值+全市场扫描 → api 转发。
 * 红线#6:engine 不写库,本服务只转发(检测无落库需求);非法公式 engine 422 如实转发,不静默。
 * 红线#1:无未来函数由 engine 解析期保证(负 REF 拒 + 仅回看算子 + crossing 黄金测试)。 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

@Controller()
export class TdxController {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Post('tdx/validate')
  async validate(@Body() body: { src?: string }): Promise<any> {
    if (!body?.src?.trim()) throw new BadRequestException('src 必填');
    return this.engine.tdxValidate(body.src);
  }

  @Post('tdx/scan')
  async scan(
    @Body() body: { src?: string; asof?: string; signal?: string; codes?: string[] },
  ): Promise<any> {
    if (!body?.src?.trim()) throw new BadRequestException('src 必填');
    const t0 = Date.now();
    this.repo.logInsert({
      level: 'info',
      source: 'tdx',
      message: `公式扫描开始 · 信号 ${body.signal ?? '(自动)'} · 全市场逐股求值`,
    });
    let result: any;
    try {
      result = await this.engine.tdxScan({
        src: body.src,
        asof: body.asof,
        signal: body.signal,
        codes: body.codes,
      });
    } catch (e) {
      const detail =
        e instanceof EngineError
          ? typeof e.detail === 'string'
            ? e.detail
            : JSON.stringify(e.detail)
          : String(e);
      this.repo.logInsert({ level: 'error', source: 'tdx', message: `公式扫描失败 · ${detail}` });
      if (e instanceof EngineError) {
        if (e.status === 422) throw new UnprocessableEntityException(detail); // 非法/不安全公式
        if (e.status === 400) throw new BadRequestException(detail);
      }
      throw e;
    }
    this.repo.logInsert({
      level: 'info',
      source: 'tdx',
      message: `公式扫描完成 · ${result.asof ?? '?'} · 扫描 ${result.scanned ?? 0} 只 · 触发 ${result.hits?.length ?? 0} 只 · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    });
    return result;
  }

  // ── 保存的公式 CRUD(保存前经 engine 解析器校验,绝不存非法/不安全公式)──────────
  @Post('tdx/formulas')
  async createFormula(
    @Body() body: { name?: string; src?: string; signal?: string | null },
  ): Promise<any> {
    if (!body?.name?.trim() || !body?.src?.trim()) throw new BadRequestException('name / src 必填');
    const v = await this.engine.tdxValidate(body.src);
    if (!v?.ok)
      throw new BadRequestException(`公式不合法:${(v?.errors ?? ['未知错误']).join('；')}`);
    const id = this.repo.tdxFormulaCreate({
      name: body.name.trim(),
      src: body.src,
      signal: body.signal ?? null,
    });
    return { id, name: body.name.trim(), src: body.src, signal: body.signal ?? null };
  }

  @Get('tdx/formulas')
  listFormulas(): any {
    return this.repo.tdxFormulasList();
  }

  @Put('tdx/formulas/:id')
  async updateFormula(
    @Param('id') id: string,
    @Body() body: { name?: string; src?: string; signal?: string | null },
  ): Promise<any> {
    if (body?.src !== undefined) {
      if (!body.src.trim()) throw new BadRequestException('src 不能为空');
      const v = await this.engine.tdxValidate(body.src);
      if (!v?.ok) {
        throw new BadRequestException(`公式不合法:${(v?.errors ?? ['未知错误']).join('；')}`);
      }
    }
    if (!this.repo.tdxFormulaUpdate(id, body)) throw new NotFoundException('公式不存在');
    return { ok: true };
  }

  @Delete('tdx/formulas/:id')
  deleteFormula(@Param('id') id: string): any {
    if (!this.repo.tdxFormulaDelete(id)) throw new NotFoundException('公式不存在');
    return { ok: true };
  }
}
