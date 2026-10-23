/**
 * 门控与核心逻辑验收（Node DOM 桩）
 * 运行：node js/test-app.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

// ---------------- DOM 桩 ----------------
function mkEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    _h: "",
    style: {},
    dataset: {},
    value: "",
    checked: false,
    textContent: "",
    hidden: false,
    files: [],
    scrollTop: 0,
    clientHeight: 600,
    onclick: null,
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {},
    appendChild() {},
    click() {},
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._h; },
    set(v) { this._h = String(v); }
  });
  Object.defineProperty(el, "offsetWidth", { get() { return 100; } });
  return el;
}

const registry = new Map();
function getEl(sel) {
  if (!registry.has(sel)) {
    const el = mkEl(sel.includes("input") ? "input" : sel.includes("select") ? "select" : sel.includes("button") ? "button" : "div");
    if (sel === "#v-study") el.classList.add("on");
    registry.set(sel, el);
  }
  return registry.get(sel);
}

globalThis.document = {
  querySelector: (s) => getEl(s),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (t) => mkEl(t),
  documentElement: { dataset: {} },
  visibilityState: "visible"
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  WORDS_RAW: null
};
let store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.setInterval = () => 0;
globalThis.setTimeout = (fn) => { /* run sync for tests when needed */ return 0; };
globalThis.clearTimeout = () => {};
globalThis.confirm = () => false;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };

// ---------------- 加载数据与脚本 ----------------
const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
// window.WORDS_RAW = [...];
// 执行真实数据脚本，同时载入 WORD_BOOK_META 的数据版本与迁移信息。
new Function(wordsJs)();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;

const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try {
  // app.js 是 IIFE，会挂 window.__vocab
  new Function(appJs)();
} catch (e) {
  console.error("app.js 执行失败:", e.stack || e.message);
  process.exit(1);
}
const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab 调试钩子"); process.exit(1); }

const W = T.getW();
// importState 等会整体替换内部 state，各节需要时重新取，避免写到旧对象
let S = T.getS();

function resetFilter() {
  S.settings.fmin = 1; S.settings.fmax = 0; S.settings.pmin = 0;
  S.settings.kyOnly = false; S.settings.pos = [];
}

