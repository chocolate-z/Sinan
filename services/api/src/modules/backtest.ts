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
import { BACKTEST_SCORINGS, type BacktestScoring } from '@sinan/shared-contracts';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, EngineError, type EngineClient } from '../engine/engine.client.js';

interface BacktestInput {
  backtest_start?: string;
  // 样本外起点(开区间,不含该日);以模型回测时自动抬升至不早于模型 train_end(红线#2)。
  backtest_end?: string;
  train_end?: string;
  codes?: string[];
  benchmark?: string;
  purge?: number;
  params?: Record<string, unknown>;
  initial_cash?: number;
  strategy_id?: string;
  // 打分口径(默认 auto=镜像实盘);model_id 指定回测某模型版本(可在激活前先回测)。
  scoring?: BacktestScoring;
  model_id?: string;
}

// 严格 ISO 日期(YYYY-MM-DD)。红线#2 守卫靠字符串字典序==日期序成立,非规范格式会让比较失真,
// 故在入口处校验:把「巧合正确」(前端 date input 恰好只发 ISO)升为「设计正确」(显式拒非法格式)。
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function assertIsoDate(v: string, field: string): void {
  if (!ISO_DATE.test(v)) {
    throw new BadRequestException(`${field} 必须为 YYYY-MM-DD 格式`);
  }
}

@Controller()
export class BacktestController {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  @Post('backtests')
  async create(@Body() body: BacktestInput): Promise<any> {
    if (!body?.backtest_start || !body?.backtest_end) {
      throw new BadRequestException('backtest_start / backtest_end 必填');
    }
    // 日期格式校验:守卫的样本外判定/train_end 抬升均依赖 ISO 字典序,非法格式即拒(红线#2 纵深)。
    assertIsoDate(body.backtest_start, 'backtest_start');
    assertIsoDate(body.backtest_end, 'backtest_end');
    if (body.train_end != null) assertIsoDate(body.train_end, 'train_end');
    const scoring: BacktestScoring = body.scoring ?? 'auto';
    if (!(BACKTEST_SCORINGS as readonly string[]).includes(scoring)) {
      throw new BadRequestException(`scoring 必须为 ${BACKTEST_SCORINGS.join('/')}`);
    }

    // ① 解析模型:model_id 指定优先(可回测未激活版本,「先回测再激活」);否则 auto/model 取激活模型。
    let modelMeta: { id: string; train_end: string; model: Record<string, unknown> } | null = null;
    if (body.model_id) {
      modelMeta = this.repo.modelVersionForBacktest(body.model_id);
      if (!modelMeta) throw new NotFoundException('模型版本不存在');
      if (!modelMeta.model || !Object.keys(modelMeta.model).length) {
        throw new BadRequestException('该模型版本无可用系数,无法回测');
      }
    } else if (scoring === 'auto' || scoring === 'model') {
      modelMeta = this.repo.activeModelMeta();
      if (!modelMeta && scoring === 'model') {
        throw new BadRequestException(
          '无激活模型,无法以 scoring=model 回测(先激活或指定 model_id)',
        );
      }
    }

    // ② 解析自定义因子:仅在无模型且口径允许时,把启用的自定义因子下发进等权(口径与实盘一致)。
    let custom: Array<{ name: string; expr: string; group: string }> | undefined;
    if (!modelMeta && (scoring === 'auto' || scoring === 'custom')) {
      const cf = this.repo.customFactorsForQuality();
      if (cf.length) custom = cf;
    }

    // 解析后的实际口径(永不为 auto):落库出处的兜底值,与 engine run_backtest 的判定同语义。
    const resolvedScoring: BacktestScoring = modelMeta
      ? 'model'
      : custom
        ? 'custom'
        : 'equal_weight';

    // ③ 诚实样本外边界(红线#2):以模型回测时,train_end 抬到不早于该模型训练截止,
    //    使回测区间绝不踩进模型的训练窗口(否则等于拿训练数据「回测」=虚假样本外)。
    let effectiveTrainEnd: string;
    if (modelMeta) {
      effectiveTrainEnd =
        body.train_end && body.train_end > modelMeta.train_end
          ? body.train_end
          : modelMeta.train_end;
    } else {
      if (!body.train_end) {
        throw new BadRequestException('train_end 必填(无模型时需声明样本外边界)');
      }
      effectiveTrainEnd = body.train_end;
    }

    let result: any;
    try {
      result = await this.engine.backtest({
        backtest_start: body.backtest_start,
        backtest_end: body.backtest_end,
        train_end: effectiveTrainEnd,
        codes: body.codes,
        benchmark: body.benchmark,
        purge: body.purge,
        params: body.params,
        initial_cash: body.initial_cash,
        model: modelMeta?.model ?? null,
        custom,
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
        scoring: result.scoring ?? resolvedScoring, // engine 恒回 scoring;兜底用解析口径,绝不落 auto
        model_id: modelMeta?.id ?? null,
      },
      result,
    );
    return { id, model_id: modelMeta?.id ?? null, ...result };
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
