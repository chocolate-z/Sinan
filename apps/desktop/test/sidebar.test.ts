import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Sidebar from '../src/shell/Sidebar.vue';
import { useAppStore } from '../src/stores/app';

const stubs = {
  RouterLink: { template: '<a class="rl"><slot /></a>' },
  Icon: { template: '<svg />' },
};
const mocks = { $router: { push() {} } };

beforeEach(() => setActivePinia(createPinia()));

describe('Sidebar 锁定态(未配置数据源)', () => {
  it('未完成 onboarding:需数据项禁用,总览/设置可用', () => {
    const app = useAppStore();
    app.onboardingDone = false;
    const w = mount(Sidebar, { global: { stubs, mocks } });
    expect(w.text()).toContain('行情');
    // needsData 项在未 onboarding 时禁用(.nav-item.disabled)
    expect(w.findAll('.nav-item.disabled').length).toBeGreaterThan(0);
  });

  it('完成 onboarding:无禁用项', () => {
    const app = useAppStore();
    app.onboardingDone = true;
    const w = mount(Sidebar, { global: { stubs, mocks } });
    expect(w.findAll('.nav-item.disabled').length).toBe(0);
  });
});
