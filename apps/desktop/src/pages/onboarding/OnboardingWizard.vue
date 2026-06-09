<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ONBOARDING_STEPS } from '@sinan/shared-contracts';
import { api, subscribeJob } from '../../api/client';
import { useAppStore } from '../../stores/app';

// 步骤类型来自契约单一真相源,避免与后端漂移。
type Step = (typeof ONBOARDING_STEPS)[number];

const app = useAppStore();
const router = useRouter();

const step = ref<Step>('welcome');
const provider = ref<'tushare' | 'akshare'>('tushare');
const token = ref('');
const showToken = ref(false);
const quickMode = ref(true);

const testResult = reactive<{ loading: boolean; data: any | null; error: string | null }>({
  loading: false,
  data: null,
  error: null,
});

const build = reactive<{
  jobId: string | null;
  progress: number;
  stage: string;
  message: string;
  status: string;
  error: string | null;
}>({ jobId: null, progress: 0, stage: '', message: '', status: '', error: null });

const needsToken = () => provider.value === 'tushare';

function go(s: Step) {
  step.value = s;
}

async function saveCredentialAndContinue() {
  try {
    await api.setActiveProvider(provider.value);
    if (needsToken() && token.value) {
      await api.putCredential(provider.value, token.value); // 立即加密入钥匙串
    }
    token.value = ''; // 不在前端内存久留
    go('test');
    await runTest();
  } catch (e) {
    testResult.error = String(e);
  }
}

async function runTest() {
  testResult.loading = true;
  testResult.error = null;
  testResult.data = null;
  try {
    testResult.data = await api.testProvider(provider.value);
  } catch (e) {
    testResult.error = String(e);
  } finally {
    testResult.loading = false;
  }
}

const QUICK_CODES = ['600519.SH', '000001.SZ', '600036.SH', '000333.SZ', '601318.SH'];

async function startBuild() {
  go('build_cache');
  build.error = null;
  build.progress = 0;
  build.status = 'running';
  const params: any = {
    universe: quickMode.value
      ? { boards: ['sh', 'sz'], codes: QUICK_CODES }
      : { boards: ['sh', 'sz'] },
    start_year: 2018,
    datasets: ['price', 'adj_factor', 'daily_basic', 'northbound'],
  };
  try {
    const job = await api.createJob({
      type: 'cache_build',
      trigger: 'onboarding',
      provider: provider.value,
      params,
    });
    build.jobId = job.id;
    const stop = subscribeJob(
      job.id,
      (ev) => {
        if (typeof ev.progress === 'number') build.progress = ev.progress;
        if (ev.stage) build.stage = ev.stage;
        if (ev.message) build.message = ev.message;
        if (ev.status) build.status = ev.status;
        if (ev.status === 'done' || ev.status === 'failed' || ev.status === 'canceled') {
          stop();
          if (ev.status === 'done') go('done');
          if (ev.status === 'failed') build.error = ev.message ?? '建缓存失败';
        }
      },
      () => {
        build.error = '进度连接中断';
      },
    );
  } catch (e) {
    build.error = String(e);
  }
}

async function finish() {
  await api.onboardingComplete();
  await app.bootstrap();
  router.push('/dashboard');
}

function capEntries(caps: Record<string, boolean>) {
  return Object.entries(caps);
}
</script>

