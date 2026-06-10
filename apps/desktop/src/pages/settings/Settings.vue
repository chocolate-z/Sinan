<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { THEME_PREFS, themePrefLabel } from '../../lib/theme';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

const app = useAppStore();
const router = useRouter();

// 选中用于查看/编辑凭据与能力的数据源(默认主源或首个)。
const selectedId = ref<string | null>(null);
const token = ref('');
const editing = ref<string | null>(null);
const cred = reactive<Record<string, { configured: boolean; fingerprint: string | null }>>({});
const testState = reactive<{
  loading: boolean;
  data: any | null;
  error: string | null;
  for: string | null;
}>({ loading: false, data: null, error: null, for: null });
const coverage = ref<any>(null);
const settings = ref<Record<string, unknown> | null>(null);

const selected = computed(
  () => app.providers.find((p) => p.id === selectedId.value) ?? app.providers[0] ?? null,
);
const selectedCred = computed(() =>
  selected.value ? cred[selected.value.id] : { configured: false, fingerprint: null },
);
// 能力探测结果仅在「针对当前选中源测试过」时展示,避免串源误导。
const caps = computed(() =>
  testState.for && selected.value && testState.for === selected.value.id ? testState.data : null,
);

// 能力枚举名 → 中文标签(key 与 engine Capability 枚举一致;未列出的回退原名)。
const CAP_LABELS: Record<string, string> = {
  DAILY_OHLCV: '日线行情',
  ADJ_FACTOR: '复权因子',
  DAILY_BASIC: '每日指标',
  FUNDAMENTAL: '财务数据',
  FINA_INDICATOR: '财务指标',
  NORTHBOUND: '北向资金',
  INDEX_OHLCV: '指数行情',
  INDEX_WEIGHT: '指数成分',
  SW_INDUSTRY: '申万行业',
  EARNINGS_FORECAST: '业绩预告',
  TRADE_CAL: '交易日历',
  REALTIME_QUOTE: '实时报价',
};
function capLabel(k: string): string {
  return CAP_LABELS[k] ?? k;
}

const refreshInterval = computed(() => {
  const v = settings.value?.refresh_interval as number | undefined;
  return v == null ? null : v;
});
const dailyRunTime = computed(() => (settings.value?.daily_run_time as string | undefined) ?? null);

async function refresh() {
  await app.refreshProviders();
  if (!selectedId.value) selectedId.value = app.activeProvider ?? app.providers[0]?.id ?? null;
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
  try {
    settings.value = await api.settings();
  } catch {
    settings.value = null;
  }
}

function selectProvider(id: string) {
  selectedId.value = id;
  token.value = '';
  editing.value = null;
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
  testState.loading = true;
  testState.error = null;
  testState.data = null;
  testState.for = id;
  try {
    testState.data = await api.testProvider(id);
    await app.refreshProviders();
  } catch (e) {
    testState.error = String(e);
  } finally {
    testState.loading = false;
  }
}

async function setActive(id: string) {
  await api.setActiveProvider(id);
  app.activeProvider = id;
}

function providerStatusKind(p: any): 'ok' | 'err' | 'idle' {
  return p.status === 'ok' ? 'ok' : p.status === 'error' ? 'err' : 'idle';
}

onMounted(refresh);
</script>

