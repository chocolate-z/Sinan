<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ONBOARDING_STEPS } from '@sinan/shared-contracts';
import { api, subscribeJob } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { capLabel } from '../../lib/caps';
import Icon from '../../shell/Icon.vue';
import Logo from '../../shell/Logo.vue';

// 步骤类型来自契约单一真相源,避免与后端漂移。
type Step = (typeof ONBOARDING_STEPS)[number];

const app = useAppStore();
const router = useRouter();

const step = ref<Step>('welcome');
const provider = ref<'tushare' | 'akshare'>('tushare');
const token = ref('');
const showToken = ref(false);
const universeMode = ref<'quick' | 'standard' | 'all'>('standard');
// 已配置凭据检测:重建缓存时不必重输 token(直接带入设置里已存的主源 token)。
const credConfigured = ref(false);
const replacingToken = ref(false);

async function loadCred() {
  replacingToken.value = false;
  if (!needsToken()) {
    credConfigured.value = false;
    return;
  }
  try {
    const info = await api.getCredential(provider.value);
    credConfigured.value = !!info?.configured;
  } catch {
    credConfigured.value = false;
  }
}
onMounted(async () => {
  // 默认主源(设置里已选的) → 重建缓存时直接带入,不必重选/重输。
  if (app.activeProvider === 'tushare' || app.activeProvider === 'akshare') {
    provider.value = app.activeProvider;
  }
  await loadCred();
});
watch(provider, loadCred);

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
// 「标准」一篮子各行业流动性好的大盘蓝筹(约 40 只):比 5 股可用、比全 A 快,适合日常研究的默认宇宙。
const STANDARD_CODES = [
  '600519.SH',
  '000858.SZ',
  '600036.SH',
  '601318.SH',
  '000001.SZ',
  '600276.SH',
  '000333.SZ',
  '600900.SH',
  '601166.SH',
  '000651.SZ',
  '600030.SH',
  '601398.SH',
  '600887.SH',
  '002594.SZ',
  '600309.SH',
  '601012.SH',
  '600585.SH',
  '000725.SZ',
  '601888.SH',
  '600009.SH',
  '600031.SH',
  '000002.SZ',
  '601628.SH',
  '600048.SH',
  '002415.SZ',
  '600028.SH',
  '601857.SH',
  '600104.SH',
  '000063.SZ',
  '600690.SH',
  '601088.SH',
  '600050.SH',
  '000568.SZ',
  '600436.SH',
  '002304.SZ',
  '601336.SH',
];

async function startBuild() {
  go('build_cache');
  build.error = null;
  build.progress = 0;
  build.status = 'running';
  const params: any = {
    universe:
      universeMode.value === 'all'
        ? { boards: ['sh', 'sz'] }
        : {
            boards: ['sh', 'sz'],
            codes: universeMode.value === 'quick' ? QUICK_CODES : STANDARD_CODES,
          },
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
  <div class="wizard-stage">
    <div class="wizard">
      <!-- 品牌:花朵 logo + 标题 -->
      <header class="brand">
        <div class="brand-logo"><Logo :size="30" /></div>
        <h1 class="brand-title">欢迎使用 司南 Sinan</h1>
        <p class="brand-sub">诚实、纪律化、可解释的本地量化研究工具</p>
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
            <template v-if="credConfigured && !replacingToken">
              <div class="token-row">
                <div class="input mono token-masked">已配置 · token 已存本机钥匙串</div>
                <button class="btn btn-secondary" @click="replacingToken = true">更换</button>
              </div>
              <p class="note">
                <Icon name="check" :size="13" />
                <span>已检测到设置里配置的 token,<b>无需重输</b> —— 直接下一步即可重建缓存。</span>
              </p>
            </template>
            <template v-else>
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
                <Icon :name="ok ? 'check' : 'alert'" :size="11" /> {{ capLabel(name) }}
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
          <div class="segmented uni-modes">
            <button :class="{ on: universeMode === 'quick' }" @click="universeMode = 'quick'">
              快速 · 5 股
            </button>
            <button :class="{ on: universeMode === 'standard' }" @click="universeMode = 'standard'">
              标准 · 约 40 蓝筹
            </button>
            <button :class="{ on: universeMode === 'all' }" @click="universeMode = 'all'">
              全市场 · 慢
            </button>
          </div>
          <p class="uni-hint cap">
            {{
              universeMode === 'quick'
                ? '5 只样例股,先跑通整套流程'
                : universeMode === 'standard'
                  ? '各行业流动性好的大盘蓝筹(约 40 只),适合日常研究 —— 推荐'
                  : '全 A 股,数据量大、建缓存较慢'
            }}
          </p>
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
            :disabled="needsToken() && (replacingToken || !credConfigured) && !token"
            @click="saveCredentialAndContinue"
          >
            {{ credConfigured && !replacingToken ? '继续并测试' : '保存并测试' }}
            <Icon name="chevR" :size="14" />
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
/* ── 整页舞台:居中铺底,衬托浮起的向导卡 ──────────────────── */
.wizard-stage {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-10) var(--sp-4);
}
.wizard {
  width: 100%;
  max-width: 560px;
}

/* ── 品牌头:花朵 logo + 标题 ─────────────────────────────── */
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: var(--sp-10);
}
.brand-logo {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  margin-bottom: var(--sp-4);
  /* 紫渐变实底 + accent 发光,贴 spec line 31(background:accent-grad);
     内部仍用四色花朵 logo(保留品牌增强,非纯指南针)。 */
  background: var(--accent-grad);
  box-shadow: var(--accent-glow);
}
.brand-title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.brand-sub {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-body);
  color: var(--text-2);
}

