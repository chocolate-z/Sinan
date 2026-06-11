import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RangePicker from '../src/ui/RangePicker.vue';

// 仿 AntD RangePicker:单框 [start,end] + 双月面板(Teleport,测试 stub 内联)+ 区间选择 + min/max。
const G = { global: { stubs: { teleport: true } } };
function mountRP(modelValue: [string, string] = ['', ''], props: Record<string, unknown> = {}) {
  return mount(RangePicker, { props: { modelValue, ...props }, ...G });
}
const leftInMonth = (w: ReturnType<typeof mountRP>) =>
  w
    .findAll('.rp-month')[0]
    .findAll('.rp-day')
    .filter((c) => !c.classes().includes('out'));

describe('RangePicker 触发器', () => {
  it('空值显示双 placeholder,有值显示区间', () => {
    const segs = mountRP(['', ''], { placeholderStart: '开始', placeholderEnd: '结束' }).findAll(
      '.rp-seg',
    );
    expect(segs[0].text()).toBe('开始');
    expect(segs[1].text()).toBe('结束');
    const v = mountRP(['2024-06-10', '2024-06-20']).findAll('.rp-seg');
    expect(v[0].text()).toBe('2024-06-10');
    expect(v[1].text()).toBe('2024-06-20');
  });

  it('点击开/关面板', async () => {
    const w = mountRP(['2024-06-10', '2024-06-20']);
    expect(w.find('.rp-panel').exists()).toBe(false);
    await w.find('.rp-trigger').trigger('click');
    expect(w.find('.rp-panel').exists()).toBe(true);
  });

  it('× 清除 emit 空区间', async () => {
    const w = mountRP(['2024-06-10', '2024-06-20']);
    await w.find('.rp-x').trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['', '']]);
  });
});

describe('RangePicker 双月面板', () => {
  it('双月共 84 天格;左月 2024-06 有 30 个本月日', async () => {
    const w = mountRP(['2024-06-10', '2024-06-20']);
    await w.find('.rp-trigger').trigger('click');
    expect(w.findAll('.rp-day').length).toBe(84);
    expect(leftInMonth(w).length).toBe(30);
  });

  it('头部:左年/月标签 + 右月静态标签', async () => {
    const w = mountRP(['2024-06-10', '2024-06-20']);
    await w.find('.rp-trigger').trigger('click');
    const labels = w.findAll('.rp-label');
    expect(labels[0].text()).toBe('2024年');
    expect(labels[1].text()).toBe('6月');
    expect(labels[2].text()).toContain('2024年 7月');
  });
});

describe('RangePicker 区间选择', () => {
  it('两次点击 emit 升序区间并关闭', async () => {
    const w = mountRP(['2024-06-01', '2024-06-05']); // 视图锚定 2024-06
    await w.find('.rp-trigger').trigger('click');
    await leftInMonth(w)[9].trigger('click'); // 6/10
    await leftInMonth(w)[19].trigger('click'); // 6/20
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['2024-06-10', '2024-06-20']]);
    expect(w.find('.rp-panel').exists()).toBe(false);
  });

  it('反向选择(先晚后早)自动交换', async () => {
    const w = mountRP(['2024-06-01', '2024-06-05']);
    await w.find('.rp-trigger').trigger('click');
    await leftInMonth(w)[19].trigger('click'); // 6/20 先点
    await leftInMonth(w)[9].trigger('click'); // 6/10 后点 → 交换
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['2024-06-10', '2024-06-20']]);
  });
});

describe('RangePicker min/max', () => {
  it('仅 [min,max] 内本月日可选', async () => {
    const w = mountRP(['2024-06-15', '2024-06-15'], { min: '2024-06-10', max: '2024-06-20' });
    await w.find('.rp-trigger').trigger('click');
    const enabled = leftInMonth(w).filter((c) => !c.classes().includes('dis'));
    expect(enabled.length).toBe(11); // 10..20
  });
});
