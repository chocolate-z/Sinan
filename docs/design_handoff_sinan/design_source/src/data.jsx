/* ============================================================
   司南 Sinan — Mock data (真实中文示例数据)
   ============================================================ */

// Seeded PRNG so curves are stable across renders
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Quote table (行情/监控) ----
const QUOTES = [
  { code: "600519.SH", name: "贵州茅台", price: 1486.30, chg: 1.82, vol: "3.21万", amt: "47.6亿", pe: 24.1 },
  { code: "300750.SZ", name: "宁德时代", price: 251.88, chg: 3.41, vol: "21.4万", amt: "53.2亿", pe: 18.7 },
  { code: "601318.SH", name: "中国平安", price: 52.16, chg: -0.74, vol: "48.7万", amt: "25.4亿", pe: 9.2 },
  { code: "000858.SZ", name: "五粮液", price: 142.55, chg: 0.96, vol: "9.83万", amt: "14.0亿", pe: 16.4 },
  { code: "600036.SH", name: "招商银行", price: 38.92, chg: -1.13, vol: "36.2万", amt: "14.1亿", pe: 6.1 },
  { code: "002594.SZ", name: "比亚迪", price: 268.40, chg: 2.27, vol: "15.6万", amt: "41.9亿", pe: 21.3 },
  { code: "600276.SH", name: "恒瑞医药", price: 47.31, chg: -0.42, vol: "22.1万", amt: "10.4亿", pe: 38.9 },
  { code: "601899.SH", name: "紫金矿业", price: 17.84, chg: 4.08, vol: "88.5万", amt: "15.7亿", pe: 13.6 },
  { code: "000333.SZ", name: "美的集团", price: 71.05, chg: 0.31, vol: "12.9万", amt: "9.16亿", pe: 12.8 },
  { code: "600900.SH", name: "长江电力", price: 28.67, chg: -0.21, vol: "19.4万", amt: "5.56亿", pe: 19.5 },
  { code: "002415.SZ", name: "海康威视", price: 31.22, chg: 1.49, vol: "28.7万", amt: "8.94亿", pe: 17.2 },
  { code: "300059.SZ", name: "东方财富", price: 16.93, chg: -2.36, vol: "112万", amt: "19.1亿", pe: 22.4 },
  { code: "601012.SH", name: "隆基绿能", price: 19.47, chg: 5.12, vol: "64.3万", amt: "12.4亿", pe: 15.1 },
  { code: "600887.SH", name: "伊利股份", price: 26.18, chg: 0.65, vol: "17.2万", amt: "4.51亿", pe: 14.7 },
];

// ---- Equity curve generator: 模型净值 vs 沪深300 + 回撤 ----
function genEquity(points, seed) {
  const rng = mulberry32(seed);
  const model = [], bench = [];
  let mv = 1.0, bv = 1.0, mPeak = 1.0;
  const dd = [];
  for (let i = 0; i < points; i++) {
    const mr = (rng() - 0.46) * 0.018 + 0.0011;
    const br = (rng() - 0.49) * 0.014 + 0.0004;
    mv *= 1 + mr; bv *= 1 + br;
    mPeak = Math.max(mPeak, mv);
    model.push(mv); bench.push(bv);
    dd.push((mv / mPeak - 1) * 100);
  }
  return { model, bench, dd };
}

// ---- Candlestick generator (K线) ----
function genCandles(n, seed, start) {
  const rng = mulberry32(seed);
  const out = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const drift = (rng() - 0.48) * 0.022;
    const open = prev;
    const close = open * (1 + drift);
    const hi = Math.max(open, close) * (1 + rng() * 0.012);
    const lo = Math.min(open, close) * (1 - rng() * 0.012);
    out.push({ o: open, c: close, h: hi, l: lo, v: 0.4 + rng() * 0.6 });
    prev = close;
  }
  return out;
}