<template>
  <PageHero title="设置" sub="数据源、外观与隐私 · 所有数据、凭据、模型均只存于本机" />

  <div class="page-body">
    <!-- ── 数据源 ───────────────────────────────────────────── -->
    <section>
      <div class="sec-label">数据源</div>
      <div class="glist ds-pad">
        <!-- provider 卡片网格 -->
        <div class="prov-grid">
          <button
            v-for="p in app.providers"
            :key="p.id"
            class="prov-card"
            :class="{ sel: selected?.id === p.id }"
            @click="selectProvider(p.id)"
          >
            <div class="prov-top">
              <span class="prov-ic" :class="{ on: selected?.id === p.id }"
                ><Icon name="db" :size="16"
              /></span>
              <span v-if="app.activeProvider === p.id" class="badge badge-ok"
                ><span class="dot" />主源</span
              >
              <span
                v-else-if="p.status === 'ok'"
                class="badge"
                :class="`badge-${providerStatusKind(p)}`"
                ><span class="dot" />已连接</span
              >
            </div>
            <div>
              <div class="prov-name">{{ p.display_name }}</div>
              <div class="prov-desc">{{ p.needs_token ? '需自备 token' : '免费 · 公开行情' }}</div>
            </div>
          </button>
        </div>

        <template v-if="selected">
          <!-- token(仅需 token 的源)-->
          <template v-if="selected.needs_token">
            <label class="field-label">API Token · {{ selected.display_name }}</label>
            <div class="token-row">
              <template v-if="selectedCred?.configured && editing !== selected.id">
                <div class="input mono token-masked">
                  已配置 · 指纹 ••••{{ selectedCred?.fingerprint ?? '----' }}
                </div>
                <button class="btn btn-secondary" @click="editing = selected.id">更换</button>
                <button class="btn btn-ghost" @click="clearToken(selected.id)">清除</button>
              </template>
              <template v-else>
                <input
                  v-model="token"
                  class="input mono"
                  type="password"
                  placeholder="粘贴 token(仅加密存本机系统钥匙串)"
                />
                <button class="btn btn-primary" :disabled="!token" @click="saveToken(selected.id)">
                  保存
                </button>
                <button
                  v-if="editing === selected.id"
                  class="btn btn-ghost"
                  @click="editing = null"
                >
                  取消
                </button>
              </template>
            </div>
          </template>
          <div v-else class="free-note">
            <Icon name="check" :size="13" /> 免费源无需 token,直接测试连通即可。
          </div>

          <div class="test-row">
            <button
              class="btn btn-secondary"
              :disabled="testState.loading"
              @click="test(selected.id)"
            >
              <Icon name="refresh" :size="13" /> {{ testState.loading ? '测试中…' : '测试连通' }}
            </button>
            <span v-if="app.activeProvider !== selected.id" class="muted">
              <button class="btn btn-ghost btn-sm" @click="setActive(selected.id)">设为主源</button>
            </span>
            <span v-else class="badge badge-idle"><span class="dot" />当前主源</span>
          </div>

          <!-- 能力探测网格 -->
          <div class="probe">
            <div class="cap probe-title">能力探测</div>
            <div v-if="testState.error" class="probe-err">
              <Icon name="alert" :size="13" /> {{ testState.error }}
            </div>
            <div v-else-if="caps" class="probe-grid">
              <div v-for="[k, ok] in Object.entries(caps.caps ?? {})" :key="k" class="probe-item">
                <span class="probe-k">{{ capLabel(k) }}</span>
                <span v-if="ok" class="probe-ok"><Icon name="check" :size="12" /> 可用</span>
                <span v-else class="probe-off">未授权</span>
              </div>
            </div>
            <p v-else class="probe-empty">点击「测试连通」后,在此显示该源的能力与限频。</p>
            <div v-if="caps?.degraded?.length" class="probe-deg">
              <span v-for="d in caps.degraded" :key="d" class="badge badge-warn"
                ><span class="dot" />{{ d }}</span
              >
            </div>
          </div>

          <!-- 本地缓存(真实覆盖,无则诚实空)-->
          <div class="cache-bar">
            <span class="cache-info">
              <template v-if="coverage && coverage.stock_count">
                本地缓存 · 覆盖 {{ coverage.first_date ?? '—' }} ~ {{ coverage.last_date ?? '—' }} ·
                {{ coverage.stock_count }} 只 · {{ coverage.total_rows }} 行
              </template>
              <template v-else>本地暂无缓存 —— 到引导向导建立(可断点续传)。</template>
            </span>
            <button class="btn btn-ghost btn-sm" @click="router.push('/onboarding')">
              <Icon name="refresh" :size="12" />
              {{ coverage?.stock_count ? '重建缓存' : '去建缓存' }}
            </button>
          </div>
        </template>
        <div v-else class="empty">
          <div class="empty-icon"><Icon name="db" :size="20" /></div>
          <div class="empty-title">尚未发现可用数据源</div>
          <div class="empty-desc">请确认 api 服务已启动,或到引导向导完成首启配置。</div>
        </div>
      </div>
    </section>

    <!-- ── 数据更新(只读展示真实配置值)──────────────────────── -->
    <section>
      <div class="sec-label">数据更新</div>
      <div class="glist">
        <div class="grow">
          <div class="row-main">
            <div class="row-label">数据覆盖至</div>
            <div class="row-desc">本地缓存中最新一个交易日(由盘后落库更新)</div>
          </div>
          <span class="row-side">
            <span v-if="coverage?.last_date" class="live-dot" />
            <span class="mono row-val">{{ coverage?.last_date ?? '暂无数据' }}</span>
            <button class="btn btn-sm btn-secondary" @click="refresh">
              <Icon name="refresh" :size="12" /> 刷新
            </button>
          </span>
        </div>
        <div class="grow">
          <div class="row-main">
            <div class="row-label">自动刷新频率</div>
            <div class="row-desc">盘中行情自动拉取间隔(打包默认 / SQLite 设置)</div>
          </div>
          <span class="badge badge-idle"
            ><span class="dot" />{{
              refreshInterval == null ? '—' : `每 ${refreshInterval} 分钟`
            }}</span
          >
        </div>
        <div class="grow">
          <div class="row-main">
            <div class="row-label">盘后数据落库</div>
            <div class="row-desc">每个交易日收盘后自动下载日线与基本面</div>
          </div>
          <span class="badge badge-ok"
            ><span class="dot" />{{ dailyRunTime ? `${dailyRunTime} 自动` : '已启用' }}</span
          >
        </div>
      </div>
    </section>

    <!-- ── 外观(完全可用:主题三态 + 涨跌反转)─────────────────── -->
    <section>
      <div class="sec-label">外观</div>
      <div class="glist">
        <div class="grow">
          <div class="row-main">
            <div class="row-label">主题</div>
            <div class="row-desc">深色为默认 · 可跟随系统自动切换</div>
          </div>
          <div class="segmented">
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
        <div class="grow">
          <div class="row-main">
            <div class="row-label">涨跌配色</div>
            <div class="row-desc">
              A股惯例为红涨绿跌 · 可反转为欧美惯例(绿涨红跌)· 与系统蓝严格解耦
            </div>
          </div>
          <div class="invert-side">
            <span class="preview">
              <span class="pv mono pnl-up">+1.82%</span>
              <span class="pv mono pnl-down">-1.13%</span>
            </span>
            <span class="invert-toggle">
              <span class="it-lbl" :class="{ dim: app.pnlInvert }">红涨绿跌</span>
              <input
                class="switch"
                type="checkbox"
                :checked="app.pnlInvert"
                @change="app.setPnlInvert(($event.target as HTMLInputElement).checked)"
              />
              <span class="it-lbl" :class="{ dim: !app.pnlInvert }">绿涨红跌</span>
            </span>
          </div>
        </div>
        <div class="grow">
          <div class="row-main">
            <div class="row-label">数字字体</div>
            <div class="row-desc">金额与代码使用等宽 tabular 字体保证列对齐</div>
          </div>
          <span class="badge badge-ok"><span class="dot" />已启用等宽对齐</span>
        </div>
      </div>
    </section>

    <!-- ── 隐私与本地化(诚实的产品事实,非可点开关)──────────────── -->
    <section>
      <div class="sec-label">隐私与本地化</div>
      <div class="glist">
        <div class="grow">
          <div class="row-main">
            <div class="row-label">数据本地存储</div>
            <div class="row-desc">
              所有缓存、账本、模型存于本机 $APPDATA;司南不上传任何持仓或交易数据
            </div>
          </div>
          <span class="badge badge-ok"><span class="dot" />仅本机</span>
        </div>
        <div class="grow">
          <div class="row-main">
            <div class="row-label">凭据存储</div>
            <div class="row-desc">数据源 token 仅加密入操作系统钥匙串,绝不落明文、绝不上传</div>
          </div>
          <span class="badge badge-ok"><span class="dot" />OS 钥匙串</span>
        </div>
        <div class="grow">
          <div class="row-main">
            <div class="row-label">外联</div>
            <div class="row-desc">除你自配的数据源与签名更新外,零外联;CSP 仅放行本机回环</div>
          </div>
          <span class="badge badge-idle"><span class="dot" />零外联</span>
        </div>
      </div>
    </section>

    <p class="disclaimer">
      司南是研究与纪律辅助工具,不构成任何投资建议。你的数据、token、模型全程留在你自己的电脑上。
    </p>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.muted {
  color: var(--text-3);
}

