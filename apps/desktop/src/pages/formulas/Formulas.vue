<script setup lang="ts">
// 通达信/同花顺公式 · 检测扫描:粘贴公式 → 校验 → 选信号列 → 全市场扫今日触发的股票。
// 诚实:布尔筛选(非打分排序);日频近似(不支持分时);仅研究,非投资建议。绘制语句(STICK/COLOR)仅识别不绘图。
import { computed, onMounted } from 'vue';
import { useFormulasStore } from '../../stores/formulas';
import PageHero from '../../ui/PageHero.vue';
import RunningBar from '../../ui/RunningBar.vue';
import Candles from '../../ui/charts/Candles.vue';
import TdxSubChart from '../../ui/charts/TdxSubChart.vue';
import Icon from '../../shell/Icon.vue';

const f = useFormulasStore();
const v = computed(() => f.validateRes);
const r = computed(() => f.scanRes);
const canSave = computed(() => !!f.name.trim() && !!f.src.trim() && !f.saving);

// 单股 K 线 + 公式副图(点命中股票打开)
const ev = computed(() => f.evalRes);
const candleData = computed(() =>
  (ev.value?.bars ?? []).map((b: any) => ({
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume ?? 0,
  })),
);

onMounted(() => f.loadSaved());

function fmtVal(x: unknown): string {
  if (x === true) return '✓';
  if (x === false) return '✗';
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : x.toFixed(2);
  return x == null ? '—' : String(x);
}
</script>