<template>
  <div class="wizard-stage">
    <div class="m-panel wizard">
      <!-- 步骤进度条:圆点 + 连接线,当前/已过步用系统蓝 -->
      <nav class="stepper">
        <span class="step" :class="{ on: step === 'welcome' }">
          <span class="dot" /><span class="lbl">欢迎</span>
        </span>
        <span class="link" />
        <span class="step" :class="{ on: step === 'select_source' }">
          <span class="dot" /><span class="lbl">选数据源</span>
        </span>
        <span class="link" />
        <span class="step" :class="{ on: step === 'credential' }">
          <span class="dot" /><span class="lbl">填凭据</span>
        </span>
        <span class="link" />
        <span class="step" :class="{ on: step === 'test' }">
          <span class="dot" /><span class="lbl">测试连接</span>
        </span>
        <span class="link" />
        <span class="step" :class="{ on: step === 'build_cache' }">
          <span class="dot" /><span class="lbl">建缓存</span>
        </span>
        <span class="link" />
        <span class="step" :class="{ on: step === 'done' }">
          <span class="dot" /><span class="lbl">完成</span>
        </span>
      </nav>

      <!-- 欢迎 -->
      <section v-if="step === 'welcome'" class="pane">
        <h1>司南 Sinan</h1>
        <p class="lead">全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
        <div class="promises">
          <span class="m-chip">🖥 全本机运行</span>
          <span class="m-chip">🔑 BYO 自带数据源</span>
          <span class="m-chip">🔒 凭据加密</span>
        </div>
        <div class="actions end">
          <button class="m-btn m-btn--primary" @click="go('select_source')">开始 →</button>
        </div>
      </section>

      <!-- 选数据源 -->
      <section v-else-if="step === 'select_source'" class="pane">
        <h2>选择你自己的数据来源</h2>
        <p class="m-muted lead">
          司南不提供数据。Tushare Pro 能力最全(需自备 token);AkShare 免费但字段受限。
        </p>
        <div class="sources">
          <label class="m-card source" :class="{ sel: provider === 'tushare' }">
            <input v-model="provider" type="radio" value="tushare" class="src-radio" />
            <span class="src-body">
              <strong>Tushare Pro</strong>
              <span class="m-muted">财务/北向/估值/复权/指数 全能力,需 token</span>
            </span>
          </label>
          <label class="m-card source" :class="{ sel: provider === 'akshare' }">
            <input v-model="provider" type="radio" value="akshare" class="src-radio" />
            <span class="src-body">
              <strong>AkShare(免费)</strong>
              <span class="m-muted">价量/指数,无北向/财务 —— 样本外预期更低</span>
            </span>
          </label>
        </div>
        <div class="actions end">
          <button class="m-btn m-btn--primary" @click="go('credential')">下一步 →</button>
        </div>
      </section>

      <!-- 填凭据 -->
      <section v-else-if="step === 'credential'" class="pane">
        <h2>填入凭据</h2>
        <template v-if="needsToken()">
          <label class="field">
            <span class="field-lbl">Tushare Token</span>
            <div class="token-row">
              <input
                v-model="token"
                class="m-field token-input"
                :type="showToken ? 'text' : 'password'"
                placeholder="粘贴你的 Tushare token"
              />
              <button class="m-btn m-btn--ghost" @click="showToken = !showToken">
                {{ showToken ? '隐藏' : '显示' }}
              </button>
            </div>
          </label>
          <p class="m-muted hint">🔒 token 仅加密存本机系统钥匙串,绝不上传、绝不落明文。</p>
        </template>
        <p v-else class="m-muted hint">AkShare 免费源无需 token。</p>
        <div class="actions end">
          <button
            class="m-btn m-btn--primary"
            :disabled="needsToken() && !token"
            @click="saveCredentialAndContinue"
          >
            保存并测试连接 →
          </button>
        </div>
      </section>

      <!-- 测试连接 -->
      <section v-else-if="step === 'test'" class="pane">
        <h2>测试连接</h2>
        <p v-if="testResult.loading" class="m-muted">正在探测能力与限频…</p>
        <p v-else-if="testResult.error" class="m-badge status-err">
          连接失败:{{ testResult.error }}
        </p>
        <template v-else-if="testResult.data">
          <p class="m-badge" :class="testResult.data.status === 'ok' ? 'status-ok' : 'status-err'">
            {{ testResult.data.status === 'ok' ? '连接成功' : '连接异常' }}
            <span v-if="testResult.data.message">— {{ testResult.data.message }}</span>
          </p>
          <div class="caps">
            <span
              v-for="[name, ok] in capEntries(testResult.data.caps)"
              :key="name"
              class="m-chip"
              :class="ok ? 'cap-on' : 'cap-off'"
              >{{ ok ? '✓' : '✗' }} {{ name }}</span
            >
          </div>
          <p v-for="d in testResult.data.degraded" :key="d" class="m-badge status-warn deg">
            ⚠ {{ d }}
          </p>
        </template>
        <div class="actions">
          <button class="m-btn m-btn--ghost" @click="go('credential')">返回</button>
          <button class="m-btn m-btn--ghost" @click="runTest">重测</button>
          <span class="spacer" />
          <button
            class="m-btn m-btn--primary"
            :disabled="!testResult.data || testResult.data.status !== 'ok'"
            @click="go('build_cache')"
          >
            下一步:建缓存 →
          </button>
        </div>
      </section>

      <!-- 建缓存 -->
      <section v-else-if="step === 'build_cache'" class="pane">
        <h2>建立本地数据缓存(全程在你的电脑上)</h2>
        <label class="quick">
          <span class="m-switch">
            <input v-model="quickMode" type="checkbox" />
            <span></span>
          </span>
          <span class="quick-lbl">快速模式(少量股票,先跑通)</span>
        </label>
        <div v-if="!build.jobId" class="actions">
          <button class="m-btn m-btn--primary" @click="startBuild">开始建缓存</button>
        </div>
        <div v-else class="progress">
          <div class="bar">
            <div class="fill" :style="{ width: (build.progress * 100).toFixed(0) + '%' }" />
          </div>
          <p class="m-muted progress-meta">
            <span class="num">{{ (build.progress * 100).toFixed(0) }}%</span>
            · {{ build.stage }} · {{ build.message }}
          </p>
          <p v-if="build.error" class="m-badge status-err">{{ build.error }}</p>
        </div>
      </section>

      <!-- 完成 -->
      <section v-else-if="step === 'done'" class="pane">
        <div class="done-mark">✓</div>
        <h2>完成</h2>
        <p class="lead">
          本地缓存已建立。你现在可以浏览总览,后续里程碑将解锁因子打分、信号与模拟盘。
        </p>
        <div class="actions end">
          <button class="m-btn m-btn--primary" @click="finish">进入司南 →</button>
        </div>
      </section>

      <hr class="m-divider" />

      <p class="disclaimer">
        司南仅供研究参考,不构成投资建议;模拟盘为纸面前向验证,不进行任何真实下单。
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 整页居中铺底:柔和径向渐变,衬托浮起的面板 */
.wizard-stage {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6) var(--sp-4);
  background:
    radial-gradient(120% 90% at 50% -10%, var(--accent-weak) 0%, transparent 55%), var(--c-bg);
}
.wizard {
  width: 100%;
  max-width: 560px;
  padding: var(--sp-6);
}

