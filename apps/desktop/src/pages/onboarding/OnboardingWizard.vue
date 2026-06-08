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
  <div class="wizard">
    <div class="steps">
      <span :class="{ on: step === 'welcome' }">欢迎</span> ›
      <span :class="{ on: step === 'select_source' }">选数据源</span> ›
      <span :class="{ on: step === 'credential' }">填凭据</span> ›
      <span :class="{ on: step === 'test' }">测试连接</span> ›
      <span :class="{ on: step === 'build_cache' }">建缓存</span> ›
      <span :class="{ on: step === 'done' }">完成</span>
    </div>

    <!-- 欢迎 -->
    <section v-if="step === 'welcome'" class="card">
      <h1>司南 Sinan</h1>
      <p>全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
      <div class="promises">
        <span>🖥 全本机运行</span><span>🔑 BYO 自带数据源</span><span>🔒 凭据加密</span>
      </div>
      <button class="primary" @click="go('select_source')">开始 →</button>
    </section>

    <!-- 选数据源 -->
    <section v-else-if="step === 'select_source'" class="card">
      <h2>选择你自己的数据来源</h2>
      <p class="muted">
        司南不提供数据。Tushare Pro 能力最全(需自备 token);AkShare 免费但字段受限。
      </p>
      <div class="sources">
        <label class="source" :class="{ sel: provider === 'tushare' }">
          <input v-model="provider" type="radio" value="tushare" />
          <strong>Tushare Pro</strong>
          <span class="muted">财务/北向/估值/复权/指数 全能力,需 token</span>
        </label>
        <label class="source" :class="{ sel: provider === 'akshare' }">
          <input v-model="provider" type="radio" value="akshare" />
          <strong>AkShare(免费)</strong>
          <span class="muted">价量/指数,无北向/财务 —— 样本外预期更低</span>
        </label>
      </div>
      <button class="primary" @click="go('credential')">下一步 →</button>
    </section>

    <!-- 填凭据 -->
    <section v-else-if="step === 'credential'" class="card">
      <h2>填入凭据</h2>
      <template v-if="needsToken()">
        <label class="field">
          <span>Tushare Token</span>
          <div class="token-row">
            <input
              v-model="token"
              :type="showToken ? 'text' : 'password'"
              placeholder="粘贴你的 Tushare token"
            />
            <button class="ghost" @click="showToken = !showToken">
              {{ showToken ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>
        <p class="muted">🔒 token 仅加密存本机系统钥匙串,绝不上传、绝不落明文。</p>
      </template>
      <p v-else class="muted">AkShare 免费源无需 token。</p>
      <button class="primary" :disabled="needsToken() && !token" @click="saveCredentialAndContinue">
        保存并测试连接 →
      </button>
    </section>

    <!-- 测试连接 -->
    <section v-else-if="step === 'test'" class="card">
      <h2>测试连接</h2>
      <p v-if="testResult.loading" class="muted">正在探测能力与限频…</p>
      <p v-else-if="testResult.error" class="status-err">连接失败:{{ testResult.error }}</p>
      <template v-else-if="testResult.data">
        <p :class="testResult.data.status === 'ok' ? 'status-ok' : 'status-err'">
          ● {{ testResult.data.status === 'ok' ? '连接成功' : '连接异常' }}
          <span v-if="testResult.data.message">— {{ testResult.data.message }}</span>
        </p>
        <div class="caps">
          <span
            v-for="[name, ok] in capEntries(testResult.data.caps)"
            :key="name"
            :class="ok ? 'status-ok' : 'muted'"
            >{{ ok ? '✓' : '✗' }} {{ name }}</span
          >
        </div>
        <p v-for="d in testResult.data.degraded" :key="d" class="status-warn">⚠ {{ d }}</p>
      </template>
      <div class="actions">
        <button class="ghost" @click="go('credential')">返回</button>
        <button class="ghost" @click="runTest">重测</button>
        <button
          class="primary"
          :disabled="!testResult.data || testResult.data.status !== 'ok'"
          @click="go('build_cache')"
        >
          下一步:建缓存 →
        </button>
      </div>
    </section>

    <!-- 建缓存 -->
    <section v-else-if="step === 'build_cache'" class="card">
      <h2>建立本地数据缓存(全程在你的电脑上)</h2>
      <label class="quick"
        ><input v-model="quickMode" type="checkbox" /> 快速模式(少量股票,先跑通)</label
      >
      <div v-if="!build.jobId">
        <button class="primary" @click="startBuild">开始建缓存</button>
      </div>
      <div v-else>
        <div class="bar">
          <div class="fill" :style="{ width: (build.progress * 100).toFixed(0) + '%' }" />
        </div>
        <p class="muted">
          {{ (build.progress * 100).toFixed(0) }}% · {{ build.stage }} · {{ build.message }}
        </p>
        <p v-if="build.error" class="status-err">{{ build.error }}</p>
      </div>
    </section>

    <!-- 完成 -->
    <section v-else-if="step === 'done'" class="card">
      <h2>✓ 完成</h2>
      <p>本地缓存已建立。你现在可以浏览总览,后续里程碑将解锁因子打分、信号与模拟盘。</p>
      <button class="primary" @click="finish">进入司南 →</button>
    </section>

    <p class="disclaimer">
      司南仅供研究参考,不构成投资建议;模拟盘为纸面前向验证,不进行任何真实下单。
    </p>
  </div>
</template>

<style scoped>
.wizard {
  max-width: 640px;
  margin: 6vh auto;
  padding: var(--sp-4);
}
.steps {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin-bottom: var(--sp-4);
}
.steps .on {
  color: var(--accent);
  font-weight: 600;
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
}
.promises {
  display: flex;
  gap: var(--sp-4);
  margin: var(--sp-4) 0;
  color: var(--c-text-2);
}
.sources {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: var(--sp-4) 0;
}
.source {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  cursor: pointer;
}
.source.sel {
  border-color: var(--accent);
  background: var(--accent-weak);
}
.field {
  display: block;
  margin: var(--sp-3) 0;
}
.token-row {
  display: flex;
  gap: var(--sp-2);
}
.token-row input {
  flex: 1;
  padding: var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
  font-size: var(--fs-cap);
}
.actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.bar {
  height: 10px;
  background: var(--c-surface-2);
  border-radius: var(--r-pill);
  overflow: hidden;
  margin: var(--sp-3) 0 var(--sp-1);
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--dur) var(--ease);
}
.primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
}
.muted {
  color: var(--c-text-3);
}
.quick {
  display: block;
  margin: var(--sp-2) 0 var(--sp-3);
}
.disclaimer {
  margin-top: var(--sp-4);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
