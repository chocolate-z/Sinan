/** 行情域:实时报价(经 RealtimeProvider)+ 历史日 K(本地 parquet)。
 * 红线#6:前端只打 api,engine 仅 api 可达;此处仅做代理 + 入参校验,数值计算在 engine。 */
import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ENGINE_CLIENT,
  type EngineClient,
  type PricesResult,
  type Quote,
} from '../engine/engine.client.js';

interface QuoteRow {
  stock_code: string;
  name: string | null;
  price: number | null;
  prev_close: number | null;
  open: number | null;
  source: string | null;
}

const MAX_BARS = 2000;

@Controller()
export class MarketController {
  constructor(@Inject(ENGINE_CLIENT) private readonly engine: EngineClient) {}

  /** GET /quotes?codes=000001.SZ,600000.SH — 实时报价列表。实时源不可达/缺价 → degraded(诚实)。 */
  @Get('quotes')
  async quotes(@Query('codes') codes?: string): Promise<{ degraded: boolean; quotes: QuoteRow[] }> {
    const list = (codes ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!list.length) throw new BadRequestException('codes 必填(逗号分隔股票代码)');

    let map: Record<string, Quote> = {};
    let degraded = false;
    try {
      map = await this.engine.quotes(list);
    } catch {
      degraded = true; // 实时源整体不可达
    }
    const quotes = list.map((stock_code): QuoteRow => {
      const q = map[stock_code];
      if (!q || q.price == null) {
        degraded = true; // 该标的无实时报价
        return {
          stock_code,
          name: q?.name ?? null,
          price: null,
          prev_close: null,
          open: null,
          source: null,
        };
      }
      return {
        stock_code,
        name: q.name ?? null,
        price: q.price ?? null,
        prev_close: q.prev_close ?? null,
        open: q.open ?? null,
        source: q.source ?? null,
      };
    });
    return { degraded, quotes };
  }

  /** GET /prices/:code — 历史日 K(默认前复权)。引擎不可达/无缓存 → 空 rows + degraded。 */
  @Get('prices/:code')
  async prices(
    @Param('code') code: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('limit') limit?: string,
    @Query('adjust') adjust?: string,
  ): Promise<PricesResult> {
    const adj = adjust === 'none' ? 'none' : 'qfq';
    let n: number | undefined;
    if (limit) {
      const parsed = Number.parseInt(limit, 10);
      if (Number.isFinite(parsed)) n = Math.min(Math.max(parsed, 1), MAX_BARS);
    }
    try {
      return await this.engine.prices({ code, start, end, limit: n, adjust: adj });
    } catch {
      return { code, adjust: adj, rows: [], degraded: true };
    }
  }
}