// ---- Signals 选股信号 ----
const SIGNALS = [
  { code: "601899.SH", name: "紫金矿业", dir: "buy", score: 87, reason: "动量+资金流双高,行业景气上行", factors: [["动量", 0.34], ["质量", 0.21], ["资金流", 0.28], ["估值", -0.06]] },
  { code: "300750.SZ", name: "宁德时代", dir: "buy", score: 81, reason: "盈利预期上修,北向持续净流入", factors: [["成长", 0.31], ["情绪", 0.19], ["质量", 0.24], ["波动", -0.08]] },
  { code: "601012.SH", name: "隆基绿能", dir: "buy", score: 78, reason: "超跌反弹,估值分位回落至低位", factors: [["反转", 0.29], ["估值", 0.26], ["动量", 0.14], ["质量", 0.05]] },
  { code: "000858.SZ", name: "五粮液", dir: "hold", score: 63, reason: "基本面稳健但缺乏催化", factors: [["质量", 0.22], ["估值", 0.11], ["动量", -0.04], ["情绪", -0.02]] },
  { code: "002415.SZ", name: "海康威视", dir: "buy", score: 71, reason: "订单修复,毛利率环比改善", factors: [["成长", 0.18], ["质量", 0.20], ["动量", 0.16], ["估值", 0.04]] },
  { code: "600276.SH", name: "恒瑞医药", dir: "sell", score: 38, reason: "动量转弱,集采扰动估值承压", factors: [["动量", -0.21], ["情绪", -0.14], ["估值", -0.09], ["质量", 0.12]] },
  { code: "300059.SZ", name: "东方财富", dir: "sell", score: 34, reason: "成交活跃度回落,趋势走弱", factors: [["动量", -0.24], ["资金流", -0.18], ["波动", -0.11], ["质量", 0.06]] },
];

// 被风控拦截组
const SIGNALS_BLOCKED = [
  { code: "002766.SZ", name: "*ST索菱", dir: "buy", score: 74, blockedBy: "ST/退市风险过滤", note: "标的命中风险名单" },
  { code: "300xxx.SZ", name: "新研股份", dir: "buy", score: 69, blockedBy: "流动性闸 · 日均成交<5000万", note: "近20日日均成交不足" },
  { code: "600145.SH", name: "退市平庄", dir: "buy", score: 66, blockedBy: "停牌过滤", note: "标的当前停牌" },
];

// ---- Holdings 持仓 (模型模拟盘) ----
const HOLDINGS_MODEL = [
  { code: "600519.SH", name: "贵州茅台", shares: 200, cost: 1402.10, price: 1486.30 },
  { code: "300750.SZ", name: "宁德时代", shares: 1200, cost: 238.40, price: 251.88 },
  { code: "601899.SH", name: "紫金矿业", shares: 18000, cost: 16.22, price: 17.84 },
  { code: "002594.SZ", name: "比亚迪", shares: 800, cost: 275.60, price: 268.40 },
  { code: "601012.SH", name: "隆基绿能", shares: 14000, cost: 18.05, price: 19.47 },
];
const HOLDINGS_PERSONAL = [
  { code: "000858.SZ", name: "五粮液", shares: 500, cost: 151.20, price: 142.55 },
  { code: "600036.SH", name: "招商银行", shares: 3000, cost: 35.40, price: 38.92 },
  { code: "600887.SH", name: "伊利股份", shares: 2000, cost: 27.80, price: 26.18 },
];

// ---- Backtest 逐笔成交 ----
const TRADES = [
  { date: "2026-05-28", code: "601899.SH", name: "紫金矿业", dir: "buy",  shares: 18000, price: 16.22, amt: 291960 },
  { date: "2026-05-28", code: "601012.SH", name: "隆基绿能", dir: "buy",  shares: 14000, price: 18.05, amt: 252700 },
  { date: "2026-05-21", code: "600276.SH", name: "恒瑞医药", dir: "sell", shares: 5000,  price: 48.90, amt: 244500 },
  { date: "2026-05-21", code: "300750.SZ", name: "宁德时代", dir: "buy",  shares: 1200,  price: 238.40, amt: 286080 },
  { date: "2026-05-14", code: "000333.SZ", name: "美的集团", dir: "sell", shares: 3500,  price: 70.20, amt: 245700 },
  { date: "2026-05-14", code: "600519.SH", name: "贵州茅台", dir: "buy",  shares: 200,   price: 1402.10, amt: 280420 },
];

// ---- Backtest 逐日明细 ----
function genDaily(seed) {
  const rng = mulberry32(seed);
  const rows = [];
  let total = 1000000, peak = 1000000, cash = 180000;
  const dates = ["2026-06-06","2026-06-05","2026-06-04","2026-06-03","2026-05-30","2026-05-29","2026-05-28","2026-05-27"];
  for (const d of dates) {
    const r = (rng() - 0.45) * 0.02;
    total *= 1 + r; peak = Math.max(peak, total);
    const mktVal = total - cash;
    rows.push({
      date: d, total, cash, mktVal,
      pnl: total * r, dd: (total / peak - 1) * 100,
    });
  }
  return rows;
}

