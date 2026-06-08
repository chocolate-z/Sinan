import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Sidebar from '../src/shell/Sidebar.vue';
import { useAppStore } from '../src/stores/app';

const stubs = { RouterLink: { template: '<a class="rl"><slot /></a>' } };

beforeEach(() => setActivePinia(createPinia()));

describe('Sidebar 锁定态(未配置数据源)', () => {
  it('未完成 onboarding:需数据项显示锁,总览/设置可用', () => {
    const app = useAppStore();
    app.onboardingDone = false;
    const w = mount(Sidebar, { global: { stubs } });
    expect(w.text()).toContain('行情');
    expect(w.findAll('.item.locked').length).toBeGreaterThan(0);
    expect(w.html()).toContain('🔒');
  });

  it('完成 onboarding:无锁定项', () => {
    const app = useAppStore();
    app.onboardingDone = true;
    const w = mount(Sidebar, { global: { stubs } });
    expect(w.findAll('.item.locked').length).toBe(0);
  });
});
