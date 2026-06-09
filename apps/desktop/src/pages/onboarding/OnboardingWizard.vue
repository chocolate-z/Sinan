<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ONBOARDING_STEPS } from '@sinan/shared-contracts';
import { api, subscribeJob } from '../../api/client';
import { useAppStore } from '../../stores/app';
import Icon from '../../shell/Icon.vue';

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

// 步骤进度条展示用:把状态机映射为有序步骤(纯派生,不改流程)。
const STEPPER: { key: Step; label: string }[] = [
  { key: 'welcome', label: '欢迎' },
  { key: 'select_source', label: '选数据源' },
  { key: 'credential', label: '填凭据' },
  { key: 'test', label: '测试连接' },
  { key: 'build_cache', label: '建缓存' },
  { key: 'done', label: '完成' },
];
const stepIndex = computed(() => STEPPER.findIndex((s) => s.key === step.value));
const buildPct = computed(() => Math.round(build.progress * 100));
</script>

<template>
  <div class="wizard-stage main-aurora">
    <div class="wizard">
      <!-- 品牌:紫渐变罗盘 logo + 标题 -->
      <header class="brand">
        <div class="brand-logo"><Icon name="compass" :size="28" /></div>
        <h1 class="brand-title">欢迎使用 司南 Sinan</h1>
        <p class="brand-sub">诚实、纪律化、可解释的本机量化研究工具</p>
      </header>

      <!-- 步骤进度条:编号圆点 + 连接线,当前步 accent,已过步打勾 -->
      <nav class="stepper">
        <template v-for="(s, i) in STEPPER" :key="s.key">
          <span
            class="step"
            :class="{ done: i < stepIndex, on: i === stepIndex }"
            :aria-current="i === stepIndex ? 'step' : undefined"
          >
            <span class="node">
              <Icon v-if="i < stepIndex" name="check" :size="13" />
              <span v-else>{{ i + 1 }}</span>
            </span>
            <span class="lbl">{{ s.label }}</span>
          </span>
          <span v-if="i < STEPPER.length - 1" class="link" :class="{ past: i < stepIndex }" />
        </template>
      </nav>

      <!-- 内容面板 -->
      <div class="card card-pad pane">
        <!-- 欢迎 -->
        <section v-if="step === 'welcome'" class="step-pane welcome">
          <h2 class="pane-title">你的数据 · 你的 token · 你的电脑</h2>
          <p class="pane-lead">
            司南是全本机量化助手 —— 不提供数据、不碰你的任何数据。一切计算都在你的电脑上完成。
          </p>
          <div class="promises">
            <span class="chip"><Icon name="monitor" :size="13" /> 全本机运行</span>
            <span class="chip"><Icon name="db" :size="13" /> BYO 自带数据源</span>
            <span class="chip"><Icon name="lock" :size="13" /> 凭据加密</span>
          </div>
        </section>

        <!-- 选数据源 -->
        <section v-else-if="step === 'select_source'" class="step-pane">
          <h2 class="pane-title">选择你自己的数据来源</h2>
          <p class="pane-lead">
            司南不提供数据。Tushare Pro 能力最全(需自备 token);AkShare 免费但字段受限。
          </p>
          <div class="sources">
            <label class="source" :class="{ sel: provider === 'tushare' }">
              <input v-model="provider" type="radio" value="tushare" class="src-radio" />
              <span class="src-icon"><Icon name="db" :size="17" /></span>
              <span class="src-body">
                <strong>Tushare Pro</strong>
                <span class="src-desc">财务 / 北向 / 估值 / 复权 / 指数 全能力,需 token</span>
              </span>
              <span class="src-mark"><span class="src-dot" /></span>
            </label>
            <label class="source" :class="{ sel: provider === 'akshare' }">
              <input v-model="provider" type="radio" value="akshare" class="src-radio" />
              <span class="src-icon"><Icon name="db" :size="17" /></span>
              <span class="src-body">
                <strong>AkShare(免费)</strong>
                <span class="src-desc">价量 / 指数,无北向 / 财务 —— 样本外预期更低</span>
              </span>
              <span class="src-mark"><span class="src-dot" /></span>
            </label>
          </div>
        </section>

        <!-- 填凭据 -->
        <section v-else-if="step === 'credential'" class="step-pane">
          <h2 class="pane-title">填入凭据</h2>
          <template v-if="needsToken()">
            <label class="field-label" for="ob-token">Tushare Token</label>
            <div class="token-row">
              <input
                id="ob-token"
                v-model="token"
                class="input mono token-input"
                :type="showToken ? 'text' : 'password'"
                placeholder="粘贴你的 Tushare token…"
              />
              <button class="btn btn-secondary" @click="showToken = !showToken">
                {{ showToken ? '隐藏' : '显示' }}
              </button>
            </div>
            <p class="note">
              <Icon name="lock" :size="13" />
              <span>token 仅加密存本机系统钥匙串,司南<b>绝不</b>上传、<b>绝不</b>落明文。</span>
            </p>
          </template>
          <div v-else class="note">
            <Icon name="check" :size="13" />
            <span>AkShare 免费源无需 token,直接继续即可。</span>
          </div>
        </section>

        <!-- 测试连接 -->
        <section v-else-if="step === 'test'" class="step-pane test-pane">
          <h2 class="pane-title">测试连接</h2>
          <!-- 转圈中 -->
          <div v-if="testResult.loading" class="test-state">
            <span class="spinner" />
            <p class="test-msg">正在连接 · 探测能力与限频…</p>
          </div>
          <!-- 失败 -->
          <div v-else-if="testResult.error" class="test-state">
            <span class="test-icon err"><Icon name="alert" :size="20" /></span>
            <span class="badge badge-err"><span class="dot" /> 连接失败</span>
            <p class="test-msg">{{ testResult.error }}</p>
          </div>
          <!-- 有结果 -->
          <template v-else-if="testResult.data">
            <div class="test-state">
              <span class="test-icon" :class="testResult.data.status === 'ok' ? 'ok' : 'err'">
                <Icon :name="testResult.data.status === 'ok' ? 'check' : 'alert'" :size="20" />
              </span>
              <span
                class="badge"
                :class="testResult.data.status === 'ok' ? 'badge-ok' : 'badge-err'"
              >
                <span class="dot" />
                {{ testResult.data.status === 'ok' ? '连接成功' : '连接异常' }}
              </span>
              <p v-if="testResult.data.message" class="test-msg">{{ testResult.data.message }}</p>
            </div>
            <div v-if="testResult.data.caps" class="caps">
              <span
                v-for="[name, ok] in capEntries(testResult.data.caps)"
                :key="name"
                class="chip cap"
                :class="ok ? 'cap-on' : 'cap-off'"
              >
                <Icon :name="ok ? 'check' : 'alert'" :size="11" /> {{ name }}
              </span>
            </div>
            <div v-if="testResult.data.degraded?.length" class="degraded">
              <span v-for="d in testResult.data.degraded" :key="d" class="badge badge-warn">
                <span class="dot" /> {{ d }}
              </span>
            </div>
          </template>
          <!-- 未开始(状态机正常会自动跑,这里作兜底诚实占位) -->
          <div v-else class="test-state">
            <span class="test-icon idle"><Icon name="compass" :size="22" /></span>
            <p class="test-msg">点击下方按钮验证数据源连通性</p>
            <button class="btn btn-primary btn-sm" @click="runTest">开始测试</button>
          </div>
        </section>

        <!-- 建缓存 -->
        <section v-else-if="step === 'build_cache'" class="step-pane">
          <h2 class="pane-title">建立本地数据缓存</h2>
          <p class="pane-lead">全程在你的电脑上完成 —— 数据不出本机。</p>
          <label class="quick">
            <input v-model="quickMode" type="checkbox" class="switch" />
            <span class="quick-lbl">快速模式(少量股票,先跑通)</span>
          </label>
          <div v-if="!build.jobId" class="build-start">
            <button class="btn btn-primary" @click="startBuild">开始建缓存</button>
          </div>
          <div v-else class="progress">
            <div class="progress-head">
              <span class="progress-stage">{{ build.stage || '正在建立本地缓存…' }}</span>
              <span class="num mono">{{ buildPct }}%</span>
            </div>
            <div class="bar">
              <div class="fill" :style="{ width: buildPct + '%' }" />
            </div>
            <p v-if="build.message" class="progress-meta mono">{{ build.message }}</p>
            <p v-if="build.error" class="badge badge-err err-row">
              <span class="dot" /> {{ build.error }}
            </p>
          </div>
        </section>

        <!-- 完成 -->
        <section v-else-if="step === 'done'" class="step-pane done">
          <span class="done-mark"><Icon name="check" :size="26" /></span>
          <h2 class="pane-title">缓存建立完成</h2>
          <p class="pane-lead">
            本地缓存已建立。你现在可以浏览总览,后续里程碑将解锁因子打分、信号与模拟盘。
          </p>
        </section>
      </div>

      <!-- 底部操作区 -->
      <footer class="footer">
        <button v-if="step === 'welcome'" class="btn btn-ghost" @click="finish">跳过</button>
        <button v-else-if="step === 'select_source'" class="btn btn-ghost" @click="go('welcome')">
          上一步
        </button>
        <button
          v-else-if="step === 'credential'"
          class="btn btn-ghost"
          @click="go('select_source')"
        >
          上一步
        </button>
        <button v-else-if="step === 'test'" class="btn btn-ghost" @click="go('credential')">
          上一步
        </button>
        <span v-else />

        <div class="footer-right">
          <button v-if="step === 'test'" class="btn btn-secondary" @click="runTest">重测</button>

          <button v-if="step === 'welcome'" class="btn btn-primary" @click="go('select_source')">
            开始 <Icon name="chevR" :size="14" />
          </button>
          <button
            v-else-if="step === 'select_source'"
            class="btn btn-primary"
            @click="go('credential')"
          >
            下一步 <Icon name="chevR" :size="14" />
          </button>
          <button
            v-else-if="step === 'credential'"
            class="btn btn-primary"
            :disabled="needsToken() && !token"
            @click="saveCredentialAndContinue"
          >
            保存并测试 <Icon name="chevR" :size="14" />
          </button>
          <button
            v-else-if="step === 'test'"
            class="btn btn-primary"
            :disabled="!testResult.data || testResult.data.status !== 'ok'"
            @click="go('build_cache')"
          >
            建缓存 <Icon name="chevR" :size="14" />
          </button>
          <button v-else-if="step === 'done'" class="btn btn-primary" @click="finish">
            进入司南 <Icon name="chevR" :size="14" />
          </button>
        </div>
      </footer>

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
