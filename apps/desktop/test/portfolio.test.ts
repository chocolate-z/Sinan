import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// 隔离网络:mock api 客户端(StockSearch / 持仓拉取 / 建仓提交)。
vi.mock('../src/api/client', () => ({
  api: {
    personalHoldings: async () => [],
    modelHoldings: async () => [],
    pnlDaily: async () => [],
    pnlToday: async () => null,
    addPersonalHolding: async (b: unknown) => [b],
    deletePersonalHolding: async () => [],
    searchStocks: async () => ({ stocks: [{ code: '600519.SH', name: '贵州茅台' }] }),
  },
  ApiError: class extends Error {},
}));

import Portfolio from '../src/pages/portfolio/Portfolio.vue';
import { useTradingStore } from '../src/stores/trading';

const G = { global: { stubs: { teleport: true } } };
beforeEach(() => setActivePinia(createPinia()));

describe('Portfolio 建仓 / 加减仓弹窗', () => {
  it('个人 tab 顶部有建仓按钮,点击开弹窗(含股票搜索)', async () => {
    const w = mount(Portfolio, G);
    await flushPromises();
    const createBtn = w.findAll('button').find((b) => b.text().includes('建仓'));
    expect(createBtn).toBeTruthy();
    await createBtn!.trigger('click');
    expect(w.find('.m-card').exists()).toBe(true);
    expect(w.find('.m-title').text()).toBe('建仓');
    expect(w.find('.ss').exists()).toBe(true); // StockSearch 补全框
  });

  it('行内「加」按钮 → 弹窗预览移动加权均价', async () => {
    const w = mount(Portfolio, G);
    await flushPromises(); // 先让 onMounted 拉取(空)落定
    const trading = useTradingStore();
    trading.personalHoldings = [
      {
        stock_code: '600519.SH',
        stock_name: '贵州茅台',
        shares: 100,
        avg_cost: 10,
        current_price: 20,
      },
    ];
    await w.vm.$nextTick();

    const addBtn = w.findAll('.act-btn').find((b) => b.text() === '加');
    expect(addBtn).toBeTruthy();
    await addBtn!.trigger('click');
    expect(w.find('.m-title').text()).toContain('加仓');

    // openAdjust 预填价=现价 20;设股数 100 → (100×10 + 100×20)/200 = 15
    const sharesInput = w.findAll('.dlg-row .dlg-field input')[0];
    await sharesInput.setValue(100);
    expect(w.find('.dlg-preview').exists()).toBe(true);
    expect(w.find('.dlg-preview').text()).toContain('15');
  });

  it('行内有 加/减/删 三个操作', async () => {
    const w = mount(Portfolio, G);
    await flushPromises();
    const trading = useTradingStore();
    trading.personalHoldings = [{ stock_code: '000001.SZ', shares: 50, avg_cost: 12 }];
    await w.vm.$nextTick();
    const acts = w.findAll('.act-btn').map((b) => b.text());
    expect(acts).toEqual(['加', '减', '删']);
  });
});