console.log("== 1. 数据完整性 ==");
const kaoyanMeta = globalThis.window.WORD_BOOK_META?.kaoyan;
const removedCount = (kaoyanMeta?.migrations || []).reduce((n, m) => n + m.removed.length, 0);
const addedCount = (kaoyanMeta?.migrations || []).reduce((n, m) => n + (Array.isArray(m.added) ? m.added.length : (Array.isArray(m.addedWords) ? m.addedWords.length : 0)), 0);
ck(W.length + removedCount - addedCount === 8100, "词条数与原始 8100 词及完整删除/新增迁移一致", `实际 ${W.length}，累计删除 ${removedCount}，新增 ${addedCount}`);
if (kaoyanMeta) ck(W.length === kaoyanMeta.wordCount, "考研 wordCount 与实际数组一致");
ck(W.every(x => x.w && x.w.length > 0), "每条都有单词");
ck(W.every(x => x.w === x.w.toLowerCase()), "单词均为小写原型");
ck(W.every(x => /^[a-z][a-z'-]*$/.test(x.w)), "单词只含 ASCII 字母");
ck(new Set(W.map(x => x.w)).size === W.length, "无重复单词");
ck(W.filter(x => x.m).length / W.length > 0.99, "释义覆盖率 > 99%",
  `${W.filter(x => x.m).length}/${W.length}`);
ck(W.every(x => x.m && x.m.length > 0), "每条都有中文释义");
ck(W.every(x => !/[\\^?@\uFFFD]/.test(x.ph || "")), "音标无已确认的乱码或转义残留");
["will", "may", "can", "one", "own"].forEach(w => {
  ck(W.some(x => x.w === w), `实义虚词已收录：${w}`);
});

console.log("== 2. 空格门控（核心） ==");
resetFilter();
S.settings.dailyNew = 50;
S.settings.order = "freq";
T.startSession();

ck(T.phase === "recall", "开局 phase=recall");
const cur1 = T.cur;
ck(cur1 != null, "开局有当前词", String(cur1));
const qi0 = T.qi;
const answered0 = T.answered;

// 未判定按「下一个」——不应翻页
T.tryNext(true);
ck(T.qi === qi0, "未判定 tryNext 不推进 qi", `qi ${qi0} -> ${T.qi}`);
ck(T.cur === cur1, "未判定 tryNext 不换词");
ck(T.phase === "recall", "未判定 tryNext 后仍为 recall");
ck(T.answered === answered0, "未判定 tryNext 不计入 answered");

// 判定后可以翻页
T.judge(true);
ck(T.phase === "revealed", "判定后 phase=revealed");
ck(T.verdict === true, "判定结果为会");
const answered1 = T.answered;
T.tryNext(true);
ck(T.qi === qi0 + 1, "已判定 tryNext 推进 qi", `qi ${T.qi}`);
ck(T.phase === "recall", "翻页后回到 recall");
ck(T.answered === answered1, "翻页不重复计 answered");

console.log("== 3. 判定 / 改判 / 撤销 ==");
const cur2 = T.cur;
const snapProg0 = JSON.stringify(S.progress[cur2] || null);
T.judge(false);
ck(T.verdict === false, "判定为不会");
const progAfterNo = S.progress[cur2];
ck(!!progAfterNo, "不会后写入 progress");
ck(progAfterNo[0] === 0, "不会后 stage=0");

T.judge(true); // 改判
ck(T.verdict === true, "改判为会");
const progAfterYes = S.progress[cur2];
ck(progAfterYes[0] === 1, "改判为会后 stage=1", `stage=${progAfterYes[0]}`);

T.undo(); // 撤销改判 -> 回到不会
ck(T.verdict === false, "撤销改判后回到不会", String(T.verdict));
ck(S.progress[cur2][0] === 0, "撤销改判后 stage 回到 0");

T.undo(); // 撤销判定 -> 回到 recall
ck(T.phase === "recall", "撤销判定后回到 recall");
ck(T.verdict === null, "撤销判定后 verdict=null");
ck(JSON.stringify(S.progress[cur2] || null) === snapProg0, "撤销判定后 progress 回滚");

console.log("== 4. 不会的词队尾重考 ==");
resetFilter();
S.settings.dailyNew = 50;
S.settings.order = "freq";
// 清空进度便于观察
S.progress = {};
T.startSession();
const qLen0 = T.Q.length;
const first = T.cur;
T.judge(false);
T.tryNext(true);
ck(T.Q.length === qLen0 + 1, "不会后队列追加重考", `${qLen0} -> ${T.Q.length}`);
ck(T.Q[T.Q.length - 1] === first, "重考词为当前词");

console.log("== 5. 筛选 / 范围 ==");
resetFilter();
ck(T.inScopeCount() === W.length, "不限筛选时范围=全库", String(T.inScopeCount()));
S.settings.fmin = 5;
const hi = T.inScopeCount();
ck(hi > 0 && hi < W.length, "fmin=5 时范围缩小", String(hi));
S.settings.fmin = 1;
S.settings.pmin = 10;
const p10 = T.inScopeCount();
ck(p10 > 0 && p10 < W.length, "pmin=10 时范围缩小", String(p10));
resetFilter();

console.log("== 6. 阶段函数 ==");
ck(T.masteredCount() === 0, "初始已掌握=0");
ck(T.countDue() === 0, "初始到期=0");

console.log("== 7. 艾宾浩斯 60 天档（回归） ==");
// 走满 10 档后才「已掌握」；第 10 档为 60 天
resetFilter();
S.progress = {};
S.days = {};
S.settings.dailyNew = 50;
const wi = T.getW().findIndex(x => x.w === "people");
function knowTo(targetStage) {
  for (let k = 0; k < 20; k++) {
    const p = S.progress[wi];
    const curStage = p ? p[0] : 0;
    if (curStage >= targetStage) break;
    T.setCur(wi);
    T.setVerdict(null);
    T.judge(true);
  }
  return S.progress[wi];
}
// 第 9 次会 -> stage=9，下一档 30 天
knowTo(9);
ck(S.progress[wi][0] === 9, "9 次会后 stage=9", String(S.progress[wi][0]));
// 第 10 次会 -> stage=10（第 10 档 · 60 天），尚未掌握
T.setCur(wi); T.setVerdict(null); T.judge(true);
const progS10 = S.progress[wi];
ck(progS10[0] === 10, "第 10 次会后 stage=10（60 天档）", String(progS10[0]));
const delayDays = (progS10[1] - Date.now()) / 86400000;
ck(delayDays > 59 && delayDays < 61, "第 10 档间隔约 60 天", delayDays.toFixed(2));
ck(S.progress[wi][0] < 11, "10 次会后尚未已掌握");
// 第 11 次会 -> 已掌握
T.setCur(wi); T.setVerdict(null); T.judge(true);
ck(S.progress[wi][0] === 11, "第 11 次会后 stage=11 已掌握", String(S.progress[wi][0]));
ck(S.progress[wi][0] >= 11, "isMastered 边界");

console.log("== 8. 错词优先（回归） ==");
resetFilter();
S.settings.dailyNew = 20;
S.settings.pmin = 0;
S.progress = {};
S.days = {};
// 造两个到期复习词：A 错 3 次，B 错 0 次
const wA = T.getW().findIndex(x => x.w === "people");
const wB = T.getW().findIndex(x => x.w === "answer");
const now0 = Date.now();
S.progress[wA] = [1, now0 - 1000, 0, 3, now0]; // 到期，错 3
S.progress[wB] = [1, now0 - 5000, 2, 0, now0]; // 到期更早，错 0
S.settings.order = "wrong";
T.startSession();
const idxA = T.Q.indexOf(wA), idxB = T.Q.indexOf(wB);
ck(idxA >= 0 && idxB >= 0, "两个到期词都入队", `${idxA},${idxB}`);
ck(idxA < idxB, "错词优先：错 3 次的排在错 0 次之前", `${idxA} vs ${idxB}`);
S.settings.order = "freq";
T.startSession();
const idxA2 = T.Q.indexOf(wA), idxB2 = T.Q.indexOf(wB);
ck(idxA2 > idxB2, "词频/到期序：到期更早的 B 在前", `${idxA2} vs ${idxB2}`);

console.log("== 9. normalizeState · 进度与日期边界 ==");
{
  const base = () => ({ dv: S.dv, settings: {}, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 });
  const throws = o => { try { T.normalizeState(o); return false; } catch (e) { return true; } };
  const keeps = o => { try { return T.normalizeState(o); } catch (e) { return null; } };
  const badProg = [
    { "01": [1, 0, 1, 0, 0] },
    { [W.length]: [1, 0, 1, 0, 0] },
    { 0: [1, 0, 1, 0] },
    { 0: [1, 0, 1, 0, 0, 9] },
    { 0: [12, 0, 1, 0, 0] },
    { 0: [1.5, 0, 1, 0, 0] },
    { 0: [1, 0, 1.5, 0, 0] },
    { 0: [1, 0, 1, 2.5, 0] },
    { 0: [NaN, 0, 1, 0, 0] }
  ];
  ck(badProg.every(p => throws({ ...base(), progress: p })), "非法 progress（索引/长度/类型/stage 上限）均拒绝");
  const ok11 = keeps({ ...base(), progress: { 0: [11, 0, 11, 0, 0] } });
  const okLast = keeps({ ...base(), progress: { [W.length - 1]: [1, 0, 1, 0, 0] } });
  ck(ok11 && ok11.progress[0][0] === 11 && okLast && okLast.progress[W.length - 1],
    "stage=已掌握上限与末尾索引合法保留");
  ck(keeps({ ...base(), days: { "2024-02-29": { n: 1, r: 1, ok: 1, no: 0 } } })
    && throws({ ...base(), days: { "2023-02-29": { n: 1, r: 1, ok: 1, no: 0 } } })
    && throws({ ...base(), days: { "2026-02-30": { n: 1, r: 1, ok: 1, no: 0 } } }),
    "闰日合法，非闰年 2-29 / 2-30 拒绝");
  ck(throws({ ...base(), days: { "2026-10-10": { n: 3, r: 2, ok: 2, no: 0 } } })
    && throws({ ...base(), days: { "2026-10-10": { n: 1, r: 5, ok: 2, no: 2 } } })
    && keeps({ ...base(), days: { "2026-10-10": { n: 0, r: 0, ok: 0, no: 0 } } }),
    "每日记录：n>r / 对错不符拒绝，全零合法");
  const st = keeps({ ...base(), stars: { 0: 0, 1: 2, 2: "x" } });
  ck(st && st.stars[0] === undefined && st.stars[1] === 1 && st.stars[2] === 1
    && throws({ ...base(), stars: { [W.length]: 1 } }),
    "收藏假值丢弃、真值归一为 1，越界拒绝");
  const t0 = keeps({ ...base(), timeSec: -10 }), t1 = keeps({ ...base(), timeSec: 1.7 });
  ck(t0 && t0.timeSec === 0 && t1 && t1.timeSec === 1
    && throws({ ...base(), proficient: { people: 0 } })
    && throws({ ...base(), proficient: { "not-a-word": Date.now() } }),
    "时长负数→0、小数取整；熟练时间戳 0 / 未知词拒绝");
}

console.log("== 10. normalizeState · 设置边界 ==");
{
  const n = o => T.normalizeState({ settings: o, progress: {}, days: {} }).settings;
  ck(n({ dailyNew: 0 }).dailyNew === 1 && n({ dailyNew: 1.9 }).dailyNew === 1
    && n({ dailyNew: -5 }).dailyNew === 20 && n({ dailyNew: 99999 }).dailyNew === 500,
    "dailyNew 边界：0→1、小数取整、负数→20、超限→500");
  ck(n({ fmin: 5, fmax: 2 }).fmax === 5 && n({ fmin: 3, fmax: 0 }).fmax === 0
    && n({ pmin: 1.5 }).pmin === 1 && n({ pmin: -3 }).pmin === 2 && n({ pmin: 99 }).pmin === 46,
    "fmax<fmin 抬升；fmax=0 不限；pmin 同规则钳制");
  const pos = n({ pos: ["n", "n", "bogus", "v", "x"] }).pos;
  ck(pos.join(",") === "n,v,x", "pos 去重并滤掉非法项", pos.join(","));
  const k1 = n({ keys: { know: "F", dont: "1", next: " ", speak: "s", star: "b", proficient: "m" } }).keys;
  const k2 = n({ keys: { know: "ab", dont: "?", next: "Enter", speak: "s", star: "b", proficient: "m" } }).keys;
  const k3 = n({ keys: { know: "f", dont: "F", next: " ", speak: "s", star: "b", proficient: "m" } }).keys;
  ck(k1.know === "f" && k1.dont === "1" && k1.next === " " && k2.know === "f" && k2.dont === "j"
    && k3.know === "f" && k3.dont === "j",
    "快捷键：大写转小写、非法忽略、大小写冲突整组回默认", JSON.stringify([k1, k2, k3]));
  const raw = {
    settings: { dailyNew: 20, fmin: 3, fmax: 2, pmin: 1.5, pos: ["n", "x", "zz"], order: "wrong", keys: { know: "F", dont: "j", next: " ", speak: "s", star: "b", proficient: "m" } },
    progress: { 0: [2, Date.now() + 100, 3, 1, Date.now()] },
    days: { "2026-10-01": { n: 1, r: 3, ok: 2, no: 1 } },
    stars: { 3: 1, 4: 0 },
    proficient: {},
    timeSec: 3.9
  };
  const n1 = JSON.stringify(T.normalizeState(raw));
  const n2 = JSON.stringify(T.normalizeState(JSON.parse(n1)));
  ck(n1 === n2 && JSON.parse(n1).timeSec === 3, "normalizeState 幂等且顶层 timeSec 取整");
}

console.log("== 11. 艾宾浩斯 · 改判不叠加 / 撤销链 ==");
{
  const dayKey = () => { const d = new Date(); const p = x => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  resetFilter();
  S.progress = {}; S.days = {};
  S.settings.dailyNew = 50; S.settings.order = "freq";
  const wi = W.findIndex(x => x.w === "people");
  T.setCur(wi); T.setVerdict(null);
  T.judge(true); T.judge(false); T.judge(true); T.judge(false); T.judge(true);
  ck(S.progress[wi][0] === 1 && S.days[dayKey()].n === 1 && S.days[dayKey()].r === 1 && T.answered === 1,
    "改判来回多次 stage 仍为 1，新词/复习/answered 不叠加",
    JSON.stringify({ stage: S.progress[wi][0], days: S.days[dayKey()], answered: T.answered }));
  const same = JSON.stringify(S.progress[wi]);
  T.judge(true);
  ck(JSON.stringify(S.progress[wi]) === same, "重复判定同一结果不写进度");

  S.progress[wi] = [11, Date.now() + 86400000, 11, 0, Date.now()];
  T.setCur(wi); T.setVerdict(null); T.judge(true);
  const at11 = S.progress[wi][0] === 11;
  T.setVerdict(null); T.judge(false);
  ck(at11 && S.progress[wi][0] === 0, "已掌握再「会」不升档，「不会」归零");

  S.progress = {}; S.days = {};
  T.startSession();
  const w0 = T.cur;
  T.judge(true); T.tryNext(true);
  const w1 = T.cur;
  T.judge(false); T.judge(true); T.tryNext(true);
  const w2 = T.cur;
  T.judge(false);
  const steps = [];
  T.undo(); steps.push(T.cur === w2 && T.verdict === null && S.progress[w2] === undefined);
  T.undo(); steps.push(T.cur === w1 && T.verdict === true && S.progress[w1][0] === 1);
  T.undo(); steps.push(T.cur === w1 && T.verdict === false && S.progress[w1][0] === 0);
  T.undo(); steps.push(T.cur === w1 && T.verdict === null && S.progress[w1] === undefined);
  T.undo(); steps.push(T.cur === w0 && T.verdict === true && S.progress[w0][0] === 1);
  T.undo(); steps.push(T.cur === w0 && T.verdict === null && S.progress[w0] === undefined && T.answered === 0);
  ck(steps.every(Boolean), "撤销链逐步回滚判定/改判/翻页直至清零", steps.join(","));
}

console.log("== 12. 范围 / 筛选组合 ==");
{
  resetFilter();
  S.settings.pos = ["n"];
  const a = T.inScopeCount() === W.filter(x => x.p === 0).length;
  S.settings.pos = ["x"];
  const b = T.inScopeCount() === W.filter(x => ![0, 1, 2, 3].includes(x.p)).length;
  S.settings.pos = ["n", "v"];
  const c = T.inScopeCount() === W.filter(x => x.p === 0 || x.p === 1).length;
  ck(a && b && c, "pos=名词 / 其他 / 名+动 计数与词库一致");
  S.settings.pos = [];
  S.settings.fmin = 5; S.settings.pmin = 3; S.settings.fmax = 20;
  const combo = T.inScopeCount() === W.filter(x => x.f >= 5 && x.f <= 20 && x.c >= 3).length;
  S.settings.kyOnly = true;
  const ky = T.inScopeCount() === W.filter(x => x.f >= 5 && x.f <= 20 && x.c >= 3 && x.ky === 1).length;
  ck(combo && ky, "fmin+pmin+fmax 组合与叠加 kyOnly 收窄均精确");
  resetFilter();
  S.settings.fmin = 9999;
  S.progress[0] = [1, Date.now() - 1000, 1, 0, Date.now()];
  T.startSession();
  ck(T.inScopeCount() === 0 && T.Q.length === 0 && T.cur === null && T.countDue() === 0,
    "范围内 0 词时队列为空，范围外到期词不入队/不计到期");
  resetFilter();
}

console.log("== 12b. 词频直方图与双端滑块 ==");
{
  resetFilter();
  const hist = T.freqHistogram();
  ck(hist.total === W.length, "直方图总数等于词频之外的筛选结果",
    `${hist.total} vs ${W.length}`);
  ck(hist.bins.length === 20 && hist.bins.reduce((n, b) => n + b.count, 0) === hist.total,
    "20 个对数分桶且柱高之和等于总数");
  let mismatch = 0, emptyBins = 0;
  for (const x of W) {
    const bin = hist.bins.find(b => x.f >= b.lo && x.f <= b.hi);
    if (!bin) mismatch++;
  }
  for (const b of hist.bins) if (!b.count) emptyBins++;
  ck(mismatch === 0, "每个词都落在自己的频段内", `错位 ${mismatch}`);
  ck(emptyBins === 0, "低频分桶无空洞，柱形连续可读", `空桶 ${emptyBins}`);
  ck(T.freqToPos(1, hist.maxF) === 0 && T.freqToPos(hist.maxF, hist.maxF) === 1000,
    "频率 → 滑块位置：1 在最左、最高频在最右");
  ck(T.posToFreq(0, hist.maxF, false) === 1
    && T.posToFreq(1000, hist.maxF, false) === hist.maxF
    && T.posToFreq(1000, hist.maxF, true) === 0,
    "滑块位置 → 频率：下界 1、上界最高频 / 不限");
  S.settings.fmin = 1; S.settings.fmax = 5;
  const upper = W.filter(x => x.f <= 5 && !S.proficient[x.w]).length;
  ck(T.inScopeCount() === upper, "上界 5 次精确剔除高频词", `${T.inScopeCount()} vs ${upper}`);
  S.settings.fmin = 5; S.settings.fmax = 20;
  const band = W.filter(x => x.f >= 5 && x.f <= 20 && !S.proficient[x.w]).length;
  ck(T.inScopeCount() === band, "双端区间 5–20 次精确生效", `${T.inScopeCount()} vs ${band}`);
  S.settings.pmin = 3;
  const base = T.freqHistogram();
  ck(base.total === W.filter(x => x.c >= 3).length,
    "直方图跟随套卷筛选、但不随词频区间变形", `${base.total}`);
  resetFilter();
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(/id="freqBars"/.test(html) && /id="fminRange"/.test(html) && /id="fmaxRange"/.test(html),
    "设置页含直方图与双端滑块");
  ck(/id="freqTrack"/.test(html) && /id="freqFill"/.test(html)
    && html.includes("低频") && html.includes("高频"),
    "设置页含独立轨道、选中段与低频/高频方向标注");
  ck(['data-fmax="5"', 'data-fmax="10"', 'data-fmax="20"'].every(s => html.includes(s)),
    "设置页含 ≤5 / ≤10 / ≤20 次上界快捷预设");
}

console.log("== 13. 会话 · 重建 / 配额 / 重考上限 ==");
{
  resetFilter();
  S.progress = {}; S.days = {};
  S.settings.dailyNew = 2; S.settings.order = "freq";
  T.startSession();
  T.judge(true); T.tryNext(true); T.judge(true); T.tryNext(true);
  const dayRec = () => S.days[Object.keys(S.days)[0]];
  T.startSession();
  ck(T.answered === 0 && T.qi === 0 && dayRec().n === 2,
    "连续 startSession 重置计数，新词配额跨会话保留");
  ck(T.buildQueue(Date.now()).fresh.length === 0, "配额用尽后新词不再入队");
  const dueIdx = W.findIndex((x, i) => i !== 8095);
  S.progress[dueIdx] = [1, Date.now() - 1000, 1, 0, Date.now() - 5000];
  const futureIdx = dueIdx + 1;
  S.progress[futureIdx] = [3, Date.now() + 86400000, 3, 0, Date.now()];
  T.startSession();
  ck(T.Q.includes(dueIdx) && !T.Q.includes(futureIdx) && T.countDue() === 1,
    "到期词入队、未到期词不入队");

  S.settings.dailyNew = 30; S.settings.order = "shuffle";
  S.progress = {}; S.days = {};
  T.startSession();
  ck(JSON.stringify(T.buildQueue(Date.now())) === JSON.stringify(T.buildQueue(Date.now())),
    "shuffle 模式同会话 buildQueue 可复现");

  S.settings.dailyNew = 1; S.settings.order = "freq";
  S.progress = {}; S.days = {};
  T.startSession();
  const only = T.cur;
  T.judge(false); T.tryNext(true);
  const r1 = T.Q.length === 2 && T.Q[1] === only;
  T.judge(false); T.tryNext(true);
  const r2 = T.Q.length === 3 && T.Q[2] === only;
  T.judge(false); T.tryNext(true);
  ck(r1 && r2 && T.Q.length === 3 && T.cur === null,
    "错词重考最多 2 轮封顶，不会无限入队", String(T.Q.length));
  resetFilter();
}

console.log("== 14. 导入导出 · 保真与类型强转 ==");
{
  S = T.getS();
  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  S.settings.dailyNew = 7;
  T.startSession();
  const i = T.cur, j = T.Q[1];
  T.judge(true);
  S.stars[j] = 1;
  const backup = JSON.parse(JSON.stringify(S));
  const clean = T.normalizeState(backup);
  ck(JSON.stringify(clean.progress[i]) === JSON.stringify(backup.progress[i])
    && clean.stars[j] === 1 && clean.settings.dailyNew === 7,
    "normalize 后进度/收藏/设置保真");
  const missing = T.normalizeState({ progress: {}, days: {} });
  ck(missing.settings.dailyNew === 20 && missing.timeSec === 0
    && Object.keys(missing.stars).length === 0 && Object.keys(missing.proficient).length === 0,
    "缺省 settings/timeSec/stars/proficient 走安全默认");
  const strN = T.normalizeState({ settings: { dailyNew: "30" }, progress: {}, days: {} }).settings.dailyNew;
  const fltN = T.normalizeState({ settings: { dailyNew: 7.9 }, progress: {}, days: {} }).settings.dailyNew;
  let threw = false;
  try { T.normalizeState({ progress: { 0: ["1", 0, 1, 0, 0] }, days: {} }); } catch (e) { threw = true; }
  ck(strN === 20 && fltN === 7 && threw,
    "非数值字符串落到默认 20、小数取整，字符串 stage 拒绝");

  T.importState(backup);
  S = T.getS();
  const after1 = JSON.stringify(S.progress);
  T.importState(JSON.parse(JSON.stringify(S)));
  S = T.getS();
  ck(JSON.stringify(S.progress) === after1, "重复导入不改变进度");
  resetFilter();
}

console.log("== 15. 星标 / 收藏与熟练互不干扰 ==");
{
  S = T.getS();
  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  S.settings.dailyNew = 20; S.settings.order = "freq";
  T.startSession();
  const i = T.cur;
  S.stars[i] = 1;
  const independent = T.Q.includes(i) && !T.isProficient(i);
  T.setProficient(i, true);
  S = T.getS();
  const keepStar = S.stars[i] === 1 && T.isProficient(i) && !T.Q.includes(i);
  T.setProficient(i, false);
  S = T.getS();
  ck(independent && keepStar && S.stars[i] === 1,
    "收藏不影响队列，熟练保留/恢复收藏，互不覆盖");
  getEl("#fst").value = "star"; getEl("#fsc").value = "all"; getEl("#q").value = "";
  T.applyFilter();
  const inFilter = new RegExp('data-i="' + i + '"').test(getEl("#listInner").innerHTML);
  delete S.stars[i];
  T.applyFilter();
  const outFilter = !new RegExp('data-i="' + i + '"').test(getEl("#listInner").innerHTML);
  ck(inFilter && outFilter, "星标筛选随收藏进入/移出");
  getEl("#fst").value = "all";
  resetFilter();
}

console.log("== 16. 统计 KPI 边界 ==");
{
  S = T.getS();
  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = 0;
  T.show("stats");
  let kpi = getEl("#kpis").innerHTML;
  ck(!/NaN/.test(kpi) && !/<b>-\d/.test(kpi)
    && kpi.includes("<b>—</b><span>累计正确率</span>")
    && kpi.includes("<b>0 分钟</b><span>累计时长</span>")
    && kpi.includes("<b>0 天</b><span>连续打卡</span>"),
    "空库 KPI 无 NaN/负数，正确率与连续打卡为占位/零");

  for (let i = 0; i < W.length; i++) S.progress[i] = [11, Date.now() + 86400000, 11, 0, Date.now()];
  S.timeSec = 3661;
  T.show("stats");
  kpi = getEl("#kpis").innerHTML;
  ck(kpi.includes("<b>" + W.length + "</b><span>已掌握</span>")
    && kpi.includes("<b>0</b><span>未学</span>")
    && kpi.includes("<b>0</b><span>学习中</span>")
    && kpi.includes("1 小时 1 分"),
    "全掌握 KPI=全库，未学/学习中为 0，时长按小时格式化");

  S.proficient = { [W[0].w]: Date.now() };
  S.stars = { 0: 1, 1: 1, 2: 1 };
  S.progress[3] = [2, Date.now() - 1, 2, 4, Date.now()];
  S.days["2026-10-01"] = { n: 1, r: 3, ok: 1, no: 2 };
  T.show("stats");
  kpi = getEl("#kpis").innerHTML;
  const unlearned = Number((kpi.match(/<b>(\d+)<\/b><span>未学/) || [])[1]);
  ck(kpi.includes("<b>1</b><span>熟练（全词库）</span>")
    && kpi.includes("<b>3</b><span>收藏</span>")
    && kpi.includes("<b>1</b><span>错词</span>")
    && !/NaN/.test(kpi) && !/<b>-\d/.test(kpi)
    && Number.isFinite(unlearned) && unlearned >= 0,
    "部分熟练时 KPI 分项自洽且未学非负");
  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = 0;
}

console.log("== 16b. 统计可视化数据 ==");
{
  S = T.getS();
  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = 0;
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const nowMs = now.getTime();
  const at = (offset, hour = 12) => {
    const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0); return d.getTime();
  };
  S.progress[0] = [1, at(-2), 1, 0, nowMs];
  S.progress[1] = [1, at(0, 18), 1, 0, nowMs];
  S.progress[2] = [1, at(1), 1, 0, nowMs];
  S.progress[3] = [1, at(5), 1, 0, nowMs];
  S.progress[4] = [1, at(20), 1, 0, nowMs];
  const fc = T.dueForecast(14, nowMs);
  ck(fc.counts[0] === 2 && fc.overdue === 1 && fc.dueToday === 1,
    "复习负荷：今天柱包含已到期与今天稍后到期", JSON.stringify(fc));
  ck(fc.counts[1] === 1 && fc.counts[5] === 1 && fc.later === 1
    && fc.total === 4 && fc.next7 === 4 && fc.peak === 0,
    "复习负荷：未来分桶、7/14 天合计与 14 天后余量正确", JSON.stringify(fc));

  S.progress = {};
  const hi = W.findIndex(x => x.f >= 20);
  const hi2 = W.findIndex((x, i) => x.f >= 20 && i !== hi);
  const highTotal = W.filter(x => x.f >= 20).length;
  S.progress[hi] = [11, at(1), 11, 0, nowMs];
  S.progress[hi2] = [2, at(1), 2, 0, nowMs];
  const fm = T.frequencyMastery();
  const high = fm.rows.find(r => r.key === "high");
  ck(high && high.total === highTotal && high.mastered === 1 && high.learning === 1
    && high.unseen === highTotal - 2,
    "词频分层：高频段已掌握/学习中/未学分组正确", JSON.stringify(high));
  ck(fm.total === W.length && fm.mastered === 1
    && fm.rows.reduce((n, r) => n + r.total, 0) === W.length,
    "词频分层：所有范围内单词都落入分层且总数一致");

  resetFilter();
  const pad = n => String(n).padStart(2, "0");
  const today = new Date();
  S.days[today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate())] =
    { n: 2, r: 5, ok: 4, no: 1 };
  T.show("stats");
  ck(/mm-track/.test(getEl("#masteryMeter").innerHTML)
    && /mm-mastered/.test(getEl("#masteryMeter").innerHTML),
    "总览渲染掌握率堆叠进度条");
  ck(/fc-col/.test(getEl("#forecast").innerHTML) && /fc-bar/.test(getEl("#forecast").innerHTML)
    && /今日待复习/.test(getEl("#forecastSummary").textContent || ""),
    "复习负荷面板渲染柱形与摘要");
  ck(/fm-mastered/.test(getEl("#freqMastery").innerHTML)
    && /高频/.test(getEl("#freqMastery").innerHTML),
    "词频分层面板渲染堆叠条");
  ck(/day-new/.test(getEl("#days").innerHTML) && /day-rev/.test(getEl("#days").innerHTML)
    && /新词 2/.test(getEl("#daysSummary").textContent || ""),
    "近 14 天柱形区分新词与复习");
  ck(/tg-track/.test(getEl("#todayGoal").innerHTML)
    && /今日新词/.test(getEl("#todayGoal").innerHTML),
    "复习安排面板渲染今日新词进度");
  ck(/sg-track/.test(getEl("#surveyGauge").innerHTML),
    "随机抽样面板渲染置信区间轨道");
  const statsHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(/id="todayGoal"/.test(statsHtml) && /id="surveyGauge"/.test(statsHtml)
    && /id="forecast"/.test(statsHtml) && /id="freqMastery"/.test(statsHtml),
    "统计页含今日进度、抽样区间、复习负荷与词频分层容器");

  resetFilter();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = 0;
}

console.log("== 17. 快捷组合「恢复默认筛选」语义 ==");
{
  const S0 = T.getS();
  S0.proficient = {};
  // 从乱改状态恢复：应回到 DEF 默认（含 ≥2 套卷），而不是清空全部限制
  Object.assign(S0.settings, {
    fmin: 5, fmax: 20, pmin: 10, kyOnly: true, pos: ["n"],
    dailyNew: 55, order: "wrong"
  });
  T.applyComboFilters("reset");
  ck(S0.settings.fmin === 1 && S0.settings.fmax === 0 && S0.settings.pmin === 2
    && S0.settings.kyOnly === false && S0.settings.pos.length === 0,
    "reset=恢复默认筛选：词频不限 + ≥2 套卷 + 词性不限 + 大纲关",
    JSON.stringify({ fmin: S0.settings.fmin, fmax: S0.settings.fmax, pmin: S0.settings.pmin, kyOnly: S0.settings.kyOnly, pos: S0.settings.pos }));
  ck(T.inScopeCount() === W.filter(x => x.f >= 1 && x.c >= 2).length,
    "恢复默认后范围恰为 ≥2 套卷的词（默认筛选真实生效）", String(T.inScopeCount()));
  ck(S0.settings.dailyNew === 55 && S0.settings.order === "wrong",
    "恢复默认筛选不改动每日新词/背诵顺序");

  T.applyComboFilters("core");
  const core = S0.settings.fmin === 5 && S0.settings.fmax === 0 && S0.settings.pmin === 3
    && !S0.settings.kyOnly && S0.settings.pos.length === 0;
  T.applyComboFilters("cold");
  const cold = S0.settings.fmin === 1 && S0.settings.fmax === 2 && S0.settings.pmin === 0;
  T.applyComboFilters("adj");
  const adj = S0.settings.pmin === 0 && S0.settings.pos.length === 1 && S0.settings.pos[0] === "a";
  ck(core && cold && adj, "核心必考/冷门补充/只背形容词语义不变");

  // 「全部不限」不再由 reset 提供，用套卷数选「不限」表达
  T.applyComboFilters("reset");
  S0.settings.pmin = 0;
  ck(T.inScopeCount() === W.filter(x => x.f >= 1).length,
    "套卷数选「不限」= 全部不限（词频仍 ≥1）", String(T.inScopeCount()));

  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(indexHtml.includes('data-combo="reset">恢复默认筛选<') && !indexHtml.includes("重置筛选"),
    "index.html 按钮文案已改为「恢复默认筛选」");
}

console.log("== 12. 乱序随机抽样 · 掌握率估计 ==");
{
  // Wilson 95% 置信区间
  const wci = T.wilsonInterval(5, 10);
  ck(Math.abs(wci.rate - 0.5) < 1e-9 && Math.abs(wci.lo - 0.2366) < 0.002 && Math.abs(wci.hi - 0.7634) < 0.002,
    "Wilson 95% 区间：5/10 → [23.7%, 76.3%]", JSON.stringify(wci));
  const w0 = T.wilsonInterval(0, 0);
  ck(w0.rate === 0 && w0.lo === 0 && w0.hi === 0, "n=0 时区间为 0，不产生 NaN");
  const w10 = T.wilsonInterval(10, 10);
  ck(Math.abs(w10.hi - 1) < 1e-9 && w10.lo > 0.7, "10/10 上界为 100%", JSON.stringify(w10));

  // 清空状态，从乱序模式开始抽样
  S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  Object.assign(S.settings, {order: "shuffle", dailyNew: 20, pmin: 0, fmin: 1, fmax: 0, kyOnly: false, pos: []});
  T.resetSurvey();
  T.startSession();
  ck(!getEl("#surveyChip").hidden, "乱序模式显示统计条「首次自评」chip");

  const i1 = T.cur, w1 = W[i1].w;
  T.judge(true);
  let sv = T.getSurveyStats();
  ck(sv.n === 1 && sv.k === 1 && T.getSurvey()[w1] === 1,
    "首个新词答「会」计入样本（1/1）", JSON.stringify(sv));
  ck(getEl("#s-survey").textContent === "100%", "chip 实时显示 100%", getEl("#s-survey").textContent);
  ck(String(globalThis.localStorage.getItem("kaoyan_vocab_survey_v1") || "").includes(w1),
    "抽样样本持久化到独立存储键，不进主进度记录");

  T.judge(false);   // 改判 → 样本同步修正
  sv = T.getSurveyStats();
  ck(sv.n === 1 && sv.k === 0 && T.getSurvey()[w1] === 0, "改判后样本同步修正为 0/1", JSON.stringify(sv));

  T.tryNext(true);
  const i2 = T.cur, w2 = W[i2].w;
  T.judge(true);
  sv = T.getSurveyStats();
  ck(sv.n === 2 && sv.k === 1 && Math.abs(sv.rate - 0.5) < 1e-9,
    "第二个词答「会」→ 2 词中 1 词掌握（50%）", JSON.stringify(sv));
  ck(w2 !== w1, "抽样按单词去重");

  T.undo();   // 撤销判定 → 样本一起回滚
  sv = T.getSurveyStats();
  ck(sv.n === 1 && sv.k === 0, "撤销判定同时撤销样本", JSON.stringify(sv));

  // 非乱序模式不计入
  S.settings.order = "freq";
  T.startSession();
  ck(getEl("#surveyChip").hidden, "非乱序模式隐藏统计条 chip");
  const nBefore = T.getSurveyStats().n;
  T.judge(true);
  ck(T.getSurveyStats().n === nBefore, "按词频顺序答题不计入随机抽样");

  // 复习词（已有进度）不计入
  S.settings.order = "shuffle";
  T.startSession();
  const i3 = T.cur;
  S.progress[i3] = [3, Date.now() - 1000, 2, 0, Date.now() - 86400000];
  T.judge(true);
  ck(T.getSurveyStats().n === nBefore, "复习词首次作答也不计入随机抽样");

  // 统计页面板与文案
  T.show("stats");
  const panel = getEl("#surveyKpis").innerHTML;
  ck(panel.includes("历史首次就会") && panel.includes("95% 置信区间") && panel.includes("历史样本"),
    "统计页显示历史首次自评/置信区间/样本量", panel.slice(0, 120));
  ck(String(getEl("#surveyHint").textContent).includes("不能外推"),
    "统计页明确不能外推为当前范围或全书掌握率", getEl("#surveyHint").textContent);

  // 重置
  T.resetSurvey();
  ck(T.getSurveyStats().n === 0 && globalThis.localStorage.getItem("kaoyan_vocab_survey_v1") === null,
    "resetSurvey 清空样本与存储键");
  const idxHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(idxHtml.includes('id="surveyChip"') && idxHtml.includes('id="surveyKpis"')
    && idxHtml.includes("历史首次自评"),
    "index.html 含掌握率 chip 与统计面板");
}

console.log("== 18. 首次打开默认值 · 主题入口 · 乱序命名 ==");
{
  const d = T.normalizeState({ progress: {}, days: {} }).settings;
  ck(d.dailyNew === 20 && d.order === "shuffle" && d.theme === "light",
    "首次打开默认：每日 20 词 / 随机乱序 / 浅色主题", JSON.stringify([d.dailyNew, d.order, d.theme]));
  ck(T.getBook() === "kaoyan", "首次打开默认词书为考研", T.getBook());
  const keep = T.normalizeState({ settings: { theme: "dark", order: "wrong", dailyNew: 50 }, progress: {}, days: {} }).settings;
  ck(keep.theme === "dark" && keep.order === "wrong" && keep.dailyNew === 50,
    "已保存的显式主题/顺序/每日量不被新默认覆盖");
  const idxHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(idxHtml.includes('id="btnTheme"') && idxHtml.includes('class="icon-btn theme-toggle"')
    && idxHtml.includes("切换到深色模式"),
    "首页顶部 header 含深色/浅色切换按钮");
  ck(idxHtml.includes('<option value="shuffle">随机乱序</option>')
    && !idxHtml.includes("乱序（每组重新打乱）"),
    "背诵顺序选项已改名为「随机乱序」");
  ck(idxHtml.includes("随机乱序会在每组开始时重新打乱"), "顺序说明文案同步更新");
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  ck(css.includes(".theme-toggle") && css.includes('.theme-icon-sun') && css.includes('.theme-icon-moon'),
    "主题切换按钮图标样式存在（浅色月亮 / 深色太阳）");
}

console.log("== 19. 批次 C：首屏结构 · 范围摘要 · 统计页展开 ==");
{
  const idxHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

  // ---- 静态结构（09 首屏/统计页） ----
  ck(idxHtml.includes('<button type="button" class="brand-sub" id="scopeLabel"'),
    "#scopeLabel 改为可点按钮（查看/调整范围）");
  ck(idxHtml.includes('id="studyScope"'), "学习页含可点当前范围摘要 #studyScope");
  ck(/class="chip chip-new"[\s\S]*?id="ringFg"[\s\S]*?id="s-goal"/.test(idxHtml),
    "环形进度并入「今日新词」chip（#ringFg/#s-goal 同 chip）");
  ck(!idxHtml.includes("ring-chip"), "独立的 ring-chip 行已删除");
  ck(/id="surveyChip"[\s\S]*?id="surveyDetail"/.test(idxHtml) && idxHtml.includes('id="s-survey-n"'),
    "首次自评 chip 含样本量 #s-survey-n 与可展开说明 #surveyDetail");
  const detailPanels = idxHtml.match(/details class="panel stats-details(?: stats-wide)?"/g) || [];
  ck(detailPanels.length === 6, "统计页 6 个高阶面板使用原生 details", String(detailPanels.length));
  ck(idxHtml.includes('id="statsForecastPanel"') && idxHtml.includes('id="statsHeatmapPanel"'),
    "统计 details 面板 id 稳定，便于 QA/测试定位");
  const statsHtml = idxHtml.slice(idxHtml.indexOf('<section class="view" id="v-stats"'), idxHtml.indexOf('<!-- ============ 设置'));
  const statsOrder = ['review-action-panel', 'overview-panel', 'stats-analysis-heading', 'statsForecastPanel', 'surveyPanel', 'statsFreqPanel', 'statsStagesPanel', 'statsDaysPanel', 'statsHeatmapPanel', 'stats-storage-panel'];
  ck(statsOrder.every((key, i) => statsHtml.indexOf(key) >= 0 && (i === 0 || statsHtml.indexOf(key) > statsHtml.indexOf(statsOrder[i - 1]))),
    "统计真实 DOM 顺序为今日计划、学习总览、六项深入分析、备份，所有断点一致");
  const statsDetails = [...statsHtml.matchAll(/<details class="panel stats-details(?: stats-wide)?"[^>]*>/g)];
  ck(statsDetails.length === 6 && statsDetails.every(([tag]) => !/\bopen(?:[\s=>]|$)/.test(tag)),
    "六个分析面板默认关闭，展开由原生 details 管理");
  ck((statsHtml.match(/<summary><h3>[^<]+<\/h3><span class="panel-note">/g) || []).length === 6,
    "分析卡头的标题与口径为独立节点，图标不受长说明挤压");

  ck(idxHtml.includes('tabindex="-1"></section>') || idxHtml.includes('id="settings-scope" aria-labelledby="scopeTitle" tabindex="-1"'),
    "设置页「词库范围」可被范围摘要聚焦跳转");
  ck(css.includes(".study-scope") && css.includes(".survey-detail") && css.includes(".stats-details"),
    "新增样式（上下文条/自评说明/统计 details）存在");
  ck(!css.includes(":has(#groupStatus:has("), "CSS 不再使用 Chrome 不支持的嵌套 :has");
  ck(!css.includes(".ring-chip"), "无 ring-chip 残留样式");
  ck(/\.view\.on \{\s*display: block;\s*animation: viewIn \.16s/.test(css) && /\.answer \{[^}]*answerIn \.15s/.test(css),
    "入场动效收敛到 120–180ms（viewIn/cardIn .16s、answerIn .15s）");
  ck(!/\.card\.enter \{ animation: cardIn \.22s/.test(css), "旧 .22s 卡片入场动效已收敛");
  ck(!appJs.includes("#curveInfo"), "app.js 已清除 #curveInfo legacy 兜底路径");
  ck(appJs.includes("function renderStudyScope(") && appJs.includes("function shortScopeText(") && appJs.includes("function jumpToScopeSettings("),
    "范围摘要渲染/跳转函数存在");

  // ---- 行为：survey 样本量与可展开说明 ----
  S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  Object.assign(S.settings, {order: "shuffle", dailyNew: 20, pmin: 0, fmin: 1, fmax: 0, kyOnly: false, pos: []});
  T.resetSurvey();
  T.startSession();
  ck(getEl("#surveyDetail").hidden === false, "乱序模式显示首次自评说明入口");
  ck(getEl("#surveyChip").hidden === false, "乱序模式显示首次自评 chip");
  T.judge(true);
  ck(getEl("#s-survey-n").textContent === "样本 1", "chip 紧凑显示样本量", getEl("#s-survey-n").textContent);
  ck(String(getEl("#studyScope").textContent).includes("乱序") && String(getEl("#studyScope").textContent).includes("词"),
    "范围摘要显示顺序与词数", getEl("#studyScope").textContent);

  // ---- 行为（08 联动）：改设置后摘要显示“本组”冻结范围 ----
  S.settings.fmin = 5;
  T.show("set");
  ck(String(getEl("#studyScope").textContent).startsWith("本组"),
    "改设置只影响下一组：范围摘要仍显示本组冻结范围", getEl("#studyScope").textContent);
  ck(String(getEl("#studyScope").title).includes("下一组"),
    "范围摘要 title 说明设置将在下一组生效", getEl("#studyScope").title);
  ck(String(getEl("#scopeLabel").title).includes("点击"), "#scopeLabel title 说明可点击查看范围");

  // ---- 行为：错词为 0 折叠特训，有条常驻；有错词恢复 ----
  S.progress = {}; S.days = {}; S.settings.fmin = 1;
  T.startSession(); T.setCur(T.cur);
  ck(getEl("#btnDrill").hidden === true, "无错词时折叠 #btnDrill");
  ck(getEl("#studyScope").hidden === false, "无错词时上下文条常驻，范围摘要仍可见");
  T.judge(false);
  ck(getEl("#btnDrill").hidden === false && String(getEl("#drillHint").textContent).includes("错词本"),
    "有错词时显示特训入口与提示", JSON.stringify([getEl("#btnDrill").hidden, getEl("#drillHint").textContent]));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
