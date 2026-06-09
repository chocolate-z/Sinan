/** 模型域(M3):engine 训练(walk-forward + 样本内外 IC,模型=系数 JSON)→ api 落库 → 列表/详情/激活。
 * 红线#6:engine 不写 SQLite,产物由本服务落库;守卫违反(422,purge<label_horizon)如实转发,不静默。 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

interface TrainInput {
  train_start?: string;
  train_end?: string;
  label_horizon?: number;
  purge?: number;
  embargo?: number;
  train_span?: number;
  test_span?: number;
  codes?: string[];
  model_type?: string;
  alpha?: number;
  l1_ratio?: number;
  top_quantile?: number;
  train_threads?: string;
  device?: string;
  strategy_id?: string;
  name?: string;
}

@Controller()
export class ModelsController {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Post('models/train')
  async train(@Body() body: TrainInput): Promise<any> {
    if (!body?.train_start || !body?.train_end) {
      throw new BadRequestException('train_start / train_end 必填');
    }
    let result: any;
    try {
      result = await this.engine.train({
        train_start: body.train_start,
        train_end: body.train_end,
        label_horizon: body.label_horizon,
        purge: body.purge,
        embargo: body.embargo,
        train_span: body.train_span,
        test_span: body.test_span,
        codes: body.codes,
        model_type: body.model_type,
        alpha: body.alpha,
        l1_ratio: body.l1_ratio,
        top_quantile: body.top_quantile,
        train_threads: body.train_threads,
        device: body.device,
      });
    } catch (e) {
      if (e instanceof EngineError) {
        const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
        if (e.status === 422) throw new UnprocessableEntityException(detail); // purge<label_horizon 被拒
        if (e.status === 400) throw new BadRequestException(detail);
      }
      throw e;
    }
    const id = this.repo.insertModelVersion(
      { strategy_id: body.strategy_id ?? null, name: body.name ?? null },
      result,
    );
    return { id, ...result };
  }

  @Get('models')
  list(): any {
    return this.repo.modelVersionsList();
  }

  @Get('models/:id')
  get(@Param('id') id: string): any {
    const r = this.repo.modelVersionGet(id);
    if (!r) throw new NotFoundException('模型版本不存在');
    return r;
  }

  @Post('models/:id/activate')
  activate(@Param('id') id: string): any {
    const r = this.repo.modelVersionActivate(id);
    if (!r) throw new NotFoundException('模型版本不存在');
    return r;
  }
}
