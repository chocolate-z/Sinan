/** 指标 / 因子质检域(M4):engine 算真实 IC/ICIR/覆盖度 + 十分位分层 → api 转发。
 * 自定义因子(M4 v3):DSL 定义,创建前经 engine 沙箱校验(白名单 + 防未来函数),api 落库,
 * 质检时与内置因子并列下发 engine 计算。研究报告按需重算不落库;engine 400 如实转发(红线#6)。 */
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
  Query,
} from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

/** 合成权重:有限非负数(0=从合成剔除;方向由因子 direction 处理,故不收负权重避免双重反向歧义)。 */
function validWeight(w: unknown): w is number {
  return typeof w === 'number' && Number.isFinite(w) && w >= 0;
}

@Controller()
export class IndicatorsController {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Get('indicators/quality')
  async quality(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('label_horizon') labelHorizon?: string,
    @Query('n_deciles') nDeciles?: string,
  ): Promise<any> {
    if (!start || !end) throw new BadRequestException('start / end 必填');
    try {
      return await this.engine.factorQuality({
        start,
        end,
        label_horizon: labelHorizon ? Number(labelHorizon) : undefined,
        n_deciles: nDeciles ? Number(nDeciles) : undefined,
        custom: this.repo.customFactorsForQuality(), // 启用的自定义因子与内置并列计算
      });
    } catch (e) {
      if (e instanceof EngineError && e.status === 400) {
        const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
        throw new BadRequestException(detail);
      }
      throw e;
    }
  }

  @Post('indicators/validate')
  async validate(@Body() body: { expr?: string }): Promise<any> {
    if (!body?.expr) throw new BadRequestException('expr 必填');
    return this.engine.indicatorsValidate(body.expr);
  }

  @Post('custom-factors')
  async createCustom(
    @Body() body: { name?: string; expr?: string; group?: string; weight?: number },
  ): Promise<any> {
    if (!body?.name || !body?.expr) throw new BadRequestException('name / expr 必填');
    if (body.weight !== undefined && !validWeight(body.weight)) {
      throw new BadRequestException('weight 必须为非负有限数(0=不参与合成)');
    }
    // 落库前先经 engine 沙箱校验(白名单 + 仅回看算子);不通过则拒绝,绝不存非法/前视表达式。
    const v = await this.engine.indicatorsValidate(body.expr);
    if (!v?.ok) {
      throw new BadRequestException(`表达式不合法:${(v?.errors ?? ['未知错误']).join('；')}`);
    }
    const weight = body.weight ?? 1.0;
    const id = this.repo.customFactorCreate({
      name: body.name,
      expr: body.expr,
      group: body.group,
      weight,
    });
    return { id, name: body.name, expr: body.expr, group: body.group ?? 'custom', weight };
  }

  @Get('custom-factors')
  listCustom(): any {
    return this.repo.customFactorsList();
  }

  // 改合成权重 / 启用态(表达式不可改:沙箱校验只在创建期,改公式请删后重建)。
  @Put('custom-factors/:id')
  updateCustom(@Param('id') id: string, @Body() body: { weight?: number; enabled?: boolean }): any {
    if (body?.weight !== undefined && !validWeight(body.weight)) {
      throw new BadRequestException('weight 必须为非负有限数(0=不参与合成)');
    }
    if (body?.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled 必须为布尔');
    }
    if (!this.repo.customFactorUpdate(id, { weight: body?.weight, enabled: body?.enabled })) {
      throw new NotFoundException('自定义因子不存在');
    }
    return { ok: true };
  }

  @Delete('custom-factors/:id')
  deleteCustom(@Param('id') id: string): any {
    if (!this.repo.customFactorDelete(id)) throw new NotFoundException('自定义因子不存在');
    return { ok: true };
  }
}