/* ── 数据源 ────────────────────────────────────────────────── */
.ds-pad {
  padding: 18px;
}
.prov-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}
.prov-card {
  text-align: left;
  cursor: pointer;
  padding: 14px;
  border-radius: var(--r-md);
  background: var(--bg-panel-2);
  border: 0.5px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    background var(--t-fast),
    border-color var(--t-fast);
}
.prov-card:hover {
  border-color: var(--border-strong);
}
.prov-card.sel {
  background: var(--accent-bg);
  border-color: var(--accent);
}
.prov-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
}
.prov-ic {
  display: inline-flex;
  color: var(--text-3);
}
.prov-ic.on {
  color: var(--accent);
}
.prov-name {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--text-1);
}
.prov-desc {
  font-size: 11.5px;
  color: var(--text-2);
  margin-top: 3px;
}

.token-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
}
.token-row .input {
  flex: 1;
}
.token-masked {
  display: flex;
  align-items: center;
  color: var(--text-2);
  cursor: default;
}
.free-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sub);
  color: var(--status-ok);
  margin-bottom: 16px;
}
.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.probe {
  background: var(--bg-panel-2);
  border-radius: var(--r-md);
  border: 0.5px solid var(--border);
  padding: 16px;
}
.probe-title {
  margin-bottom: 12px;
}
.probe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 11px 32px;
}
.probe-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-sub);
}
.probe-k {
  color: var(--text-2);
}
.probe-ok {
  color: var(--status-ok);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-cap);
}
.probe-off {
  color: var(--text-3);
  font-size: var(--fs-cap);
}
.probe-empty {
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--text-3);
}
.probe-err {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sub);
  color: var(--status-err);
}
.probe-deg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.cache-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 0.5px solid var(--border);
}
.cache-info {
  font-size: 11.5px;
  color: var(--text-3);
}

/* ── 分组列表行(数据更新 / 隐私)──────────────────────────────── */
.row-main {
  min-width: 0;
}
.row-label {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--text-1);
}
.row-desc {
  font-size: 11.5px;
  color: var(--text-2);
  margin-top: 3px;
  line-height: 1.5;
}
.row-side {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.row-val {
  font-size: 12.5px;
  color: var(--text-1);
}

/* ── 外观 ──────────────────────────────────────────────────── */
.invert-side {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
}
.preview {
  display: flex;
  gap: 6px;
}
.pv {
  font-size: var(--fs-sub);
  background: var(--bg-panel-2);
  padding: 3px 8px;
  border-radius: var(--r-xs);
}
.invert-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
}
.it-lbl {
  font-size: var(--fs-sub);
  color: var(--text-1);
}
.it-lbl.dim {
  color: var(--text-3);
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}
</style>