// ---- Monthly returns heatmap (月度收益) ----
const MONTHLY = {
  years: ["2024", "2025", "2026"],
  months: ["1","2","3","4","5","6","7","8","9","10","11","12"],
  data: [
    [2.1, -1.4, 3.8, 1.2, -0.6, 4.1, 2.7, -2.3, 1.9, 3.2, -0.8, 2.4],
    [3.4, 1.1, -2.7, 2.9, 4.6, -1.2, 0.8, 3.1, -3.4, 2.2, 1.7, 3.9],
    [1.8, 2.6, -0.9, 3.7, 2.1, 1.4, null, null, null, null, null, null],
  ],
};

// ---- Factor library 指标/因子库 ----
const FACTORS = [
  { key: "mom20", name: "20日动量", cat: "动量", ic: 0.043, icir: 0.62, cov: 0.98, hl: 12, on: true, weight: 0.16, desc: "过去20个交易日累计收益,捕捉短中期趋势延续。" },
  { key: "mom60", name: "60日动量", cat: "动量", ic: 0.051, icir: 0.71, cov: 0.97, hl: 28, on: true, weight: 0.12, desc: "过去60日累计收益,趋势更稳但反应更慢。" },
  { key: "ep", name: "盈利收益率 EP", cat: "价值", ic: 0.038, icir: 0.55, cov: 0.99, hl: 60, on: true, weight: 0.14, desc: "净利润 / 总市值,衡量估值便宜程度。" },
  { key: "bp", name: "账面市值比 BP", cat: "价值", ic: 0.029, icir: 0.41, cov: 0.99, hl: 75, on: false, weight: 0.00, desc: "净资产 / 总市值,经典价值因子。" },
  { key: "roe", name: "ROE 质量", cat: "质量", ic: 0.046, icir: 0.68, cov: 0.96, hl: 45, on: true, weight: 0.15, desc: "净资产收益率,盈利能力的核心代理。" },
  { key: "gm", name: "毛利率", cat: "质量", ic: 0.031, icir: 0.47, cov: 0.94, hl: 50, on: true, weight: 0.08, desc: "毛利 / 营收,反映护城河与定价权。" },
  { key: "sg", name: "营收增速", cat: "成长", ic: 0.040, icir: 0.58, cov: 0.92, hl: 40, on: true, weight: 0.10, desc: "单季营收同比增速,成长性度量。" },
  { key: "turn", name: "换手率情绪", cat: "情绪", ic: -0.027, icir: 0.39, cov: 0.99, hl: 6, on: false, weight: 0.00, desc: "高换手往往对应过热,负向选股。" },
  { key: "ivol", name: "特异波动率", cat: "波动", ic: -0.035, icir: 0.52, cov: 0.97, hl: 20, on: true, weight: 0.09, desc: "残差波动,低波动溢价(负向)。" },
  { key: "nb", name: "北向净流入", cat: "资金流", ic: 0.044, icir: 0.63, cov: 0.88, hl: 9, on: true, weight: 0.12, desc: "陆股通净买入强度,聪明钱流向。" },
  { key: "rev5", name: "5日反转", cat: "反转", ic: 0.033, icir: 0.49, cov: 0.98, hl: 5, on: true, weight: 0.04, desc: "短期超跌反弹,负相关于近5日收益。" },
];

// ---- Models 策略/模型 ----
const MODELS = [
  { id: "v24", name: "司南多因子 v2.4", status: "running", oosIC: 0.052, sharpe: 1.62, ann: 24.8, since: "2024-01", note: "当前生产模型" },
  { id: "v23", name: "司南多因子 v2.3", status: "archived", oosIC: 0.047, sharpe: 1.48, ann: 21.1, since: "2023-06", note: "已归档" },
  { id: "exp", name: "实验 · 动量增强", status: "draft", oosIC: 0.055, sharpe: 1.71, ann: 27.3, since: "2026-05", note: "样本外验证中,未上线" },
];

