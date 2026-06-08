<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';

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
  <div>
    <h1>设置</h1>
    <div class="tabs">
      <RouterLink to="/settings/datasource" :class="{ on: tab === 'datasource' }"
        >数据源</RouterLink
      >
    </div>

    <div v-if="tab === 'datasource'">
      <div v-for="p in app.providers" :key="p.id" class="card">
        <div class="row">
          <strong>{{ p.display_name }}</strong>
          <span
            :class="p.status === 'ok' ? 'status-ok' : p.status === 'error' ? 'status-err' : 'muted'"
          >
            ● {{ p.status }}
          </span>
          <span class="spacer" />
          <button v-if="app.activeProvider !== p.id" class="ghost" @click="setActive(p.id)">
            设为主源
          </button>
          <span v-else class="status-info">主源</span>
        </div>

        <div v-if="p.needs_token" class="creds">
          <template v-if="cred[p.id]?.configured && editing !== p.id">
            <span class="muted">已配置 ••••{{ cred[p.id]?.fingerprint }}</span>
            <button class="ghost" @click="editing = p.id">更换</button>
            <button class="ghost" @click="clearToken(p.id)">清除</button>
          </template>
          <template v-else>
            <input v-model="token" :type="'password'" placeholder="粘贴 token(仅存本机钥匙串)" />
            <button class="primary" @click="saveToken(p.id)">保存</button>
            <button v-if="editing === p.id" class="ghost" @click="editing = null">取消</button>
          </template>
        </div>

        <button class="ghost" @click="test(p.id)">测试连接</button>
      </div>

      <div v-if="testResult.data" class="card">
        <p :class="testResult.data.status === 'ok' ? 'status-ok' : 'status-err'">
          能力探测:{{ testResult.data.status }}
        </p>
        <div class="caps">
          <span
            v-for="[n, ok] in Object.entries(testResult.data.caps)"
            :key="n"
            :class="ok ? 'status-ok' : 'muted'"
          >
            {{ ok ? '✓' : '✗' }} {{ n }}
          </span>
        </div>
        <p v-for="d in testResult.data.degraded" :key="d" class="status-warn">⚠ {{ d }}</p>
      </div>
      <p v-if="testResult.error" class="status-err">{{ testResult.error }}</p>

      <div class="card">
        <h3>本地缓存</h3>
        <p v-if="coverage" class="muted">
          覆盖 {{ coverage.first_date ?? '—' }} ~ {{ coverage.last_date ?? '—' }} ·
          {{ coverage.stock_count }} 只 · {{ coverage.total_rows }} 行
        </p>
        <p v-else class="muted">暂无缓存。请到引导向导建立缓存。</p>
      </div>
    </div>

    <p class="disclaimer">
      你的数据、token、模型全程留在你自己的电脑上,司南不收集、不上传、不上云。
    </p>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
}
.tabs a {
  color: var(--c-text-2);
  text-decoration: none;
}
.tabs a.on {
  color: var(--accent);
  font-weight: 600;
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.spacer {
  flex: 1;
}
.creds {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin: var(--sp-3) 0;
}
.creds input {
  padding: var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  min-width: 280px;
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  font-size: var(--fs-cap);
  margin: var(--sp-2) 0;
}
.primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-3);
  cursor: pointer;
}
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-3);
  cursor: pointer;
}
.muted {
  color: var(--c-text-3);
}
.disclaimer {
  margin-top: var(--sp-4);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
