/** 回测域:engine 计算(逐日撮合 + 硬守卫 + 含成本)→ api 落库 → 列表/详情查询。
 * 红线#6:engine 不写 SQLite,结果由本服务落库;守卫违反(422)如实转发,不静默。 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

interface BacktestInput {
  backtest_start?: string;
  backtest_end?: string;
  train_end?: string;
  codes?: string[];
  benchmark?: string;
  purge?: number;
  params?: Record<string, unknown>;
  initial_cash?: number;
  strategy_id?: string;
}

@Controller()
export class BacktestController {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Post('backtests')
  async create(@Body() body: BacktestInput): Promise<any> {
    if (!body?.backtest_start || !body?.backtest_end || !body?.train_end) {
      throw new BadRequestException('backtest_start / backtest_end / train_end 必填');
    }
    let result: any;
    try {
      result = await this.engine.backtest({
        backtest_start: body.backtest_start,
        backtest_end: body.backtest_end,
        train_end: body.train_end,
        codes: body.codes,
        benchmark: body.benchmark,
        purge: body.purge,
        params: body.params,
        initial_cash: body.initial_cash,
      });
    } catch (e) {
      if (e instanceof EngineError) {
        const detail = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
        if (e.status === 422) throw new UnprocessableEntityException(detail); // 非诚实样本外被拒
        if (e.status === 400) throw new BadRequestException(detail);
      }
      throw e;
    }
    const id = this.repo.insertBacktest(
      {
        strategy_id: body.strategy_id ?? null,
        backtest_start: result.backtest_start,
        backtest_end: result.backtest_end,
        train_end: result.train_end,
        purge: result.purge,
        benchmark: result.benchmark,
        initial_cash: result.initial_cash,
      },
      result,
    );
    return { id, ...result };
  }

  @Get('backtests')
  list(): any {
    return this.repo.backtestsList();
  }

  @Get('backtests/:id')
  get(@Param('id') id: string): any {
    const r = this.repo.backtestGet(id);
    if (!r) throw new NotFoundException('回测不存在');
    return r;
  }
}
