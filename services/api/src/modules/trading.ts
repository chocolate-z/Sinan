/** 交易域:盘后出信号/模拟盘(经 engine 计算→api 落库)+ 信号/成交/当日收益查询 + 双账持仓。
 * 红线#6:engine 不写 SQLite,结果由本服务落库;模型/个人两套账本物理隔离。 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PORTFOLIOS } from '@sinan/shared-contracts';
import { Repository } from '../db/repository.js';
import { ENGINE_CLIENT, type EngineClient } from '../engine/engine.client.js';

interface RunInput {
  strategy_id?: string;
  today?: string;
  effective_date?: string;
  codes?: string[];
  params?: Record<string, unknown>;
  fill?: boolean;
}

@Injectable()
export class PaperService {
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  async run(input: RunInput): Promise<any> {
    if (!input.today || !input.effective_date) {
      throw new BadRequestException('today 与 effective_date 必填(M0/M1 无内置交易日历)');
    }
    const strategyId = input.strategy_id ?? this.repo.ensureDefaultStrategy();
    const snap = this.repo.modelAccountSnapshot(strategyId);
    const fill = input.fill !== false;
    // 模型出信号:有激活模型则下发其系数给 engine 做线性打分,否则退回等权因子合成(诚实降级)。
    const activeModel = this.repo.activeModel();
    const result = await this.engine.paperRun({
      strategy_id: strategyId,
      today: input.today,
      effective_date: input.effective_date,
      codes: input.codes,
      account: { cash: snap.cash, positions: snap.positions },
      params: input.params ?? {},
      prev_nav: snap.prev_nav,
      peak_nav: snap.peak_nav,
      fill,
      model: activeModel,
    });
    this.repo.persistPaperResult(strategyId, result, { persistTrades: fill });
    return { strategy_id: strategyId, ...result };
  }

  /** 实时当日收益:Σ 持仓 × (现价 − 昨收)。个人/模型分别;缺报价标 degraded(诚实降级)。 */
  async livePnl(portfolio: 'model' | 'personal'): Promise<any> {
    const holds = this.repo.holdingsFor(portfolio);
    const asof = new Date().toISOString();
    if (!holds.length) {
      return { portfolio, day_pnl: 0, market_value: 0, by_holding: [], degraded: false, asof };
    }
    let quotes: Record<string, any> = {};
    let degraded = false;
    try {
      quotes = await this.engine.quotes(holds.map((h) => h.stock_code));
    } catch {
      degraded = true;
    }
    let dayPnl = 0;
    let marketValue = 0;
    const byHolding: any[] = [];
    for (const h of holds) {
      const q = quotes[h.stock_code];
      const price = q?.price ?? null;
      const prev = q?.prev_close ?? null;
      if (price != null && prev != null) {
        const d = h.shares * (price - prev);
        dayPnl += d;
        marketValue += h.shares * price;
        byHolding.push({
          stock_code: h.stock_code,
          shares: h.shares,
          price,
          prev_close: prev,
          day_pnl: d,
        });
      } else {
        degraded = true;
        byHolding.push({
          stock_code: h.stock_code,
          shares: h.shares,
          price: null,
          prev_close: null,
          day_pnl: null,
        });
      }
    }
    return {
      portfolio,
      day_pnl: dayPnl,
      market_value: marketValue,
      by_holding: byHolding,
      degraded,
      asof,
    };
  }
}

@Controller()
export class TradingController {
  constructor(
    private readonly paper: PaperService,
    private readonly repo: Repository,
  ) {}

  @Post('paper/run')
  paperRun(@Body() body: RunInput): Promise<any> {
    return this.paper.run({ ...body, fill: true });
  }

  @Post('signals/generate')
  async generate(@Body() body: RunInput): Promise<any> {
    // 仅出信号(不撮合、不动账户/持仓)。
    const res = await this.paper.run({ ...body, fill: false });
    return { strategy_id: res.strategy_id, trade_date: res.trade_date, signals: res.signals };
  }

  @Get('signals')
  signals(@Query('date') date?: string): any {
    if (!date) throw new BadRequestException('date 必填');
    return this.repo.signalsByDate(date);
  }

  @Get('trades')
  trades(
    @Query('portfolio') portfolio = 'model',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): any {
    if (!(PORTFOLIOS as readonly string[]).includes(portfolio)) {
      throw new BadRequestException(`portfolio 必须为 ${PORTFOLIOS.join('/')}`);
    }
    return this.repo.tradesList(portfolio, from, to);
  }

  @Get('pnl/daily')
  pnl(@Query('portfolio') portfolio = 'model', @Query('strategy_id') strategyId?: string): any {
    if (!(PORTFOLIOS as readonly string[]).includes(portfolio)) {
      throw new BadRequestException(`portfolio 必须为 ${PORTFOLIOS.join('/')}`);
    }
    return this.repo.pnlDaily(portfolio, strategyId);
  }

  @Get('pnl/today')
  pnlToday(@Query('portfolio') portfolio = 'model'): any {
    if (!(PORTFOLIOS as readonly string[]).includes(portfolio)) {
      throw new BadRequestException(`portfolio 必须为 ${PORTFOLIOS.join('/')}`);
    }
    return this.paper.livePnl(portfolio as 'model' | 'personal');
  }
}

@Controller()
export class PortfolioController {
  constructor(private readonly repo: Repository) {}

  @Get('portfolios/model/holdings')
  modelHoldings(): any {
    return this.repo.modelHoldings();
  }

  @Get('portfolios/personal/holdings')
  personalHoldings(): any {
    return this.repo.personalList();
  }

  @Post('portfolios/personal/holdings')
  addPersonal(
    @Body()
    body: {
      stock_code?: string;
      stock_name?: string;
      shares?: number;
      avg_cost?: number;
      note?: string;
    },
  ): any {
    if (!body?.stock_code || body.shares == null || body.avg_cost == null) {
      throw new BadRequestException('stock_code / shares / avg_cost 必填');
    }
    this.repo.personalUpsert({
      stock_code: body.stock_code,
      stock_name: body.stock_name,
      shares: body.shares,
      avg_cost: body.avg_cost,
      note: body.note,
    });
    return this.repo.personalList();
  }

  @Delete('portfolios/personal/holdings/:code')
  deletePersonal(@Param('code') code: string): any {
    this.repo.personalDelete(code);
    return this.repo.personalList();
  }
}