/* ── 步骤进度条 ───────────────────────────────────────────── */
.stepper {
  display: flex;
  align-items: center;
  margin-bottom: var(--sp-6);
}
.step {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  font-weight: 500;
  transition: color var(--dur) var(--ease);
}
.step .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c-border-strong);
  flex: none;
  transition:
    background var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease-spring);
}
.step.on {
  color: var(--accent);
}
.step.on .dot {
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-weak);
  transform: scale(1.05);
}
.step .lbl {
  white-space: nowrap;
}
.link {
  flex: 1;
  height: 1px;
  min-width: 8px;
  background: var(--c-hairline);
  margin: 0 var(--sp-2);
}

/* ── 内容 pane ────────────────────────────────────────────── */
.pane {
  min-height: 200px;
}
.pane h1 {
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 var(--sp-3);
}
.pane h2 {
  font-size: var(--fs-h2);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 var(--sp-3);
}
.lead {
  color: var(--c-text-2);
  font-size: var(--fs-sub);
  line-height: 1.5;
  margin: 0 0 var(--sp-4);
}

.promises {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-4) 0 var(--sp-5);
}

/* ── 数据源选择卡 ─────────────────────────────────────────── */
.sources {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: var(--sp-4) 0 var(--sp-5);
}
.source {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  cursor: pointer;
  border: 1px solid var(--c-border);
  transition:
    border-color var(--dur-fast) var(--ease),
    background var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease);
}
.source:hover {
  border-color: var(--c-border-strong);
}
.source.sel {
  border-color: var(--accent);
  background: var(--accent-weak);
  box-shadow: 0 0 0 1px var(--accent);
}
.src-radio {
  margin-top: 2px;
  accent-color: var(--accent);
  flex: none;
}
.src-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.src-body strong {
  font-size: var(--fs-sub);
  font-weight: 600;
}

/* ── 凭据表单 ─────────────────────────────────────────────── */
.field {
  display: block;
  margin: var(--sp-4) 0 var(--sp-3);
}
.field-lbl {
  display: block;
  font-size: var(--fs-cap);
  font-weight: 500;
  color: var(--c-text-2);
  margin-bottom: var(--sp-2);
}
.token-row {
  display: flex;
  gap: var(--sp-2);
}
.token-input {
  flex: 1;
}
.hint {
  font-size: var(--fs-cap);
}

/* ── 能力探测标签 ─────────────────────────────────────────── */
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-3) 0;
}
.cap-on {
  color: var(--st-ok);
}
.cap-off {
  color: var(--c-text-3);
}
.deg {
  margin-top: var(--sp-2);
}

/* ── 建缓存 ───────────────────────────────────────────────── */
.quick {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: var(--sp-3) 0 var(--sp-5);
  cursor: pointer;
}
.quick-lbl {
  font-size: var(--fs-body);
  color: var(--c-text);
}
.progress {
  margin-top: var(--sp-4);
}
.bar {
  height: 8px;
  background: var(--c-surface-2);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width var(--dur) var(--ease);
}
.progress-meta {
  margin-top: var(--sp-3);
  font-size: var(--fs-cap);
}

/* ── 完成 ─────────────────────────────────────────────────── */
.done-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent-weak);
  color: var(--accent);
  font-size: 24px;
  font-weight: 700;
  margin-bottom: var(--sp-3);
}

/* ── 操作区 ───────────────────────────────────────────────── */
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}
.actions.end {
  justify-content: flex-end;
}
.spacer {
  flex: 1;
}

.disclaimer {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  line-height: 1.5;
  margin: 0;
}
</style>
