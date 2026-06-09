<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { THEME_PREFS, themePrefLabel } from '../../lib/theme';

const app = useAppStore();
const route = useRoute();
const tab = computed(() => (route.params.tab as string) ?? 'datasource');

const cred = reactive<Record<string, { configured: boolean; fingerprint: string | null }>>({});
const token = ref('');
const editing = ref<string | null>(null);
const testResult = reactive<{ data: any | null; error: string | null }>({
  data: null,
  error: null,
});
const coverage = ref<any>(null);

async function refresh() {
  await app.refreshProviders();
  for (const p of app.providers) {
    if (p.needs_token) {
      try {
        cred[p.id] = await api.getCredential(p.id);
      } catch {
        cred[p.id] = { configured: false, fingerprint: null };
      }
    }
  }
  try {
    coverage.value = await api.coverage();
  } catch {
    coverage.value = null;
  }
}

async function saveToken(id: string) {
  if (!token.value) return;
  await api.putCredential(id, token.value);
  token.value = '';
  editing.value = null;
  await refresh();
}

async function clearToken(id: string) {
  await api.deleteCredential(id);
  await refresh();
}

async function test(id: string) {
  testResult.data = null;
  testResult.error = null;
  try {
    testResult.data = await api.testProvider(id);
    await app.refreshProviders();
  } catch (e) {
    testResult.error = String(e);
  }
}

async function setActive(id: string) {
  await api.setActiveProvider(id);
  app.activeProvider = id;
}

onMounted(refresh);
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>设置</h1>
    </header>

    <div class="m-segmented tabs">
      <RouterLink to="/settings/datasource" :class="{ on: tab === 'datasource' }"
        >数据源</RouterLink
      >
      <RouterLink to="/settings/appearance" :class="{ on: tab === 'appearance' }">外观</RouterLink>
    </div>

    <!-- 数据源 -->
    <div v-if="tab === 'datasource'">
      <div v-for="p in app.providers" :key="p.id" class="m-card prov">
        <div class="row">
          <strong>{{ p.display_name }}</strong>
          <span
            class="m-badge"
            :class="p.status === 'ok' ? 'status-ok' : p.status === 'error' ? 'status-err' : 'muted'"
          >
            {{ p.status }}
          </span>
          <span class="spacer" />
          <button
            v-if="app.activeProvider !== p.id"
            class="m-btn m-btn--secondary m-btn--sm"
            @click="setActive(p.id)"
          >
            设为主源
          </button>
          <span v-else class="m-chip active-chip">主源</span>
        </div>

        <div v-if="p.needs_token" class="creds">
          <template v-if="cred[p.id]?.configured && editing !== p.id">
            <span class="muted">已配置 ••••{{ cred[p.id]?.fingerprint }}</span>
            <button class="m-btn m-btn--ghost m-btn--sm" @click="editing = p.id">更换</button>
            <button class="m-btn m-btn--ghost m-btn--sm" @click="clearToken(p.id)">清除</button>
          </template>
          <template v-else>
            <input
              v-model="token"
              class="m-field tokenf"
              type="password"
              placeholder="粘贴 token(仅存本机钥匙串)"
            />
            <button class="m-btn m-btn--primary m-btn--sm" @click="saveToken(p.id)">保存</button>
            <button
              v-if="editing === p.id"
              class="m-btn m-btn--ghost m-btn--sm"
              @click="editing = null"
            >
              取消
            </button>
          </template>
        </div>

        <button class="m-btn m-btn--ghost m-btn--sm test-btn" @click="test(p.id)">测试连接</button>
      </div>

      <div v-if="testResult.data" class="m-card">
        <p class="m-badge" :class="testResult.data.status === 'ok' ? 'status-ok' : 'status-err'">
          能力探测:{{ testResult.data.status }}
        </p>
        <div class="caps">
          <span
            v-for="[n, ok] in Object.entries(testResult.data.caps)"
            :key="n"
            class="m-chip"
            :class="ok ? 'cap-on' : 'cap-off'"
          >
            {{ ok ? '✓' : '✗' }} {{ n }}
          </span>
        </div>
        <p v-for="d in testResult.data.degraded" :key="d" class="status-warn deg">⚠ {{ d }}</p>
      </div>
      <p v-if="testResult.error" class="status-err">{{ testResult.error }}</p>

      <div class="m-card">
        <h3>本地缓存</h3>
        <p v-if="coverage" class="muted">
          覆盖 {{ coverage.first_date ?? '—' }} ~ {{ coverage.last_date ?? '—' }} ·
          {{ coverage.stock_count }} 只 · {{ coverage.total_rows }} 行
        </p>
        <p v-else class="muted">暂无缓存。请到引导向导建立缓存。</p>
      </div>
    </div>

    <!-- 外观 -->
    <div v-else-if="tab === 'appearance'">
      <div class="m-card">
        <h3>主题</h3>
        <p class="muted">选择浅色、深色,或跟随操作系统外观。</p>
        <div class="m-segmented theme-seg">
          <button
            v-for="p in THEME_PREFS"
            :key="p"
            :class="{ on: app.themePref === p }"
            @click="app.setThemePref(p)"
          >
            {{ themePrefLabel(p) }}
          </button>
        </div>
      </div>

      <div class="m-card">
        <h3>涨跌配色</h3>
        <p class="muted">
          默认 A 股红涨绿跌(Apple 低饱和);可反转为绿涨红跌。涨跌色与系统蓝严格解耦。
        </p>
        <div class="invert-row">
          <span :class="{ dim: app.pnlInvert }">红涨绿跌</span>
          <label class="m-switch">
            <input
              type="checkbox"
              :checked="app.pnlInvert"
              @change="app.setPnlInvert(($event.target as HTMLInputElement).checked)"
            />
            <span></span>
          </label>
          <span :class="{ dim: !app.pnlInvert }">绿涨红跌</span>
        </div>
        <div class="preview num">
          <span class="pnl-up">▲ +1.23%</span>
          <span class="pnl-down">▼ -0.88%</span>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      你的数据、token、模型全程留在你自己的电脑上,司南不收集、不上传、不上云。
    </p>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-4);
}
.tabs {
  margin-bottom: var(--sp-4);
}
.m-card {
  margin-bottom: var(--sp-3);
}
.prov {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.spacer {
  flex: 1;
}
.active-chip {
  color: var(--accent);
  background: var(--accent-weak);
}
.creds {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  flex-wrap: wrap;
}
.tokenf {
  min-width: 280px;
}
.test-btn {
  align-self: flex-start;
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 var(--sp-2);
}
.cap-on {
  color: var(--st-ok);
}
.cap-off {
  color: var(--c-text-3);
}
.deg {
  font-size: var(--fs-cap);
}
.theme-seg {
  margin-top: var(--sp-2);
}
.invert-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
  font-size: var(--fs-body);
}
.invert-row .dim {
  color: var(--c-text-3);
}
.preview {
  display: flex;
  gap: var(--sp-4);
  margin-top: var(--sp-3);
  font-size: var(--fs-sub);
  font-weight: 600;
}
.muted {
  color: var(--c-text-3);
}
.disclaimer {
  margin-top: var(--sp-5);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