<template>
  <PageHero title="公式" sub="通达信 / 同花顺公式 · 全市场检测扫描 · 收盘后日频口径">
    <template #right>
      <button class="btn btn-secondary btn-sm" :disabled="f.validating" @click="f.validate()">
        <Icon name="shield" :size="13" /> {{ f.validating ? '校验中…' : '校验' }}
      </button>
      <button class="btn btn-primary btn-sm" :disabled="!f.canScan" @click="f.scan()">
        <Icon name="refresh" :size="13" /> {{ f.scanning ? '扫描中…' : '全市场扫描' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 诚实口径条 -->
    <div class="note">
      <Icon name="shield" :size="14" class="n-ic" />
      <span class="n-lead">检测口径</span>
      <span class="n-tail">
        信号为<b>布尔筛选</b>(命中=今日触发,非按分排序);<b>日频近似</b>不支持分时;支持
        SMA/EMA/LLV/HHV/CROSS/IF/REF/MA/SUM/COUNT/MAX/MIN/ABS;绘制语句(STICK/COLOR/DRAWTEXT)仅识别不绘图。仅供研究,非投资建议。
      </span>
    </div>

    <p v-if="f.error" class="msg-err"><Icon name="alert" :size="14" /> {{ f.error }}</p>
    <RunningBar
      :active="f.scanning"
      :since="f.startedAt"
      label="全市场逐股求值中(数千只,约十余秒)"
    />

    <div class="cols">
      <!-- 左:公式编辑 + 校验结果 -->
      <div class="card edit-card">
        <div class="card-head">
          <div>
            <h3 class="card-title">公式</h3>
            <span class="card-sub">支持 := 临时变量 · : 输出线 · 中文标识符</span>
          </div>
          <div class="head-actions">
            <button class="btn btn-ghost btn-sm" @click="f.newDraft()">新建</button>
            <button class="btn btn-ghost btn-sm" @click="f.resetSample()">载入示例</button>
          </div>
        </div>

        <!-- 已保存公式库 -->
        <div v-if="f.saved.length" class="saved-bar">
          <span class="saved-lead cap">已存</span>
          <div class="saved-chips">
            <span
              v-for="s in f.saved"
              :key="s.id"
              class="saved-chip"
              :class="{ on: f.currentId === s.id }"
            >
              <button class="sc-load" :title="s.name" @click="f.loadFormula(s)">
                {{ s.name }}
              </button>
              <button class="sc-del" title="删除" @click="f.deleteFormula(s.id)">✕</button>
            </span>
          </div>
        </div>

        <div class="card-pad">
          <!-- 保存:命名 + 保存(后端保存前再校验) -->
          <div class="save-row">
            <input
              v-model="f.name"
              class="input save-name"
              placeholder="给公式起个名…"
              @keyup.enter="f.save()"
            />
            <button class="btn btn-secondary btn-sm" :disabled="!canSave" @click="f.save()">
              <Icon name="db" :size="12" />
              {{ f.saving ? '保存中…' : f.currentId ? '更新' : '保存' }}
            </button>
          </div>

          <textarea
            v-model="f.src"
            class="editor mono"
            spellcheck="false"
            placeholder="粘贴通达信/同花顺公式…"
          />

          <!-- 校验结果 -->
          <div v-if="v" class="vres">
            <div v-if="v.ok" class="vline ok">
              <Icon name="shield" :size="13" /> 校验通过 · {{ v.outputs.length }} 个输出列
            </div>
            <div v-else class="vline err">
              <Icon name="alert" :size="13" /> 校验未通过
              <ul class="errs">
                <li v-for="(e, i) in v.errors" :key="i">{{ e }}</li>
              </ul>
            </div>

            <div v-if="v.ok && v.outputs.length" class="sig-row">
              <label class="sig-label">信号列</label>
              <select v-model="f.signal" class="input mono sig-sel">
                <option v-for="o in v.outputs" :key="o" :value="o">{{ o }}</option>
              </select>
              <span class="sig-hint">命中=该列今日「非零/为真」</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右:扫描结果 -->
      <div class="card res-card">
        <div class="card-head">
          <div>
            <h3 class="card-title">今日触发</h3>
            <span v-if="r" class="card-sub">
              {{ r.asof }} 收盘 · 信号「{{ r.signal }}」· 扫描 {{ r.scanned }} 只 · 触发
              {{ r.hits.length }} 只
            </span>
            <span v-else class="card-sub">校验后点「全市场扫描」</span>
          </div>
          <span v-if="r" class="badge badge-idle"><span class="dot" />{{ r.hits.length }}</span>
        </div>

        <div v-if="r && r.hits.length" class="tbl-wrap">
          <table class="dt dt-compact">
            <thead>
              <tr>
                <th>序</th>
                <th>代码</th>
                <th class="num">信号值</th>
                <th>触发日</th>
                <th style="width: 24px" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(h, i) in r.hits"
                :key="h.stock_code"
                class="hit-row"
                :class="{ sel: f.selStock === h.stock_code }"
                @click="f.pickStock(h.stock_code)"
              >
                <td class="dim mono">{{ i + 1 }}</td>
                <td class="col-code">{{ h.stock_code }}</td>
                <td class="num mono">{{ fmtVal(h.value) }}</td>
                <td class="dim col-code">{{ h.date }}</td>
                <td class="c-chev">›</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="r" class="empty">
          <div class="empty-icon"><Icon name="signals" :size="20" /></div>
          <div class="empty-title">今日无股票触发该信号</div>
          <div class="empty-desc">换信号列、调整公式参数,或确认本地缓存已含最近日线。</div>
        </div>
        <div v-else class="empty">
          <div class="empty-icon"><Icon name="indicator" :size="20" /></div>
          <div class="empty-title">尚未扫描</div>
          <div class="empty-desc">先「校验」公式,选定信号列,再「全市场扫描」。</div>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      公式在本地缓存的日线上逐股求值(收盘价口径,日频);SMA 为中国式递归加权(α=M/N),CROSS
      为上穿瞬间。结果仅供研究参考,非投资建议;请配合模拟盘前向验证。
    </p>

    <!-- 点命中股票 → K 线 + 公式副图抽屉 -->
    <template v-if="f.selStock">
      <div class="drawer-scrim" @click="f.closeStock()" />
      <aside class="drawer card">
        <div class="drawer-head">
          <div class="dh-title">
            <span class="dh-name col-code">{{ f.selStock }}</span>
            <span v-if="ev?.asof" class="dh-sub">{{ ev.asof }} · 日K + 公式副图</span>
          </div>
          <button class="dh-close" title="关闭" @click="f.closeStock()">✕</button>
        </div>
        <div class="drawer-body">
          <div v-if="f.loadingEval" class="empty"><div class="empty-title">求值中…</div></div>
          <template v-else-if="ev && ev.bars && ev.bars.length">
            <div class="chart-cap cap">日 K 线(前 {{ ev.bars.length }} 根)</div>
            <Candles :data="candleData" :height="260" :ma="[5, 10, 20]" />
            <div class="chart-cap cap">公式副图 · {{ ev.outputs.join(' / ') }}</div>
            <TdxSubChart
              :lines="ev.lines"
              :signal-outputs="ev.signal_outputs"
              :n="ev.bars.length"
              :height="160"
            />
          </template>
          <div v-else class="empty">
            <div class="empty-icon"><Icon name="db" :size="20" /></div>
            <div class="empty-title">本地无该股日线缓存</div>
          </div>
        </div>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  flex-wrap: wrap;
  padding: 11px 14px;
  border-radius: var(--r-md);
  background: var(--status-ok-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-ok) 30%, transparent);
}
.n-ic {
  color: var(--status-ok);
  flex: none;
  margin-top: 1px;
}
.n-lead {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
  flex: none;
}
.n-tail {
  font-size: var(--fs-sub);
  color: var(--text-2);
  flex: 1;
  min-width: 200px;
  line-height: 1.6;
}
.msg-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 9px 13px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  color: var(--status-err);
  background: var(--status-err-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-err) 30%, transparent);
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.editor {
  width: 100%;
  min-height: 240px;
  resize: vertical;
  padding: 12px 14px;
  border-radius: var(--r-md);
  border: 0.5px solid var(--border);
  background: var(--bg-base);
  color: var(--text-1);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
.editor:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.head-actions {
  display: flex;
  gap: 6px;
}
.saved-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-top: 0.5px solid var(--border-faint);
  border-bottom: 0.5px solid var(--border-faint);
}
.saved-lead {
  flex: none;
  color: var(--text-3);
}
.saved-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.saved-chip {
  display: inline-flex;
  align-items: center;
  border-radius: var(--r-sm);
  border: 0.5px solid var(--border);
  background: var(--bg-base);
  overflow: hidden;
}
.saved-chip.on {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.sc-load {
  border: 0;
  background: transparent;
  color: var(--text-1);
  font-size: 11.5px;
  padding: 3px 8px;
  cursor: pointer;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-del {
  border: 0;
  border-left: 0.5px solid var(--border-faint);
  background: transparent;
  color: var(--text-3);
  font-size: 10px;
  padding: 3px 6px;
  cursor: pointer;
}
.sc-del:hover {
  color: var(--status-err);
  background: var(--status-err-bg);
}
.save-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.save-name {
  flex: 1;
}
.vres {
  margin-top: 12px;
}
.vline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sub);
  font-weight: 500;
}
.vline.ok {
  color: var(--status-ok);
}
.vline.err {
  color: var(--status-err);
  flex-direction: column;
  align-items: flex-start;
}
.errs {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--text-2);
  font-weight: 400;
}
.sig-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.sig-label {
  font-size: var(--fs-sub);
  color: var(--text-2);
}
.sig-sel {
  min-width: 140px;
}
.sig-hint {
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.tbl-wrap {
  max-height: 520px;
  overflow: auto;
}
.dim {
  color: var(--text-3);
}
.disclaimer {
  margin: 2px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}
.hit-row {
  cursor: pointer;
}
.c-chev {
  color: var(--text-3);
  text-align: center;
}

/* K 线 + 副图 抽屉 */
.drawer-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 60;
}
.drawer {
  position: fixed;
  top: var(--titlebar-h);
  right: 0;
  bottom: var(--statusbar-h);
  width: 640px;
  max-width: 92vw;
  z-index: 61;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  animation: drawer-in 160ms var(--ease-out);
}
@keyframes drawer-in {
  from {
    transform: translateX(20px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 0.5px solid var(--border);
}
.dh-title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.dh-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.dh-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.dh-close {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.dh-close:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.drawer-body {
  flex: 1;
  overflow: auto;
  padding: 14px 18px;
}
.chart-cap {
  color: var(--text-3);
  margin: 10px 0 4px;
}
@media (max-width: 1080px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
