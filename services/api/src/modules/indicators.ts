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
  Query,
} from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

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
  async createCustom(@Body() body: { name?: string; expr?: string; group?: string }): Promise<any> {
    if (!body?.name || !body?.expr) throw new BadRequestException('name / expr 必填');
    // 落库前先经 engine 沙箱校验(白名单 + 仅回看算子);不通过则拒绝,绝不存非法/前视表达式。
    const v = await this.engine.indicatorsValidate(body.expr);
    if (!v?.ok) {
      throw new BadRequestException(`表达式不合法:${(v?.errors ?? ['未知错误']).join('；')}`);
    }
    const id = this.repo.customFactorCreate({
      name: body.name,
      expr: body.expr,
      group: body.group,
    });
    return { id, name: body.name, expr: body.expr, group: body.group ?? 'custom' };
  }

  @Get('custom-factors')
  listCustom(): any {
    return this.repo.customFactorsList();
  }

  @Delete('custom-factors/:id')
  deleteCustom(@Param('id') id: string): any {
    if (!this.repo.customFactorDelete(id)) throw new NotFoundException('自定义因子不存在');
    return { ok: true };
  }
}
