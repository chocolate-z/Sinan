/** 指标 / 因子质检域(M4):engine 算真实 IC/ICIR/覆盖度 + 十分位分层 → api 转发。
 * 研究报告按需重算,不落库;engine 400(无缓存/区间过短)如实转发,不静默。 */
import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

@Controller()
export class IndicatorsController {
  constructor(@Inject(ENGINE_CLIENT) private readonly engine: EngineClient) {}

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
      });
    } catch (e) {
      if (e instanceof EngineError && e.status === 400) {
        const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
        throw new BadRequestException(detail);
      }
      throw e;
    }
  }
}