// ---- Sectors 行业板块 (今日) ----
// chg=涨跌幅%, flow=主力净流入(亿元,正流入/负流出), turnover=成交额(亿), up/down=涨跌家数, lead=领涨股
const SECTORS = [
  { name: "有色金属", chg: 4.12, flow: 38.6, turnover: 412, up: 86, down: 12, lead: "紫金矿业", spark: [0,0.6,0.4,1.2,1.8,2.4,2.1,3.0,3.6,4.1] },
  { name: "光伏设备", chg: 3.74, flow: 31.2, turnover: 386, up: 74, down: 9,  lead: "隆基绿能", spark: [0,-0.3,0.5,1.0,1.6,1.4,2.2,2.8,3.3,3.7] },
  { name: "电池",     chg: 2.88, flow: 26.4, turnover: 521, up: 63, down: 18, lead: "宁德时代", spark: [0,0.4,0.9,0.7,1.3,1.9,2.1,2.4,2.7,2.9] },
  { name: "半导体",   chg: 1.96, flow: 12.7, turnover: 468, up: 71, down: 33, lead: "海光信息", spark: [0,0.8,0.5,1.1,0.9,1.4,1.6,1.5,1.8,2.0] },
  { name: "软件开发", chg: 1.42, flow: 8.3,  turnover: 297, up: 58, down: 29, lead: "金山办公", spark: [0,0.3,0.7,0.6,1.0,1.2,1.1,1.3,1.4,1.4] },
  { name: "汽车整车", chg: 1.18, flow: 6.9,  turnover: 254, up: 22, down: 11, lead: "比亚迪",   spark: [0,0.5,0.4,0.8,0.7,1.0,0.9,1.1,1.2,1.2] },
  { name: "医疗器械", chg: 0.46, flow: 1.4,  turnover: 168, up: 41, down: 38, lead: "迈瑞医疗", spark: [0,0.3,-0.2,0.2,0.5,0.3,0.6,0.4,0.5,0.5] },
  { name: "食品饮料", chg: 0.24, flow: -2.1, turnover: 142, up: 33, down: 31, lead: "贵州茅台", spark: [0,0.2,-0.1,0.3,0.1,0.4,0.2,0.3,0.2,0.2] },
  { name: "银行",     chg: -0.62, flow: -9.8, turnover: 186, up: 8,  down: 34, lead: "招商银行", spark: [0,-0.2,-0.4,-0.3,-0.5,-0.4,-0.6,-0.5,-0.6,-0.6] },
  { name: "房地产",   chg: -1.34, flow: -14.2, turnover: 124, up: 11, down: 67, lead: "保利发展", spark: [0,-0.3,-0.6,-0.8,-0.7,-1.0,-1.1,-1.2,-1.3,-1.3] },
  { name: "证券",     chg: -1.86, flow: -21.5, turnover: 312, up: 5,  down: 43, lead: "东方财富", spark: [0,-0.5,-0.8,-1.1,-1.0,-1.4,-1.5,-1.6,-1.8,-1.9] },
  { name: "航运港口", chg: -2.41, flow: -16.7, turnover: 98,  up: 4,  down: 39, lead: "中远海控", spark: [0,-0.6,-1.0,-1.4,-1.3,-1.7,-2.0,-2.1,-2.3,-2.4] },
];

// ---- Sector constituents 板块成分股 (真实名称+代码, 指标由种子生成) ----
const SECTOR_STOCKS = {
  "有色金属": [["紫金矿业","601899",17.84],["洛阳钼业","603993",8.36],["北方稀土","600111",24.71],["山东黄金","600547",28.05],["华友钴业","603799",41.62],["赣锋锂业","002460",38.90],["中金黄金","600489",13.27],["锐能商务","603255",30.18]],
  "光伏设备": [["隆基绿能","601012",19.47],["通威股份","600438",28.64],["阳光电源","300274",78.20],["晶澳科技","002459",14.85],["TCL中环","002129",11.93],["福斯特","603806",16.40]],
  "电池": [["宁德时代","300750",251.88],["亿纬锂能","300014",42.16],["国轩高科","002074",23.55],["欣旺达","300207",19.78],["比亚迪","002594",268.40]],
  "半导体": [["海光信息","688041",112.30],["中芯国际","688981",52.74],["北方华创","002371",398.50],["韦尔股份","603501",106.20],["兆易创新","603986",87.41]],
  "软件开发": [["金山办公","688111",264.80],["用友网络","600588",12.34],["恒生电子","600570",24.07],["广联达","002410",13.95]],
  "汽车整车": [["比亚迪","002594",268.40],["长城汽车","601633",23.18],["赛力斯","601127",94.65],["上汽集团","600104",15.42],["长安汽车","000625",13.27]],
  "医疗器械": [["迈瑞医疗","300760",243.10],["联影医疗","688271",128.40],["鱼跃医疗","002223",33.62],["乐普医疗","300003",14.08]],
  "食品饮料": [["贵州茅台","600519",1486.30],["五粮液","000858",142.55],["泸州老窖","000568",128.70],["伊利股份","600887",26.18],["山西汾酒","600809",198.40]],
  "银行": [["招商银行","600036",38.92],["工商银行","601398",6.21],["兴业银行","601166",18.34],["平安银行","000001",11.27],["宁波银行","002142",24.86]],
  "房地产": [["保利发展","600048",8.74],["万科A","000002",7.12],["招商蛇口","001979",9.85],["金地集团","600383",5.43]],
  "证券": [["东方财富","300059",16.93],["中信证券","600030",26.41],["东方证券","600958",9.78],["国泰君安","601211",17.52]],
  "航运港口": [["中远海控","601919",13.46],["招商轮船","601872",7.85],["中远海能","600026",15.32],["上港集团","600018",6.27]],
};