/* ── 步骤进度条 ───────────────────────────────────────────── */
.stepper {
  display: flex;
  align-items: flex-start;
  margin-bottom: var(--sp-6);
}
.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  flex: none;
}
.node {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-panel-2);
  color: var(--text-3);
  border: 0.5px solid var(--border);
  transition:
    background var(--t-med) var(--ease),
    color var(--t-med) var(--ease),
    border-color var(--t-med) var(--ease);
}
/* 当前步:系统色不混品牌 —— 用中性高对比(描边 + 主文本)标出「在此步」,
   accent 紫只保留给「已完成」勾选,避免品牌色当系统态用。 */
.step.on .node {
  background: var(--bg-panel-2);
  color: var(--text-1);
  border-color: var(--border-strong);
}
.step.done .node {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}
.lbl {
  font-size: var(--fs-cap);
  color: var(--text-3);
  white-space: nowrap;
  transition: color var(--t-med) var(--ease);
}
.step.on .lbl {
  color: var(--text-1);
  font-weight: 500;
}
.link {
  flex: 1;
  height: 0.5px;
  min-width: 8px;
  background: var(--border);
  /* 上边距对齐 26px 节点圆心(半径 13px),0 8px 横向间隙贴 spec line 52 */
  margin: 13px var(--sp-2) 0;
  transition: background var(--t-med) var(--ease);
}
.link.past {
  background: var(--accent);
}

/* ── 内容 pane ────────────────────────────────────────────── */
.pane {
  min-height: 220px;
}
.step-pane {
  display: flex;
  flex-direction: column;
}
.pane-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 var(--sp-3);
  color: var(--text-1);
}
.pane-lead {
  color: var(--text-2);
  font-size: var(--fs-sub);
  line-height: 1.6;
  margin: 0 0 var(--sp-4);
}

/* ── 欢迎:承诺胶囊 ───────────────────────────────────────── */
.promises {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
}

/* ── 数据源选择卡 ─────────────────────────────────────────── */
.sources {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: var(--sp-2) 0 0;
}
.source {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  cursor: pointer;
  padding: 12px 14px;
  border-radius: var(--r-md);
  border: 0.5px solid var(--border);
  background: var(--bg-panel-2);
  transition:
    border-color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}
.source:hover {
  border-color: var(--border-strong);
}
.source.sel {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.src-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.src-icon {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--bg-panel-2);
  border: 0.5px solid var(--border);
  color: var(--text-3);
  transition: color var(--t-fast) var(--ease);
}
.source.sel .src-icon {
  color: var(--accent);
  background: var(--bg-panel);
}
.src-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}
.src-body strong {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--text-1);
}
.src-desc {
  font-size: var(--fs-cap);
  color: var(--text-2);
  line-height: 1.4;
}
.src-mark {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  display: grid;
  place-items: center;
  transition: border-color var(--t-fast) var(--ease);
}
.source.sel .src-mark {
  border-color: var(--accent);
}
.src-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease);
}
.source.sel .src-dot {
  opacity: 1;
}

/* ── 凭据表单 ─────────────────────────────────────────────── */
.token-row {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.token-input {
  flex: 1;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin: var(--sp-4) 0 0;
  padding: 11px 12px;
  background: var(--status-ok-bg);
  border-radius: var(--r-sm);
  font-size: var(--fs-cap);
  line-height: 1.6;
  color: var(--text-2);
}
.note :deep(svg) {
  flex: none;
  margin-top: 2px;
  color: var(--status-ok);
}
.note b {
  color: var(--text-1);
  font-weight: 500;
}

/* ── 测试连接 ─────────────────────────────────────────────── */
.test-pane {
  flex: 1;
}
.test-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: var(--sp-4) 0;
}
.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.test-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}
.test-icon.ok {
  background: var(--status-ok-bg);
  color: var(--status-ok);
}
.test-icon.err {
  background: var(--status-err-bg);
  color: var(--status-err);
}
.test-icon.idle {
  background: var(--bg-panel-2);
  color: var(--text-3);
}
.test-msg {
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--text-2);
  text-align: center;
  line-height: 1.5;
}

/* ── 能力探测标签 ─────────────────────────────────────────── */
.caps {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
}
.cap.cap-on {
  color: var(--status-ok);
}
.cap.cap-off {
  color: var(--text-3);
}
.degraded {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* ── 建缓存 ───────────────────────────────────────────────── */
.uni-modes {
  margin: var(--sp-2) 0 var(--sp-1);
}
.uni-hint {
  color: var(--text-3);
  margin: 0 0 var(--sp-4);
}
.build-start {
  margin-top: var(--sp-2);
}
.progress {
  margin-top: var(--sp-2);
}
.progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  margin-bottom: var(--sp-2);
}
.progress-stage {
  font-size: var(--fs-sub);
  color: var(--text-2);
}
.bar {
  height: 6px;
  background: var(--bg-input);
  border-radius: var(--r-xs);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: var(--r-xs);
  background: var(--accent-grad);
  transition: width var(--t-med) var(--ease);
}
.progress-meta {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.err-row {
  margin-top: var(--sp-3);
}

/* ── 完成 ─────────────────────────────────────────────────── */
.done {
  align-items: center;
  text-align: center;
}
.done-mark {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--status-ok-bg);
  color: var(--status-ok);
  margin-bottom: var(--sp-3);
}

/* ── 底部操作区 ───────────────────────────────────────────── */
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}
.footer-right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.disclaimer {
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.5;
  text-align: center;
  margin: var(--sp-5) 0 0;
}
</style>
