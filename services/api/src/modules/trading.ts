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
import { CredentialService } from '../secrets/credential.service.js';

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
    // 模型出信号:有激活模型则下发其系数给 engine 做线性打分,否则退回等权因子合成(诚实降级);
    // 无模型时把启用的自定义因子一并下发,使其参与等权选股(M4 v3)。
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
      custom: activeModel ? undefined : this.repo.customFactorsForQuality(),
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
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
    private readonly creds: CredentialService,
  ) {}

  // code→name 映射缓存(单例控制器,跨请求保留;空结果不缓存,以便拿到 token 后重试)。
  private nameCache: Record<string, string> | null = null;
  private async stockNames(): Promise<Record<string, string>> {
    if (this.nameCache) return this.nameCache;
    const provider = (this.repo.settingGet('active_provider') as string) || 'tushare';
    const token = this.creds.getToken(provider) ?? undefined;
    try {
      const r = await this.engine.stockNames(provider, token);
      if (r?.names && Object.keys(r.names).length) this.nameCache = r.names;
      return r?.names ?? {};
    } catch {
      return {};
    }
  }

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
  async signals(@Query('date') date?: string): Promise<any> {
    if (!date) throw new BadRequestException('date 必填');
    const sigs = this.repo.signalsByDate(date) as any[];
    // 富集股票名称(code→name,来自激活源 stock_list);拿不到则诚实留 null(显示代码)。
    const names = await this.stockNames();
    return sigs.map((s) => ({ ...s, stock_name: s.stock_name ?? names[s.stock_code] ?? null }));
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
  constructor(
    private readonly repo: Repository,
    @Inject(ENGINE_CLIENT) private readonly engine: EngineClient,
  ) {}

  /**
   * 持仓现价估值富集:用 engine 报价(本 token 走日线收盘回退)算 现价/市值/浮动盈亏/
   * 当日盈亏。报价不可用 → 价相关字段诚实留 null(前端显示「—」,绝不造数,红线#3)。
   * 仓库只存 股数/成本(手录),现价不入库 → 每次查询按最新报价富集。
   */
  private async enrich(holds: any[]): Promise<any[]> {
    if (!holds.length) return holds;
    let quotes: Record<string, { price?: number | null; prev_close?: number | null }> = {};
    try {
      quotes = await this.engine.quotes(holds.map((h) => h.stock_code));
    } catch {
      /* 报价不可用 → 降级 */
    }
    return holds.map((h) => {
      const q = quotes[h.stock_code];
      const price = q?.price ?? null;
      const prev = q?.prev_close ?? null;
      const marketValue = price != null ? h.shares * price : null;
      const floatPnl = price != null && h.avg_cost != null ? (price - h.avg_cost) * h.shares : null;
      const dayPnl = price != null && prev != null ? h.shares * (price - prev) : null;
      return {
        ...h,
        current_price: price,
        market_value: marketValue,
        float_pnl: floatPnl,
        prev_close: prev,
        day_pnl: dayPnl,
      };
    });
  }

  @Get('portfolios/model/holdings')
  modelHoldings(): Promise<any> {
    return this.enrich(this.repo.modelHoldings());
  }

  @Get('portfolios/personal/holdings')
  personalHoldings(): Promise<any> {
    return this.enrich(this.repo.personalList());
  }

  @Post('portfolios/personal/holdings')
  addPersonal(
    @Body()
    body: {
      stock_code?: string;
      stock_name?: string;
      shares?: number;
      avg_cost?: number;
      price?: number;
      op?: 'set' | 'add' | 'reduce';
      note?: string;
    },
  ): any {
    const op = body?.op ?? 'set';
    if (!['set', 'add', 'reduce'].includes(op)) {
      throw new BadRequestException('op 必须为 set/add/reduce');
    }
    if (!body?.stock_code || body.shares == null) {
      throw new BadRequestException('stock_code / shares 必填');
    }
    if (!(body.shares > 0)) throw new BadRequestException('shares 必须 > 0');
    const price = body.price ?? body.avg_cost; // 加/减仓用 price;建仓/兼容用 avg_cost
    if (op !== 'reduce' && (price == null || !(price > 0))) {
      throw new BadRequestException('成本/价格 必填且 > 0');
    }
    this.repo.personalAdjust({
      stock_code: body.stock_code,
      stock_name: body.stock_name,
      shares: body.shares,
      price: price ?? 0,
      op,
      note: body.note,
    });
    return this.enrich(this.repo.personalList());
  }

  @Delete('portfolios/personal/holdings/:code')
  deletePersonal(@Param('code') code: string): Promise<any> {
    this.repo.personalDelete(code);
    return this.enrich(this.repo.personalList());
  }
}