// 根据代码+板块涨跌生成个股指标(确定性)
function enrichStocks(sectorName, sectorChg) {
  const list = SECTOR_STOCKS[sectorName] || [];
  return list.map(([name, code, price]) => {
    const seed = code.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng = mulberry32(seed);
    const chg = +(sectorChg + (rng() - 0.5) * 3.4).toFixed(2);
    const flow = +((rng() - 0.42) * (Math.abs(sectorChg) + 1) * 2.4).toFixed(2);
    const amt = +(price * (8 + rng() * 40)).toFixed(1);
    const turn = +(0.6 + rng() * 4).toFixed(2);
    const pe = +(6 + rng() * 40).toFixed(1);
    return { name, code, price, chg, flow, amt, turn, pe, prevClose: +(price / (1 + chg / 100)).toFixed(2) };
  }).sort((a, b) => b.chg - a.chg);
}

// 生成当日分时数据 (240分钟: 上午9:30-11:30 + 下午13:00-15:00)
function genIntraday(code, prevClose, chg) {
  const seed = code.split("").reduce((a, c) => a + c.charCodeAt(0), 3);
  const rng = mulberry32(seed);
  const N = 240;
  const target = prevClose * (1 + chg / 100);
  const price = [], avg = [], vol = [];
  let p = prevClose, cumPV = 0, cumV = 0;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // 朝目标价漂移 + 噪声
    const drift = (target - p) * 0.035;
    const noise = (rng() - 0.5) * prevClose * 0.0035;
    p = p + drift + noise;
    const v = 0.3 + rng() * 0.7 + (Math.abs(noise) / prevClose) * 40;
    cumPV += p * v; cumV += v;
    price.push(p); avg.push(cumPV / cumV); vol.push(v);
  }
  price[N - 1] = target;
  return { price, avg, vol, prevClose, N };
}

// 分时时间刻度
const INTRADAY_TICKS = ["9:30", "10:30", "11:30/13:00", "14:00", "15:00"];

// ---- Index summary 大盘指数 ----
const INDICES = [
  { name: "上证指数", code: "000001", price: 3284.62, chg: 0.86 },
  { name: "深证成指", code: "399001", price: 10472.18, chg: 1.24 },
  { name: "创业板指", code: "399006", price: 2138.94, chg: 1.92 },
  { name: "沪深300", code: "000300", price: 3912.45, chg: 0.71 },
];

// ---- Strategy pipeline 策略流水线 ----
const PIPELINE = [
  { k: "数据落库", d: "行情 / 财务 / 复权", icon: "db" },
  { k: "因子计算", d: "9 个启用因子 · 截面标准化", icon: "indicator" },
  { k: "合成打分", d: "ICIR 加权 + 中性化", icon: "model" },
  { k: "风控过滤", d: "ST / 流动性 / 停牌闸", icon: "shield" },
  { k: "组合构建", d: "Top20 等权 · 行业中性", icon: "portfolio" },
];

Object.assign(window, {
  mulberry32, QUOTES, genEquity, genCandles, SIGNALS, SIGNALS_BLOCKED,
  HOLDINGS_MODEL, HOLDINGS_PERSONAL, TRADES, genDaily, MONTHLY,
  FACTORS, MODELS, PIPELINE, SECTORS, INDICES,
  SECTOR_STOCKS, enrichStocks, genIntraday, INTRADAY_TICKS,
});
