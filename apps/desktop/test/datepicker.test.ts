import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DatePicker from '../src/ui/DatePicker.vue';

// 仿 Ant Design Vue:面板 Teleport 到 body(测试里 stub teleport 使其内联可查)。
// 'YYYY-MM-DD' v-model 契约 + 日/月/年三级导航(« ‹ 年/月 › »)+ min/max 越界禁用 + 今天。
// 选 2024-06(30 天)做确定性断言。

const G = { global: { stubs: { teleport: true } } };

function mountDP(modelValue = '', props: Record<string, unknown> = {}) {
  return mount(DatePicker, { props: { modelValue, ...props }, ...G });
}

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

describe('DatePicker 触发器', () => {
  it('空值显示 placeholder,有值显示值', () => {
    expect(mountDP('', { placeholder: '选择日期' }).find('.dp-val').text()).toBe('选择日期');
    expect(mountDP('2024-06-15').find('.dp-val').text()).toBe('2024-06-15');
  });

  it('点击触发器开/关面板(Teleport)', async () => {
    const w = mountDP('2024-06-15');
    expect(w.find('.dp-panel').exists()).toBe(false);
    await w.find('.dp-trigger').trigger('click');
    expect(w.find('.dp-panel').exists()).toBe(true);
    await w.find('.dp-trigger').trigger('click');
    expect(w.find('.dp-panel').exists()).toBe(false);
  });

  it('有值时 × 清除 emit 空串', async () => {
    const w = mountDP('2024-06-15');
    expect(w.find('.dp-x').exists()).toBe(true);
    await w.find('.dp-x').trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['']);
  });
});

describe('DatePicker 日视图', () => {
  it('整月网格 42 格;2024-06 有 30 个本月日', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const cells = w.findAll('.dp-day');
    expect(cells.length).toBe(42);
    expect(cells.filter((c) => !c.classes().includes('out')).length).toBe(30);
  });

  it('点击某日 emit YYYY-MM-DD 并关闭', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const inMonth = w.findAll('.dp-day').filter((c) => !c.classes().includes('out'));
    await inMonth[19].trigger('click'); // 第 20 天
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['2024-06-20']);
    expect(w.find('.dp-panel').exists()).toBe(false);
  });

  it('「今天」选中今日并关闭', async () => {
    const w = mountDP('');
    await w.find('.dp-trigger').trigger('click');
    await w.find('.dp-today').trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([todayYmd]);
    expect(w.find('.dp-panel').exists()).toBe(false);
  });

  it('今天有描边环标记', async () => {
    const w = mountDP(''); // 默认视图=当月
    await w.find('.dp-trigger').trigger('click');
    expect(w.findAll('.dp-day.today').length).toBe(1);
  });
});

describe('DatePicker min/max 越界禁用', () => {
  it('仅 [min,max] 内的本月日可选', async () => {
    const w = mountDP('2024-06-15', { min: '2024-06-10', max: '2024-06-20' });
    await w.find('.dp-trigger').trigger('click');
    const enabled = w
      .findAll('.dp-day')
      .filter((c) => !c.classes().includes('out') && !c.classes().includes('dis'));
    expect(enabled.length).toBe(11); // 10..20
  });
});

describe('DatePicker 三级导航(« ‹ 年/月 › »)', () => {
  it('日视图头部显示年/月标签', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const labels = w.findAll('.dp-label');
    expect(labels[0].text()).toBe('2024年');
    expect(labels[1].text()).toBe('6月');
  });

  it('上一月(‹)/上一年(«)改变标签', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const navs = w.findAll('.dp-nav'); // [«上一年, ‹上一月, ›下一月, »下一年]
    await navs[1].trigger('click'); // 上一月 → 5月
    expect(w.findAll('.dp-label')[1].text()).toBe('5月');
    await navs[0].trigger('click'); // 上一年 → 2023年
    expect(w.findAll('.dp-label')[0].text()).toBe('2023年');
  });

  it('点月标签开月视图,选月回到日视图', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    await w.findAll('.dp-label')[1].trigger('click'); // 月标签 → 月视图
    const cells = w.findAll('.dp-cell');
    expect(cells.length).toBe(12);
    await cells[0].trigger('click'); // 一月
    expect(w.findAll('.dp-label')[1].text()).toBe('1月'); // 回日视图
    expect(w.find('.dp-days').exists()).toBe(true);
  });

  it('点年标签开年视图,选年回到月视图', async () => {
    const w = mountDP('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    await w.findAll('.dp-label')[0].trigger('click'); // 年标签 → 年视图
    const cells = w.findAll('.dp-cell');
    expect(cells.length).toBe(12);
    expect(w.find('.dp-label').text()).toBe('2016-2027'); // floor(2024/12)*12=2016
    await cells.find((c) => c.text() === '2025')!.trigger('click');
    expect(w.find('.dp-label').text()).toBe('2025年'); // 回月视图
  });
});
