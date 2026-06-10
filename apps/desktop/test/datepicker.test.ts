import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DatePicker from '../src/ui/DatePicker.vue';

// 'YYYY-MM-DD' v-model 契约 + 三级(日/月/年)导航 + min/max 越界禁用 + 今天圆点。
// 选 2024-06(30 天)做确定性断言。

function openOn(modelValue = '', props: Record<string, unknown> = {}) {
  const w = mount(DatePicker, { props: { modelValue, ...props } });
  return w;
}

describe('DatePicker 触发器', () => {
  it('空值显示 placeholder,有值显示值', () => {
    expect(mount(DatePicker, { props: { placeholder: '选择日期' } }).text()).toContain('选择日期');
    expect(mount(DatePicker, { props: { modelValue: '2024-06-15' } }).text()).toContain(
      '2024-06-15',
    );
  });

  it('点击触发器开/关弹层', async () => {
    const w = openOn('2024-06-15');
    expect(w.find('.dp-pop').exists()).toBe(false);
    await w.find('.dp-trigger').trigger('click');
    expect(w.find('.dp-pop').exists()).toBe(true);
    await w.find('.dp-trigger').trigger('click');
    expect(w.find('.dp-pop').exists()).toBe(false);
  });
});

describe('DatePicker 日视图', () => {
  it('整月网格 42 格;2024-06 有 30 个本月日', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const cells = w.findAll('.dp-day');
    expect(cells.length).toBe(42);
    const inMonth = cells.filter((c) => !c.classes().includes('out'));
    expect(inMonth.length).toBe(30);
  });

  it('点击某日 emit YYYY-MM-DD 并关闭', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    const inMonth = w.findAll('.dp-day').filter((c) => !c.classes().includes('out'));
    await inMonth[19].trigger('click'); // 第 20 天
    const emitted = w.emitted('update:modelValue');
    expect(emitted?.at(-1)).toEqual(['2024-06-20']);
    expect(w.find('.dp-pop').exists()).toBe(false);
  });

  it('清除 emit 空串', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    await w.findAll('.dp-act')[0].trigger('click'); // 清除
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['']);
  });

  it('今天有圆点标记', async () => {
    const w = openOn(''); // 默认视图=当月
    await w.find('.dp-trigger').trigger('click');
    expect(w.findAll('.dp-dot').length).toBeGreaterThanOrEqual(1);
  });
});

describe('DatePicker min/max 越界禁用', () => {
  it('仅 [min,max] 内的本月日可选', async () => {
    const w = openOn('2024-06-15', { min: '2024-06-10', max: '2024-06-20' });
    await w.find('.dp-trigger').trigger('click');
    const enabledInMonth = w
      .findAll('.dp-day')
      .filter((c) => !c.classes().includes('out') && !c.classes().includes('dis'));
    expect(enabledInMonth.length).toBe(11); // 10..20
  });
});

describe('DatePicker 三级导航', () => {
  it('上/下月切换改变标题', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    expect(w.find('.dp-title').text()).toContain('2024 年 06 月');
    await w.findAll('.dp-nav')[0].trigger('click'); // 上月
    expect(w.find('.dp-title').text()).toContain('2024 年 05 月');
    await w.findAll('.dp-nav')[1].trigger('click'); // 下月 → 回 06
    await w.findAll('.dp-nav')[1].trigger('click'); // 07
    expect(w.find('.dp-title').text()).toContain('2024 年 07 月');
  });

  it('标题点开月视图,选月回到日视图', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    await w.find('.dp-title').trigger('click');
    const months = w.findAll('.dp-mgrid .dp-cell');
    expect(months.length).toBe(12);
    await months[0].trigger('click'); // 一月
    expect(w.find('.dp-title').text()).toContain('2024 年 01 月');
    expect(w.find('.dp-grid').exists()).toBe(true); // 回日视图
  });

  it('标题点两次开年视图,选年回到月视图', async () => {
    const w = openOn('2024-06-15');
    await w.find('.dp-trigger').trigger('click');
    await w.find('.dp-title').trigger('click'); // → 月
    await w.find('.dp-title').trigger('click'); // → 年
    const years = w.findAll('.dp-mgrid .dp-cell');
    expect(years.length).toBe(12);
    expect(w.find('.dp-title').text()).toContain('2016 – 2027'); // floor(2024/12)*12=2016
    await years.find((y) => y.text() === '2025')!.trigger('click');
    expect(w.find('.dp-title').text()).toContain('2025 年'); // 回月视图
  });
});
