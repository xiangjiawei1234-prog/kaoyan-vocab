/**
 * 22 完成页挂机自动续背（回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四词库 + 受控时钟 + 捕获真实定时器），不复制业务逻辑。
 *
 * 覆盖：
 *  - 新用户默认开启（5 张 / 2 分钟 / 15 秒）与设置归一/预设/严格校验；
 *  - 触发条件：kind==="main" 真正完成、无待巩固、非额度暂停、无浮层/特训/子组、
 *    可见背诵完成页、连续 idleMs 无有效交互；
 *  - getCandidatesNow 候选口径：当前书/范围、排除熟练、剩余复习预算、新词余额、积压保护；
 *  - 阈值前后、不空开组；鼠标移动不算活动，点击/按键/触摸/滚动取消倒计时；
 *  - 后台/恢复/休眠不启动且回前台重新计时；跨天按新额度重算；切书四书独立；
 *  - 多标签短租约只允许一组启动；存储不可用放弃并提示手动继续、不循环空开组；
 *  - 应用内 refreshForResume+startSession（不 reload）；不消费额度/不判定/不增加学习时长；
 *  - 新组首个有效判定前「返回上一组结果」，判定后不可返回。
 *
 * 运行：node --max-old-space-size=512 js/test-autoresume.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const BOOK_KEYS = { kaoyan: "kaoyan_vocab_v1", cet4: "cet4_vocab_v1", cet6: "cet6_vocab_v1", combined: "combined_vocab_v1" };

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; const d = detail === undefined ? "" : String(detail); console.log(`  FAIL  ${label}  ${d.length > 400 ? d.slice(0, 400) + "…" : d}`); }
};
const clone = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- 受控时钟 ---------------- */
const RealDate = Date;
let now = new RealDate(2026, 9, 10, 12, 0, 0).getTime();
class ClockDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = ClockDate;
const advance = ms => { now += ms; };
const todayStr = () => {
  const d = new RealDate(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------------- DOM 桩 ---------------- */
function matchSelector(node, selector) {
  if (!node || !selector) return false;
  for (const part of String(selector).split(",")) {
    const sel = part.trim();
    let m;
    if ((m = sel.match(/^#([\w-]+)$/))) { if (node.id === m[1]) return true; continue; }
    if ((m = sel.match(/^\.([\w-]+)$/))) { if (node.classList && node.classList.contains(m[1])) return true; continue; }
    if ((m = sel.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/))) {
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (node.dataset && node.dataset[key] !== undefined && (m[2] === undefined || String(node.dataset[key]) === m[2])) return true;
      continue;
    }
    if (/^[a-z][a-z0-9-]*$/i.test(sel) && node.tagName === sel.toUpperCase()) return true;
  }
  return false;
}
function mkEl(tag = "div") {
  const events = new Map();
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), _h: "", style: {}, dataset: {}, value: "", checked: false,
    textContent: "", hidden: false, disabled: false, files: [], scrollTop: 0, tabIndex: 0,
    clientHeight: 600, clientWidth: 300, offsetWidth: 240, offsetHeight: 120,
    onclick: null, onchange: null, oninput: null, parentNode: null, selectedIndex: 0,
    children: [], _events: events,
    classList: {
      add(...a) { a.forEach(x => classes.add(x)); },
      remove(...a) { a.forEach(x => classes.delete(x)); },
      toggle(c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    removeEventListener() {},
    appendChild(child) { el.children.push(child); if (child) child.parentNode = el; return child; },
    remove() {},
    _attrs: {},
    setAttribute(k, v) { el._attrs[k] = String(v); if (k.startsWith("data-")) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    getAttribute(k) {
      if (Object.prototype.hasOwnProperty.call(el._attrs, k)) return el._attrs[k];
      if (k.startsWith("data-")) {
        const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (el.dataset && el.dataset[key] !== undefined) return String(el.dataset[key]);
      }
      return null;
    },
    matches(selector) { return matchSelector(el, selector); },
    closest(selector) { let n = el; while (n) { if (matchSelector(n, selector)) return n; n = n.parentNode; } return null; },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    contains(node) { let n = node; while (n) { if (n === el) return true; n = n.parentNode; } return false; },
    getBoundingClientRect() { return { left: 10, top: 10, right: 250, bottom: 130, width: 240, height: 120 }; },
    focus() { document.activeElement = el; },
    blur() {},
    click() { fireClick(el); },
    dispatch(type, extra = {}) { return fireEvent(el, type, extra); }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._h; },
    set(v) { el._h = String(v); }
  });
  return el;
}
function fireEvent(target, type, extra = {}) {
  const ev = Object.assign({
    type, target, detail: 1, preventDefault() {}, stopPropagation() {}, currentTarget: target
  }, extra);
  let node = target;
  while (node) {
    ev.currentTarget = node;
    if (typeof node["on" + type] === "function") node["on" + type](ev);
    for (const fn of node._events?.get?.(type) || []) fn(ev);
    node = node.parentNode;
  }
  return ev;
}
function fireClick(target) {
  const ev = { type: "click", target, detail: 1, preventDefault() {}, stopPropagation() {}, currentTarget: target };
  let node = target;
  while (node) {
    ev.currentTarget = node;
    if (typeof node.onclick === "function") node.onclick(ev);
    for (const fn of node._events?.get?.("click") || []) fn(ev);
    node = node.parentNode;
  }
  return ev;
}

/* ---------------- 存储 / 文档 / 窗口 ---------------- */
const store = new Map();
const failKeys = new Set();
const failReadKeys = new Set();
globalThis.localStorage = {
  getItem: k => { if (failReadKeys.has(k)) throw new Error("SecurityError"); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (failKeys.has(k)) throw new Error("QuotaExceededError"); store.set(k, String(v)); },
  removeItem: k => store.delete(k)
};
const registry = new Map();
function ensureEl(sel) {
  if (!registry.has(sel)) {
    const tag = sel.includes("button") || /#(ok|no|nx|undoBtn|again|star|extraBack|applySettingsRestart)$/.test(sel) ? "button"
      : /input|Select|#(fminRange|fmaxRange)$/.test(sel) ? "input" : "div";
    registry.set(sel, mkEl(tag));
  }
  return registry.get(sel);
}
const docHandlers = new Map();
const winHandlers = new Map();
const bodyEl = mkEl("body");
const views = ["study", "list", "stats", "set"].map(v => { const el = mkEl("section"); el.id = "v-" + v; return el; });
views[0].classList.add("on");
const navButtons = ["study", "list", "stats", "set"].map(v => { const b = mkEl("button"); b.dataset.v = v; return b; });
const keyButtons = ["know", "dont", "next", "speak", "star", "proficient"].map(k => { const b = mkEl("button"); b.dataset.k = k; return b; });
const closeButton = mkEl("button");
const posModeButtons = ["primary", "all"].map(mode => { const b = mkEl("button"); b.dataset.posMode = mode; return b; });
const posModeBox = mkEl("div");
posModeButtons.forEach(b => { b.parentNode = posModeBox; });
const posChips = ["n", "v", "a", "d", "x"].map(k => { const b = mkEl("button"); b.dataset.pos = k; return b; });
const comboButtons = ["reset", "core", "cold", "adj"].map(c => { const b = mkEl("button"); b.dataset.combo = c; b.textContent = c; return b; });
const resetButtons = ["plan", "scope", "appearance"].map(kind => { const b = mkEl("button"); b.dataset.reset = kind; return b; });
const pminPresetButtons = [0, 2, 3, 5, 10, 20].map(v => { const b = mkEl("button"); b.dataset.pmin = String(v); return b; });
globalThis.document = {
  querySelector: (s) => {
    if (s === ".view.on") return views.find(v => v.classList.contains("on")) || null;
    if (s === "#posMode") return posModeBox;
    const view = views.find(v => "#" + v.id === s);
    if (view) return view;
    return ensureEl(s);
  },
  querySelectorAll: (s) => {
    if (s === ".view") return views;
    if (s === ".nav button") return navButtons;
    if (s === ".keybtn") return keyButtons;
    if (s === "#helpSheet [data-close]" || s === "#helpSheet button") return [closeButton];
    if (s === "#posMode [data-pos-mode]" || s === "[data-pos-mode]") return posModeButtons;
    if (s === "#posChips button") return posChips;
    if (s === "[data-combo]") return comboButtons;
    if (s === "[data-reset]") return resetButtons;
    if (s === "#pminPresets button") return pminPresetButtons;
    return [];
  },
  addEventListener(type, fn, options) {
    if (!docHandlers.has(type)) docHandlers.set(type, []);
    const capture = typeof options === "boolean" ? options : !!(options && options.capture);
    docHandlers.get(type).push({ fn, capture });
  },
  removeEventListener() {},
  createElement: t => mkEl(t),
  documentElement: { dataset: {}, style: {} },
  visibilityState: "visible",
  activeElement: null,
  body: bodyEl,
  hidden: false,
  contains(node) { return node === bodyEl || node === document.activeElement; }
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener(type, fn) { if (!winHandlers.has(type)) winHandlers.set(type, []); winHandlers.get(type).push(fn); },
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  innerWidth: 1200, innerHeight: 800,
  getComputedStyle: () => ({ fontSize: "32px" }),
  requestAnimationFrame: fn => { fn(); return 0; },
  cancelAnimationFrame() {},
  speechSynthesis: { cancel() {}, speak() {} },
  scrollTo() {}
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
const intervals = [];
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.clearInterval = () => {};
globalThis.confirm = () => true;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = globalThis.window.speechSynthesis;
globalThis.performance = { now: () => now };

/* ---------------- 让浮层/错误提示的初始 hidden 与真实 index.html 一致 ---------------- */
for (const sel of ["#appAlert", "#exPop", "#capPause", "#autoResume", "#planPendingNotice",
  "#extraNewRow", "#extraNewPaused", "#profFeedback", "#groupFooter", "#backlogNotice",
  "#wordSheet", "#helpSheet", "#bookSheet", "#printSheet", "#txtSplitSheet", "#importSheet"]) {
  ensureEl(sel).hidden = true;
}

/* ---------------- 四词书数据 + 真实 app.js ---------------- */
new Function(fs.readFileSync(path.join(HERE, "words-data.js"), "utf8"))();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;
for (const file of ["cet-words-data.js", "combined-words-data.js"]) {
  new Function(fs.readFileSync(path.join(HERE, file), "utf8"))();
}
const appSource = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try { new Function(appSource)(); }
catch (e) { console.error("app.js 执行失败:", e.stack || e.message); process.exit(1); }
const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab"); process.exit(1); }

/* ---------------- 断言适配层 ---------------- */
const S = () => T.getS();
const settings = () => S().settings;
const stateEl = sel => ensureEl(sel);
const stored = (key = KEY) => { const raw = store.get(key); return raw ? JSON.parse(raw) : null; };
const plan = () => T.getPlan() || {};
const lifecycle = () => T.getSettingsLifecycle();
const groupSig = () => ({ cur: T.cur, qi: T.qi, answered: T.answered, Q: T.Q.slice(), total: T.getGroupTotal() });
const eqGroup = (a, b) => a.cur === b.cur && a.qi === b.qi && a.answered === b.answered
  && a.total === b.total && eq(a.Q, b.Q);

/* ---------------- 22 适配层与辅助（只调用真实钩子/真实定时器） ---------------- */
const numConst = (name) => {
  const m = appSource.match(new RegExp("const " + name + "\\s*=\\s*(\\d+)"));
  if (!m) throw new Error("app.js 应声明 " + name);
  return Number(m[1]);
};
const AUTO_TICK_MS = numConst("AUTO_RESUME_TICK_MS");
const LEASE_TTL_MS = numConst("AUTO_RESUME_LEASE_TTL_MS");
const LEASE_KEY = (appSource.match(/const AUTO_RESUME_LEASE_KEY = "([^"]+)"/) || [])[1];
if (!LEASE_KEY) throw new Error("app.js 应声明 AUTO_RESUME_LEASE_KEY");
const DEFAULT_AR = {enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000};
const getBookId = () => T.getBook();
const autoState = () => T.getAutoResumeState();
const autoCandidates = () => T.getCandidatesNow();
const isStudyOn = () => document.querySelector("#v-study").classList.contains("on");
const fireDocument = (type, ev = {}) => {
  const event = Object.assign({ type, target: document.body, preventDefault() {}, stopPropagation() {} }, ev);
  const list = docHandlers.get(type) || [];
  for (const rec of list) if (rec.capture) rec.fn(event);
  for (const rec of list) if (!rec.capture) rec.fn(event);
  return event;
};
const autoTimer = () => {
  // 学习时长采样也是 1000ms；自动续背定时器注册在它之后，取最后一个同周期定时器。
  const t = [...intervals].reverse().find(i => i.ms === AUTO_TICK_MS);
  if (!t) throw new Error(`应注册 ${AUTO_TICK_MS}ms 自动续背采样定时器`);
  return t.fn;
};
function autoTick(advanceMs = 0) {
  if (advanceMs) advance(advanceMs);
  autoTimer()();
}
/** 通用夹具：清空当前书记录并写入范围/计划；可选预置到期词；随后开主组。 */
function setup(o = {}) {
  if (T.drillMode) T.exitDrill();
  if (T.isNewOnlySubgroup()) T.endNewOnlySubgroup();
  if (T.isExtraSubgroup()) T.endExtraSubgroup();
  T.switchBook(o.book || "kaoyan");
  T.resetProficient();
  const s = S();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {
    dailyNew: o.dailyNew === undefined ? 20 : o.dailyNew,
    order: o.order || "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: "primary", singleCharKeys: true,
    dailyReviewCap: o.cap === undefined ? 0 : o.cap,
    groupSize: o.groupSize === undefined ? 10 : o.groupSize,
    backlogGuard: o.backlogGuard === undefined ? true : o.backlogGuard
  });
  if (o.autoResume !== undefined) s.settings.autoResume = Object.assign({}, DEFAULT_AR, o.autoResume);
  const dayN = o.dayN === undefined ? 0 : o.dayN;
  s.days[todayStr()] = { n: dayN, r: dayN, ok: dayN, no: 0 };
  s.reviewDay = { d: todayStr(), used: o.used || 0 };
  s.extraDay = { d: todayStr(), extra: o.extra || 0 };
  if (o.due) markDue(o.due);
  saveNow();
  T.startSession("main");
  return s;
}
/** 通过真实设置写入口落盘（不伪造 session）。 */
function saveNow() {
  T.setReviewCap(settings().dailyReviewCap);
}
function scopeIndices() {
  const W = T.getW(), out = [];
  for (let i = 0; i < W.length; i++) if (T.inScope(i)) out.push(i);
  return out;
}
function markDue(count) {
  const s = S();
  const picked = scopeIndices().slice(0, count);
  for (const i of picked) s.progress[i] = [1, now - 5000, 1, 0, now - 86400000];
  return picked;
}
function completeGroup() {
  let guard = 0;
  while (T.cur != null && guard++ < 100) { T.judge(true); T.tryNext(); }
  return guard;
}
/** 造一个「主组真正完成、范围仍有剩余新词额度」的完成页。 */
function completionPage(o = {}) {
  setup(Object.assign({dailyNew: 20, groupSize: 10}, o));
  completeGroup();
  if (T.cur !== null) throw new Error("夹具未完成本组");
  return T.getS();
}
function setBareAuto(ar) {
  T.getS().settings.autoResume = Object.assign({}, DEFAULT_AR, ar);
}
function leaseWrite(payload) { store.set(LEASE_KEY, JSON.stringify(payload)); }
function readLease() { const raw = store.get(LEASE_KEY); return raw ? JSON.parse(raw) : null; }
const REASON = () => autoState().reason || "";

/* ================= 0. 钩子/默认/设置 ================= */
console.log("== 0. 契约钩子与默认设置 ==");
{
  for (const name of ["getAutoResume", "getCandidatesNow", "getAutoResumeState", "setAutoResume",
    "applyAutoResumePreset", "startAutoResumeNow", "returnToPreviousResults"]) {
    ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  }
  const ar = T.getAutoResume();
  ck(ar.enabled === true && ar.threshold === 5 && ar.idleMs === 120000 && ar.countdownMs === 15000,
    "全新用户自动续背默认 5 张 / 2 分钟 / 15 秒", JSON.stringify(ar));
  const required = ["enabled", "threshold", "idleMs", "countdownMs", "phase", "pausedToday",
    "eligible", "completedPage", "candidates", "storageError", "returnAvailable"];
  const st = autoState();
  ck(required.every(k => k in st), "getAutoResumeState() 含阶段/原因/候选明细等字段", JSON.stringify(st));
  ck(st.completedPage === false && st.eligible === false, "新开组时不是完成页，自动续背未激活");
  const invalid = T.setAutoResume({enabled: true, threshold: 0, idleMs: 1000, countdownMs: 1});
  ck(invalid.ok === false && typeof invalid.error === "string", "非法阈值/等待/倒计时整次拒绝", JSON.stringify(invalid));
  ck(T.getAutoResume().threshold === 5, "拒绝后保留原设置");
  const byPreset = T.applyAutoResumePreset("timely");
  ck(byPreset.ok === true && T.getAutoResume().threshold === 1 && T.getAutoResume().idleMs === 60000,
    "及时预设 = 1 张 / 1 分钟", JSON.stringify(T.getAutoResume()));
  T.applyAutoResumePreset("focused");
  ck(T.getAutoResume().threshold === 10 && T.getAutoResume().idleMs === 300000,
    "集中预设 = 10 张 / 5 分钟", JSON.stringify(T.getAutoResume()));
  T.applyAutoResumePreset("balanced");
  ck(T.getAutoResume().threshold === 5 && T.getAutoResume().idleMs === 120000, "均衡预设恢复 5 张 / 2 分钟");
  T.applyAutoResumePreset("off");
  ck(T.getAutoResume().enabled === false, "关闭预设生效");
  T.applyAutoResumePreset("balanced");
}

/* ================= 1. 候选口径 getCandidatesNow ================= */
console.log("== 1. getCandidatesNow 候选口径 ==");
{
  setup({ dailyNew: 10, groupSize: 8, dayN: 0 });
  const q0 = autoCandidates();
  ck(q0 === 8, "组大小 8、新词额度 10 → 候选 8", String(q0));
  setup({ dailyNew: 4, groupSize: 8, dayN: 4 });
  ck(autoCandidates() === 0, "今日新词额度已用完 → 候选 0", String(autoCandidates()));
  setup({ dailyNew: 10, groupSize: 4, dayN: 0 });
  ck(autoCandidates() === 4, "额度充足但组大小 4 截断 → 候选 4", String(autoCandidates()));
  // 到期词受剩余复习预算约束
  setup({ dailyNew: 1, groupSize: 10, dayN: 1, cap: 3, due: 5 });
  ck(T.countDue() === 5, "预置 5 张到期复习卡", String(T.countDue()));
  let st = autoState();
  ck(autoCandidates() === 3, "剩余复习预算 3 → 到期候选只算 3 张", String(autoCandidates()));
  ck(st.candidates.backlogGuarded === true, "到期量 > 剩余预算 → 积压保护生效", JSON.stringify(st.candidates));
  ck(st.candidates.freshActive === 0, "积压保护生效时不自动补新词", JSON.stringify(st.candidates));
  // cap=0 不限：到期+新词额度共同入组
  setup({ dailyNew: 4, groupSize: 10, dayN: 0, cap: 0, due: 5 });
  st = autoState();
  ck(st.candidates.due === 5 && st.candidates.freshActive > 0 && st.candidates.cap === 0,
    "cap=0 不限：到期 + 新词额度都算候选", JSON.stringify(st.candidates));
  ck(autoCandidates() === 5 + 4, "cap 不限时候选 = 到期 5 + 新词 4", String(autoCandidates()));
  // 熟练词排除
  setup({ dailyNew: 10, groupSize: 10, dayN: 0 });
  const beforeProf = autoCandidates();
  const first = T.Q[0];
  T.setProficient(first, true);
  T.startSession("main");
  ck(autoCandidates() <= beforeProf, "熟练词从候选口径排除", `${autoCandidates()} vs ${beforeProf}`);
}

/* ================= 2. 阈值前后 / 完成后未挂机 / 挂机但未完成 / 不空开组 ================= */
console.log("== 2. 触发条件：阈值前后与完成状态 ==");
{
  // 挂机但未完成：当前卡还在，任何空闲都不触发。
  setup({ dailyNew: 20, groupSize: 10 });
  T.judge(true);
  T.tryNext();
  ck(T.cur !== null, "当前仍在作答（未完成本组）");
  autoTick();
  autoTick(DEFAULT_AR.idleMs + 5000);
  const stBusy = autoState();
  ck(stBusy.completedPage === false && stBusy.eligible === false, "挂机但未完成 → 不满足完成页条件", JSON.stringify(stBusy));
  ck(T.cur !== null, "未完成时挂机不会自动开新组");

  // 完成页：先不满 idleMs（完成后未挂机）→ 不出现倒计时。
  completionPage({ dailyNew: 20, groupSize: 10 });
  ck(T.cur === null && autoState().completedPage === true, "完成页且无待巩固");
  autoTick();
  ck(autoState().phase !== "countdown", "完成后未到 idleMs：不出现倒计时", autoState().phase);
  autoTick(60000);
  ck(autoState().phase !== "countdown", "完成 60 秒（阈值 120 秒）：仍不出现倒计时", autoState().phase);
  autoTick(59000);
  ck(autoState().phase !== "countdown", "完成 119 秒：仍不出现倒计时", autoState().phase);
  autoTick(2000);
  const stCd = autoState();
  ck(stCd.phase === "countdown", "连续空闲达到 2 分钟：进入可取消倒计时", JSON.stringify(stCd));
  ck(stCd.countdownRemainingMs > 0 && stCd.countdownRemainingMs <= DEFAULT_AR.countdownMs,
    "倒计时按截止时间计算（默认 15 秒内）", String(stCd.countdownRemainingMs));
  ck(autoState().candidates.available === 10, "候选 10 张 ≥ 阈值 5 张", JSON.stringify(autoState().candidates));
  ck(T.cur === null, "倒计时期间尚未开组");
  const dayNBefore = S().days[todayStr()].n;
  autoTick(DEFAULT_AR.countdownMs - 1000);
  ck(T.cur === null, "倒计时未到点不开组");
  autoTick(1500);
  ck(T.cur !== null && T.Q.length === 10, "倒计时到点：应用内刷新后自动开始下一组", `cur=${T.cur} Q=${T.Q.length}`);
  ck(S().days[todayStr()].n === dayNBefore, "自动开组不消费新词额度、不判定", JSON.stringify(S().days[todayStr()]));
  ck(T.getReviewLedger().used === 0, "自动开组不消费复习额度");
  ck(T.getS().timeSec === 0, "自动开组不增加学习时长");
  const autoP = T.getPlan();
  ck(autoP.kind === "main", "自动开组为普通主组（kind=main）");
  ck(autoState().returnAvailable === true, "自动开组后首个判定前可返回上一组结果");
  ck(T.getAutoResume().threshold === 5, "自动开组不自动提高阈值/上限");

  // 返回上一组结果（含完成页撤销栈）
  ck(typeof stateEl("#returnPrevResult").onclick === "function", "新组提供「返回上一组结果」按钮");
  stateEl("#returnPrevResult").onclick();
  ck(T.cur === null && T.getGroupTotal() === 10, "返回上一组结果：回到上一组完成页，分母恢复", String(T.getGroupTotal()));
  ck(autoState().returnAvailable === false, "返回后返回入口关闭");
  const undoBtn = stateEl("#undoBtn");
  ck(typeof undoBtn.onclick === "function", "完成页撤销按钮可用");
  undoBtn.onclick();
  ck(T.cur !== null && T.phase === "revealed", "返回上一组后可继续撤销上一组判定");
  T.tryNext();

  // 判定后返回入口消失
  completionPage({ dailyNew: 20, groupSize: 10 });
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000); autoTick(DEFAULT_AR.countdownMs + 1000);
  ck(T.cur !== null, "再次自动开组");
  ck(T.getAutoResumeState().returnAvailable === true, "判定前可返回");
  T.judge(true);
  ck(T.getAutoResumeState().returnAvailable === false, "新组首个有效判定后不可返回上一组结果");
  ck(T.returnToPreviousResults() === false, "判定后调用返回入口被拒绝");

  // 阈值不足：候选 < threshold → 显示原因、不进入倒计时、不空开组。
  setup({ dailyNew: 9, groupSize: 5 });
  completeGroup();
  ck(autoCandidates() === 4, "完成 5 张后只剩 4 张新词额度 → 候选 4", String(autoCandidates()));
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  const stLow = autoState();
  ck(stLow.phase === "waiting" && stLow.reason.includes("4"), "候选 4 张未达阈值 → 显示原因", JSON.stringify(stLow));
  ck(T.cur === null, "候选不足时不空开组");
  autoTick(10 * 60000);
  ck(T.cur === null && autoState().phase !== "countdown", "候选持续不足不反复开组");
  setBareAuto({enabled: true, threshold: 4, idleMs: 120000, countdownMs: 15000});
  autoTick(1000);
  ck(autoState().phase === "countdown", "阈值降到 4 张后可进入倒计时", autoState().phase);
}

/* ================= 3. 待巩固 / 额度暂停 / 浮层等原因 ================= */
console.log("== 3. 待巩固、额度暂停与浮层 ==");
{
  // 待巩固：当前组有未完成重考时不是完成页。
  setup({ dailyNew: 20, groupSize: 3 });
  T.judge(false);
  T.tryNext();
  ck(T.pendingReinforce() >= 1, "答错产生待巩固", String(T.pendingReinforce()));
  autoTick(); autoTick(10 * 60000);
  ck(T.cur !== null && autoState().phase !== "countdown", "有待巩固/未答卡时不自动开组");

  // 额度暂停：完成页时今日复习预算已用完且仍有到期 → 候选 0，显示原因。
  setup({ dailyNew: 1, groupSize: 2, dayN: 1, cap: 2, due: 5 });
  completeGroup();
  ck(T.reviewCapLeft() === 0, "剩余复习预算 0", String(T.reviewCapLeft()));
  ck(T.countDue() === 3, "本组外仍有 3 张到期", String(T.countDue()));
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  const stCap = autoState();
  ck(autoCandidates() === 0, "额度用尽且仍有到期 → 候选 0", String(autoCandidates()));
  ck(stCap.phase === "waiting" && /额度/.test(stCap.reason), "显示「今日复习额度已用完」原因", JSON.stringify(stCap));

  // 浮层：单词详情打开期间不自动开组。
  completionPage({ dailyNew: 20, groupSize: 10 });
  T.openWord(0);
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(T.cur === null && autoState().phase !== "countdown", "详情浮层打开时不开始倒计时/开组");
  T.closeSheet();
  autoTick();
  ck(autoState().eligible === true, "关闭浮层后恢复可触发条件");

  // 特训/子组中不触发。
  setup({ dailyNew: 20, groupSize: 3 });
  T.judge(false); T.tryNext();
  T.startDrill();
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(T.drillMode === true && autoState().eligible === false, "特训中不参与自动续背");
  T.exitDrill();
  T.endActiveSubgroup();
}

/* ================= 4. 取消倒计时 / 有效交互 / 后台 / 休眠 ================= */
console.log("== 4. 取消倒计时、有效交互、后台与休眠 ==");
{
  completionPage({ dailyNew: 20, groupSize: 10 });
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "进入倒计时");
  fireDocument("click");
  ck(autoState().phase !== "countdown" && T.cur === null, "点击取消当前倒计时（不开组）");
  ck(autoState().idleSince !== null, "有效交互重置闲置起点");
  autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "重新空闲满 2 分钟再出现倒计时");

  fireDocument("pointermove", { pointerType: "mouse", clientX: 3, clientY: 4 });
  autoTick(500);
  ck(autoState().phase === "countdown", "鼠标移动不算有效交互，不取消倒计时");
  fireDocument("keydown", { key: "a" });
  ck(autoState().phase !== "countdown", "按键取消倒计时");
  autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "再次倒计时");
  fireDocument("pointerdown", { pointerType: "touch" });
  ck(autoState().phase !== "countdown", "触摸手势取消倒计时");
  autoTick(DEFAULT_AR.idleMs + 1000);
  fireDocument("scroll");
  ck(autoState().phase !== "countdown", "阅读滚动取消倒计时");

  // 后台：隐藏标签不启动，回前台重新计时（不承诺后台精准定时）。
  autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "前台再次进入倒计时");
  document.visibilityState = "hidden";
  fireDocument("visibilitychange");
  ck(autoState().phase !== "countdown" && autoState().idleSince === null, "切后台立即清空倒计时与闲置起点");
  autoTick(5 * 60000);
  ck(T.cur === null, "后台无论多久都不自动开组");
  document.visibilityState = "visible";
  fireDocument("visibilitychange");
  autoTick();
  ck(autoState().eligible === true && autoState().idleSince !== null, "回前台后重新开始计闲置");
  autoTick(DEFAULT_AR.idleMs - 5000);
  ck(autoState().phase !== "countdown", "回前台后不满 idleMs 不触发");
  autoTick(6000);
  ck(autoState().phase === "countdown", "回前台重新空满 idleMs 后进入倒计时");

  // 休眠：单次长跳变不补记，但仍按“最近一次有效交互”判定，不会用到其他会话的现场。
  autoTick(DEFAULT_AR.countdownMs + 1000);
  ck(T.cur !== null, "倒计时结束自动开组");
  const started = T.cur;
  autoTick(3 * 3600 * 1000);
  ck(T.cur === started && T.phase === "recall", "休眠长跳变不重建进行中的卡");

  // 今天暂停：本次不再反复倒计时
  completionPage({ dailyNew: 20, groupSize: 10 });
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "暂停前先进入倒计时");
  const pauseBtn = stateEl("#autoResumePause");
  ck(typeof pauseBtn.onclick === "function", "完成页提供「今天暂停自动续背」按钮");
  pauseBtn.onclick();
  ck(autoState().pausedToday === true && autoState().phase === "paused", "今天暂停后状态为 paused", JSON.stringify(autoState()));
  autoTick(30 * 60000);
  ck(T.cur === null, "今天暂停后不再自动倒计时/开组");
  T.refreshForResume();
  ck(autoState().pausedToday === true, "刷新/恢复后今天仍保持暂停");
  ck(T.startAutoResumeNow() === false, "今天暂停期间即使手动调用也不开组");
  T.applyAutoResumePreset("balanced");
  ck(autoState().pausedToday === false, "重新点开启推荐方案可解除今天暂停");

  // A 遗留修复：今天暂停改为跨刷新持久（独立键，不进 state/备份 v3）。
  T.pauseAutoResumeToday();
  const pauseKey = T.autoResumePauseKey;
  ck(pauseKey === "vocab_autoresume_pause_v1", "今天暂停使用独立 localStorage 键", String(pauseKey));
  const pauseRaw = store.get(pauseKey);
  ck(typeof pauseRaw === "string" && JSON.parse(pauseRaw)[getBookId()] === todayStr(),
    "暂停键写入 {bookId:YYYY-MM-DD}", String(pauseRaw));
  ck(!JSON.stringify(stored(KEY)).includes("autoresume_pause"), "暂停键不写入主记录/state");
  ck(!JSON.stringify(T.buildExport()).includes("autoresume_pause"), "暂停键不进备份 v3");
  const reloadResult = T.simulateReload();
  ck(reloadResult.mode === "started" || reloadResult.mode === "restored", "模拟刷新完成", JSON.stringify(reloadResult));
  ck(autoState().pausedToday === true, "同一天刷新/重开页面后「今天暂停」仍保持");
  ck(T.getAutoResumePause().pausedToday === true, "只读钩子 getAutoResumePause 同步暂停状态");
  // 立即开始不解除暂停（仅本次跳过）
  const beforeImmediate = store.get(pauseKey);
  T.startAutoResumeNow();
  ck(autoState().pausedToday === true && store.get(pauseKey) === beforeImmediate,
    "「立即开始」不解除今天暂停（暂停键保持）");
  // 四书独立：暂停只影响当前书
  T.switchBook("cet4");
  ck(autoState().pausedToday === false, "暂停按书独立：四级书不受考研暂停影响", JSON.stringify(T.getAutoResumePause()));
  T.switchBook("kaoyan");
  ck(autoState().pausedToday === true, "切回考研书暂停仍保持");
  // 设置页修改自动续背解除该书暂停
  T.setAutoResume({enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000});
  ck(autoState().pausedToday === false, "设置页修改自动续背解除该书今天暂停");
  const clearedRaw = store.get(pauseKey);
  const cleared = clearedRaw ? JSON.parse(clearedRaw) : {};
  ck(cleared[getBookId()] !== todayStr(), "解除后独立键中删除该书暂停记录", String(clearedRaw));
  // 恢复学习计划默认也会修改自动续背配置，须复用相同的暂停解除与计时重置语义。
  T.switchBook("cet4");
  T.pauseAutoResumeToday();
  T.switchBook("kaoyan");
  T.pauseAutoResumeToday();
  const groupBeforeReset = groupSig();
  const planBeforeReset = JSON.stringify(T.getPlan());
  T.resetSettingsClass("plan");
  ck(autoState().pausedToday === false && T.getAutoResume().enabled === true,
    "恢复学习计划默认会解除当前书今天暂停，并开启推荐方案");
  ck(autoState().phase === "idle" && autoState().countdownDeadline === 0,
    "恢复默认后自动续背重新等待，不沿用旧倒计时");
  ck(eqGroup(groupSig(), groupBeforeReset) && JSON.stringify(T.getPlan()) === planBeforeReset,
    "恢复学习计划默认不重建当前组或改写冻结计划");
  const pauseAfterReset = JSON.parse(store.get(pauseKey) || "{}");
  ck(pauseAfterReset.cet4 === todayStr() && pauseAfterReset.kaoyan !== todayStr(),
    "恢复计划默认只解除当前书暂停，其他词书暂停保留", JSON.stringify(pauseAfterReset));
  // 跨天失效 + 过期记录清理
  T.pauseAutoResumeToday();
  ck(autoState().pausedToday === true, "再次暂停");
  advance(24 * 60 * 60 * 1000);
  T.refreshForResume();
  ck(autoState().pausedToday === false, "跨天后「今天暂停」自动失效");
  const prunedRaw = store.get(pauseKey);
  ck(!prunedRaw || JSON.parse(prunedRaw)[getBookId()] !== todayStr(), "跨天刷新清理过期暂停记录", String(prunedRaw));
}

/* ================= 5. 跨天 / 切书 / 四书独立 ================= */
console.log("== 5. 跨天与四书独立 ==");
{
  // 完成后无候选；跨天后新额度出现，需重新等满 idleMs 再触发。
  setup({ dailyNew: 10, groupSize: 5 });
  completeGroup();
  // 用掉全部新词额度：再开两组把 plan 内新词学完。
  let guard = 0;
  while (guard++ < 5) {
    T.startSession("main");
    if (T.cur === null) break;
    completeGroup();
    if (S().days[todayStr()].n >= 10) break;
  }
  ck(autoCandidates() === 0, "今日新词额度全部用完后候选 0", JSON.stringify(autoState().candidates));
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase !== "countdown" && T.cur === null, "无候选不空开组");
  advance(24 * 60 * 60 * 1000);
  autoTick();  // 触发跨天 refreshForResume
  ck(S().days[todayStr()] === undefined || S().days[todayStr()].n === 0, "跨天后今日新词额度归零");
  ck(autoCandidates() === 5, "跨天后候选按新一天额度重算", String(autoCandidates()));
  ck(autoState().phase !== "countdown", "跨天后重新开始闲置等待");
  autoTick();                              // 跨天后第一拍重新建立闲置起点
  autoTick(DEFAULT_AR.idleMs + 1000);      // 再空满 idleMs
  ck(autoState().phase === "countdown", "跨天后空满 idleMs 进入倒计时");
  autoTick(DEFAULT_AR.countdownMs + 1000);
  ck(T.cur !== null, "跨天后自动开组");
  ck(S().days[todayStr()].n === 0, "跨天自动开组不消费新额度（尚未判定）");

  // 切书：本书暂停不影响其他书；各书自动续背设置独立。
  T.setAutoResume({enabled: true, threshold: 7, idleMs: 180000, countdownMs: 10000});
  ck(T.getAutoResume().threshold === 7, "考研书自定义自动续背 7 张/3 分钟");
  T.switchBook("cet4");
  ck(T.getAutoResume().threshold === 5 && T.getAutoResume().idleMs === 120000,
    "四级书保持自己的默认自动续背设置（四书独立）", JSON.stringify(T.getAutoResume()));
  T.switchBook("kaoyan");
  ck(T.getAutoResume().threshold === 7, "切回考研保留自定义自动续背设置");
  T.setAutoResume({enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000});
}

/* ================= 6. 多标签租约：只允许一组启动 ================= */
console.log("== 6. 多标签短租约 ==");
{
  completionPage({ dailyNew: 20, groupSize: 10 });
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "本页进入倒计时");
  leaseWrite({ts: now, tab: "other-tab", book: getBookId(), day: todayStr()});
  autoTick(DEFAULT_AR.countdownMs + 1000);
  ck(T.cur === null, "另一标签持有未过期租约 → 本页不启动");
  ck(/另一标签/.test(REASON()) || autoState().phase === "waiting", "提示另一标签已开始下一组", REASON());
  leaseWrite({ts: now - LEASE_TTL_MS - 1000, tab: "other-tab", book: getBookId(), day: todayStr()});
  autoTick();                              // 租约过期：重新进入倒计时
  autoTick(DEFAULT_AR.countdownMs + 1000); // 倒计时到点再抢租约启动
  ck(T.cur !== null, "租约过期后允许本页启动");
  const mine = readLease();
  ck(mine && mine.tab !== "other-tab" && mine.book === getBookId() && mine.day === todayStr(),
    "启动后写回本标签租约（含书/日期）", JSON.stringify(mine));
  ck(LEASE_KEY === "vocab_autoresume_lease_v1", "租约为独立 localStorage 短键，不进备份 v3", LEASE_KEY);
}

/* ================= 7. 其他视图 / 保存失败 ================= */
console.log("== 7. 用户在其他视图与保存失败 ==");
{
  completionPage({ dailyNew: 20, groupSize: 10 });
  T.show("stats");
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(T.cur === null && autoState().eligible === false, "用户在其他视图时不自动开组");
  ck(document.querySelector("#v-stats").classList.contains("on"), "自动续背不会把视图切回背诵页");
  T.show("study");
  autoTick();
  ck(autoState().eligible === true, "回到背诵完成页后重新满足条件");
  autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "回到完成页重新等待后可倒计时");

  // 保存失败：持续错误提示期间不自动开组，恢复保存后恢复。
  failKeys.add(KEY);
  T.setAutoResume({enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000});   // 触发一次保存失败
  ck(T.getStorageOK() === false, "模拟写入失败：storageOK=false", String(T.getStorageOK()));
  ck(stateEl("#appAlert").hidden === false, "保存失败出现持续错误提示");
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(T.cur === null && autoState().phase !== "countdown", "保存失败期间不自动开组");
  failKeys.delete(KEY);
  T.setGroupSize(10);   // 成功保存 → 清除保存失败提示
  ck(stateEl("#appAlert").hidden === true, "保存恢复后错误提示消失");
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown" || T.cur !== null, "存储恢复后自动续背可继续工作");
}

/* ================= 8. 便捷预设/唯一手动入口/不可达配置 ================= */
console.log("== 8. 便捷续背与手动门槛分离 ==");
{
  completionPage({dailyNew: 2, groupSize: 1, autoResume: {enabled: false}});
  autoTick();
  ck(stateEl("#autoResume").hidden === false && /未开启/.test(stateEl("#autoResumeText").innerHTML),
    "自动关闭的老用户完成页仍可发现启用入口");
  ck(typeof stateEl("#autoResumeQuick").onclick === "function", "完成页便捷入口已接线");
  stateEl("#autoResumeQuick").onclick();
  ck(eq(T.getAutoResume(), {enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000}),
    "便捷预设是1张/30秒/3秒，不改变新用户默认");
  autoTick(); autoTick(30000);
  ck(autoState().phase === "countdown", "仅1张剩余候选可触发便捷倒计时");
  autoTick(3000);
  ck(T.cur !== null && T.getGroupTotal() === 1 && T.answered === 0, "便捷到点只开一张新组，不自动判定");
}
{
  completionPage({dailyNew: 3, groupSize: 1, autoResume: DEFAULT_AR});
  autoTick(); autoTick(121000);
  ck(/每组 1 张.*阈值 5 张.*无法达到/.test(stateEl("#autoResumeText").innerHTML),
    "组长小于阈值明确解释不可达，不静默等待");
  ck(settings().autoResume.threshold === 5, "不可达配置不静默钳制已存阈值");
  ck(!stateEl("#autoResumeQuick").hidden, "冲突配置提供显式便捷修正入口");
  T.pauseAutoResumeToday();
  const pauseRaw = store.get(T.autoResumePauseKey);
  ck(T.continueMainSession() === true && T.cur !== null, "手动继续不受自动阈值或今日暂停约束");
  ck(store.get(T.autoResumePauseKey) === pauseRaw, "手动继续不解除今日暂停");
}
{
  completionPage({dailyNew: 1, groupSize: 1, autoResume: {enabled: false}});
  const frozen = clone(T.getPlan());
  ck(T.continueMainSession() === false && T.cur === null, "无可用候选不空开组");
  ck(eq(T.getPlan(), frozen), "无候选手动复核不替换完成页计划");
}
{
  setup({dailyNew: 1, groupSize: 1, dayN: 1, due: 2, cap: 3, autoResume: {enabled: false}});
  completeGroup();
  const latest = JSON.parse(store.get(KEY)); latest.reviewDay.used = 3;
  store.set(KEY, JSON.stringify(latest));
  const before = JSON.stringify(T.getS());
  ck(T.getCandidatesNow() === 0, "延迟storage事件时读取最新预算，不给手动入口虚假候选");
  ck(JSON.stringify(T.getS()) === before, "候选读取最新预算仍保持只读");
  ck(T.continueMainSession() === false && T.cur === null, "真实预算耗尽时不能借手动继续绕过");
}
{
  for (const mode of ["manual", "auto"]) {
    completionPage({dailyNew: 20, groupSize: 1, cap: 100, autoResume: {enabled: mode === "auto"}});
    T.setAutoResume(T.getAutoResume()); // 用正式入口解除前面暂停场景留下的本书今日暂停
    markDue(10);
    settings().groupSize = 30;
    saveNow();
    const latest = JSON.parse(store.get(KEY)); latest.reviewDay.used = 95;
    store.set(KEY, JSON.stringify(latest)); // storage事件延迟，部分预算仍剩5次
    const unchanged = JSON.stringify(T.getS());
    const candidates = autoState().candidates;
    ck(candidates.available === 5 && candidates.backlogGuarded && candidates.freshActive === 0,
      mode + "候选按远端部分预算重算积压保护", JSON.stringify(candidates));
    ck(JSON.stringify(T.getS()) === unchanged, mode + "部分预算候选复核保持只读");
    const dayBefore = clone(S().days);
    const started = mode === "manual" ? T.continueMainSession() : T.startAutoResumeNow();
    ck(started && T.Q.every(i => T.hasMainProgress(S().progress[i])) && S().reviewDay.used === 95,
      mode + "开组前对齐预算且积压时不补新词");
    ck(eq(S().days, dayBefore) && T.answered === 0, mode + "开组不新增判定或消耗额度");
  }
}
/* ================= 8b. 空页显式等待：不伪造完成组 ================= */
console.log("== 8b. 本页等待到期 ==");
ck(typeof T.startEmptyWait === "function" && typeof T.stopEmptyWait === "function", "空页等待提供正式进入/退出入口");
if (typeof T.startEmptyWait === "function") {
  const quick = {enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000};
  const emptyPage = (o = {}) => {
    setup({dailyNew: 1, dayN: 1, cap: o.cap || 100, used: o.used || 0, autoResume: o.autoResume || quick});
    const i = scopeIndices()[0];
    S().progress[i] = [1, now + (o.futureMs || 60000), 1, 0, now - 86400000];
    saveNow(); T.startSession("main");
    T.setAutoResume(T.getAutoResume());
    return i;
  };
  {
    emptyPage(); autoTick(120000);
    ck(T.cur === null && !autoState().eligible && !autoState().waitingForDue, "普通空页未选择时到期也不自动开始");
    ck(!stateEl("#startEmptyWait").hidden, "普通空页有显式等待入口");
    const before = JSON.stringify(T.buildExport()), raw = store.get(KEY), dayBefore = clone(S().days);
    ck(T.startEmptyWait() && autoState().waitingForDue && autoState().eligible, "显式选择后获得本页等待资格");
    ck(T.getGroupTotal() === 0 && T.answered === 0 && !autoState().completedPage, "等待不伪造完成张数或主组完成");
    ck(JSON.stringify(T.buildExport()) === before && store.get(KEY) === raw, "进入等待不写主记录/备份或学习统计");
    autoTick(30000);
    ck(autoState().phase === "countdown", "空等待复用30秒闲置倒计时");
    fireDocument("click");
    ck(autoState().phase !== "countdown" && autoState().waitingForDue, "有效操作取消倒计时但不退出等待");
    autoTick(30000); autoTick(3000);
    ck(T.cur !== null && T.answered === 0 && eq(S().days, dayBefore), "空等待自动开组不判定/记账");
    ck(autoState().returnKind === "waiting" && /返回等待页/.test(stateEl("#acts").innerHTML), "来自空页的返回入口准确叫返回等待页");
    ck(T.returnToPreviousResults() && T.cur === null && autoState().waitingForDue && T.getGroupTotal() === 0,
      "返回等待页恢复0张现场与临时资格");
    T.stopEmptyWait();
    ck(!autoState().waitingForDue && !autoState().eligible, "退出等待立即解除资格");
  }
  {
    emptyPage({autoResume: {enabled: false}});
    ck(!T.startEmptyWait() && !autoState().waitingForDue, "自动关闭时不能借等待绕过开关");
    T.applyAutoResumePreset("quick");
    ck(T.startEmptyWait(), "明确启用便捷预设后才可进入等待");
    T.simulateReload();
    ck(T.cur === null && !autoState().waitingForDue && !autoState().eligible, "模拟真实刷新清除空等待资格");
    T.startEmptyWait(); T.show("stats"); T.show("study");
    ck(!autoState().waitingForDue, "离开主视图解除本页等待");
    T.startEmptyWait(); T.switchBook("cet4"); T.switchBook("kaoyan");
    ck(!autoState().waitingForDue, "切书再返回不会恢复旧书等待资格");
  }
  {
    emptyPage(); T.pauseAutoResumeToday(); const pauseRaw = store.get(T.autoResumePauseKey);
    ck(!T.startEmptyWait() && store.get(T.autoResumePauseKey) === pauseRaw, "等待入口不解除今日暂停");
    T.applyAutoResumePreset("quick"); T.startEmptyWait();
    T.pauseAutoResumeToday(); autoTick(120000);
    ck(T.cur === null && autoState().pausedToday && autoState().waitingForDue, "等待中今天暂停阻止启动且保留可退出状态");
    T.stopEmptyWait();
  }
  {
    emptyPage({futureMs: 600000}); T.startEmptyWait(); T.openGuide(); autoTick(120000);
    ck(autoState().waitingForDue && !autoState().eligible && T.cur === null, "浮层内不启动空等待");
    T.closeSheet();
    document.visibilityState = "hidden"; fireDocument("visibilitychange"); autoTick(600000);
    ck(T.cur === null && autoState().waitingForDue, "后台不启动且不消耗本页等待资格");
    document.visibilityState = "visible"; fireDocument("visibilitychange"); autoTick();
    ck(autoState().phase !== "countdown", "后台回来重新等待，不能补跑闲置");
    autoTick(30000); ck(autoState().phase === "countdown", "回前台满等待后可倒计时");
    T.stopEmptyWait();
  }
  {
    emptyPage({futureMs: 2 * 86400000}); T.startEmptyWait(); advance(86400000); T.refreshForResume(); autoTick();
    ck(autoState().waitingForDue && autoState().phase !== "countdown", "跨天保留显式本页意图但重计闲置/额度");
    T.stopEmptyWait();
  }
  {
    emptyPage({futureMs: 10000, cap: 3}); T.startEmptyWait(); autoTick(30000);
    const latest = JSON.parse(store.get(KEY)); latest.reviewDay.used = 3; store.set(KEY, JSON.stringify(latest));
    autoTick(3000);
    ck(T.cur === null && autoState().candidates.available === 0 && autoState().waitingForDue,
      "倒计时末刻另一标签用完预算不空开组");
    T.stopEmptyWait();
  }
  {
    const i = emptyPage({futureMs: 10000}); T.startEmptyWait(); autoTick(30000);
    store.set("kaoyan_vocab_proficient_v1", JSON.stringify({[T.getW()[i].w]: now}));
    autoTick(3000);
    ck(T.cur === null && T.getCandidatesNow() === 0 && autoState().waitingForDue,
      "倒计时末刻远端标熟练不把已排除词开入新组");
    T.stopEmptyWait();
  }
  {
    emptyPage(); failKeys.add(KEY); T.setGroupSize(2);
    ck(!T.startEmptyWait() && !autoState().waitingForDue, "持续存储错误期间不能进入等待");
    failKeys.delete(KEY); T.setGroupSize(1);
    setup({dailyNew: 2, groupSize: 1, autoResume: quick}); const before = groupSig();
    ck(!T.startEmptyWait() && eqGroup(groupSig(), before), "未完成卡不能进入等待或被重建");
  }
  {
    emptyPage({futureMs: 10000}); T.startEmptyWait(); autoTick(30000);
    store.set(T.autoResumePauseKey, JSON.stringify({kaoyan: todayStr()}));
    for (const fn of winHandlers.get("storage") || []) fn({key: T.autoResumePauseKey});
    ck(autoState().pausedToday && autoState().phase !== "countdown", "另一标签今天暂停立即同步并取消等待倒计时");
    autoTick(3000); ck(T.cur === null, "远端暂停后不能仍按旧缓存启动"); T.stopEmptyWait();
    emptyPage({futureMs: 10000}); T.startEmptyWait(); autoTick(30000);
    store.set(T.autoResumePauseKey, JSON.stringify({kaoyan: todayStr()})); // 故意不派发storage事件
    autoTick(3000); ck(T.cur === null && autoState().pausedToday, "启动前重读暂停键覆盖延迟storage事件"); T.stopEmptyWait();
    emptyPage();
    store.set(T.autoResumePauseKey, JSON.stringify({cet4: todayStr()}));
    T.pauseAutoResumeToday();
    ck(stored(T.autoResumePauseKey).cet4 === todayStr() && stored(T.autoResumePauseKey).kaoyan === todayStr(),
      "本书暂停写前合并最新map，不抹掉远端其他书暂停");
    T.applyAutoResumePreset("quick");
    ck(stored(T.autoResumePauseKey).cet4 === todayStr() && !stored(T.autoResumePauseKey).kaoyan,
      "本书解除暂停只删本书，保留其他书");
    emptyPage({futureMs: 10000}); T.startEmptyWait(); autoTick(30000);
    failKeys.add(T.autoResumePauseKey); T.pauseAutoResumeToday();
    ck(autoState().pausedToday && !T.startAutoResumeNow() && autoState().pausedToday,
      "暂停写失败退化本页内存，启动前强制读不能抹掉该暂停");
    store.set(T.autoResumePauseKey, JSON.stringify({cet6: todayStr()}));
    for (const fn of winHandlers.get("storage") || []) fn({key: T.autoResumePauseKey});
    ck(autoState().pausedToday, "远端暂停map更新仍保留本页未落盘暂停");
    failKeys.delete(T.autoResumePauseKey); T.applyAutoResumePreset("quick");
    ck(!autoState().pausedToday && stored(T.autoResumePauseKey).cet6 === todayStr(),
      "用户明确解除本页暂停后落盘并保留远端词书暂停");
    T.stopEmptyWait();
  }
  {
    for (const kind of ["replace", "content"]) {
      emptyPage(); const external = clone(stored());
      if (kind === "replace") { external._replace = "remote-empty-reset"; external.progress = {}; external.days = {}; }
      else { const i = scopeIndices()[1]; external.progress[i] = [1, now - 1000, 1, 0, now - 86400000]; }
      store.set(KEY, JSON.stringify(external)); // 存储变化尚未通知，普通设置save必须同样保持空页
      T.applyAutoResumePreset("quick");
      ck(T.cur === null && T.getGroupTotal() === 0 && !autoState().waitingForDue && !autoState().eligible,
        kind + "延迟冲突保存只同步空页，不绕过显式选择启动");
    }
  }
  {
    emptyPage(); T.startEmptyWait();
    const external = clone(stored()); external._replace = "remote-explicit-wait-reset";
    external.progress = {}; external.days = {}; store.set(KEY, JSON.stringify(external));
    for (const fn of winHandlers.get("storage") || []) fn({key: KEY});
    ck(T.cur === null && !autoState().waitingForDue && !autoState().eligible,
      "远端重置换代解除旧等待，不从storage直接开组");
  }
  {
    emptyPage({futureMs: 10000}); T.startEmptyWait(); autoTick(30000);
    const idle = autoState().idleSince;
    fireDocument("scroll", {isTrusted: true});
    ck(autoState().phase === "countdown" && autoState().idleSince === idle,
      "没有新输入的布局锚点scroll不取消倒计时");
    fireDocument("wheel", {isTrusted: true}); fireDocument("scroll", {isTrusted: true});
    ck(autoState().phase !== "countdown" && autoState().waitingForDue,
      "真实滚轮输入及其scroll立即取消倒计时并保持等待");
    autoTick(30000); fireDocument("pointermove", {buttons: 0, isTrusted: true});
    ck(autoState().phase === "countdown", "未按压鼠标移动仍不算活动");
    fireDocument("pointermove", {buttons: 1, isTrusted: true});
    ck(autoState().phase !== "countdown", "按压拖动属于有效交互");
    T.stopEmptyWait();
  }
  {
    emptyPage({futureMs: 600000}); T.applyComboFilters("core"); saveNow();
    const currentCount = T.inScopeCount(); T.startEmptyWait();
    ck(!T.hasPendingScopeSettings() && String(stateEl("#scopeLabel").textContent).includes(currentCount.toLocaleString())
      && String(stateEl("#studyScope").textContent).includes(currentCount.toLocaleString()),
      "空等待显示当前保存范围，不沿用0张空组的旧冻结摘要");
    T.stopEmptyWait();
  }
}
/* ================= M01. 恢复今日暂停保留原方案 ================= */
console.log("== M01. 恢复今日暂停保留原方案 ==");
{
  const custom = {enabled: true, threshold: 1, idleMs: 90000, countdownMs: 7000};
  const pauseKey = T.autoResumePauseKey;
  const restore = () => T.restoreAutoResumeToday();
  ck(typeof T.restoreAutoResumeToday === "function", "恢复原方案有独立正式入口");
  completionPage({dailyNew: 2, groupSize: 1, autoResume: custom});
  store.delete(LEASE_KEY);
  ck(stateEl("#autoResumeRestore").hidden, "未暂停时隐藏恢复入口");
  autoTick(); autoTick(custom.idleMs);
  ck(autoState().phase === "countdown", "恢复场景先进入原方案倒计时");
  T.pauseAutoResumeToday();
  store.set(pauseKey, JSON.stringify({...stored(pauseKey), cet4: todayStr()}));
  const before = JSON.stringify(S()), raw = store.get(KEY), beforePlan = JSON.stringify(plan());
  const beforeGroup = groupSig(), leaseBefore = store.get(LEASE_KEY);
  ck(!stateEl("#autoResumeRestore").hidden && typeof stateEl("#autoResumeRestore").onclick === "function",
    "暂停后显示恢复原方案按钮");
  ck(stateEl("#autoResumeQuick").textContent === "改用便捷续背", "更换预设入口与恢复原方案明确分开");
  ck(stateEl("#autoResumeRestore").onclick() === true && !autoState().pausedToday, "按钮恢复本书今日自动续背");
  ck(eq(T.getAutoResume(), custom) && JSON.stringify(S()) === before && store.get(KEY) === raw,
    "恢复不改自定义参数、主记录、进度或额度");
  ck(JSON.stringify(plan()) === beforePlan && eqGroup(groupSig(), beforeGroup) && store.get(LEASE_KEY) === leaseBefore,
    "恢复不重开组、不改冻结现场、不抢租约");
  ck(stored(pauseKey).cet4 === todayStr() && !stored(pauseKey).kaoyan, "恢复写前合并远端map，仅清本书暂停");
  ck(stateEl("#autoResumeRestore").hidden && !stateEl("#autoResumePause").hidden,
    "恢复后回到可暂停状态，不保留无效恢复入口");
  ck(autoState().phase === "idle" && autoState().countdownDeadline === 0 && T.cur === null,
    "恢复重置旧倒计时，不直接开组");
  ck(!restore(), "已经恢复且无待落盘删除时重复调用无副作用");
  autoTick(); autoTick(custom.idleMs - 1);
  ck(autoState().phase !== "countdown" && T.cur === null, "恢复后必须完整等待原90秒");
  autoTick(1);
  ck(autoState().phase === "countdown" && autoState().countdownDeadline === now + custom.countdownMs,
    "重新等待完成后沿用原7秒倒计时");
  T.undo();
  ck(T.cur !== null && T.phase === "revealed" && T.answered === 1,
    "恢复原方案后可先撤销翻页回已揭示卡");
  T.undo();
  ck(T.cur !== null && T.answered === 0 && S().days[todayStr()].n === 0,
    "恢复原方案后上一组判定仍可撤销，未清撤销栈");
  // 成功落盘后刷新保持解除；后来的远端同书暂停仍然生效。
  T.simulateReload();
  ck(!autoState().pausedToday && eq(T.getAutoResume(), custom) && stored(pauseKey).cet4 === todayStr(),
    "成功恢复后刷新仍解除本书暂停，原方案和其他书暂停保持");
  store.set(pauseKey, JSON.stringify({kaoyan: todayStr(), cet4: todayStr()}));
  for (const fn of winHandlers.get("storage") || []) fn({key: pauseKey});
  ck(autoState().pausedToday, "成功恢复后远端同书再次暂停仍被采纳");
  restore();

  // 失败删除覆盖层必须挡住旧存储；读失败时也不能用未知旧map覆盖远端其他书。
  completionPage({dailyNew: 2, groupSize: 1, autoResume: custom});
  T.pauseAutoResumeToday(); const persistedPause = store.get(pauseKey);
  failKeys.add(pauseKey);
  ck(restore() && !autoState().pausedToday && store.get(pauseKey) === persistedPause,
    "恢复写失败仅解除本页，持久暂停原文保留");
  ck(/本页恢复|刷新后可能仍暂停/.test(stateEl("#toast").textContent), "恢复写失败明确说明仅本页有效");
  store.set(pauseKey, JSON.stringify({kaoyan: todayStr(), cet6: todayStr()}));
  for (const fn of winHandlers.get("storage") || []) fn({key: pauseKey});
  ck(!autoState().pausedToday, "远端map事件和强制重读不会复活本页失败删除的暂停");
  failKeys.delete(pauseKey);
  ck(restore() && !stored(pauseKey).kaoyan && stored(pauseKey).cet6 === todayStr(),
    "再次明确恢复可重试删除落盘，并保留最新其他书暂停");
  T.pauseAutoResumeToday(); failReadKeys.add(pauseKey);
  const unreadRaw = JSON.stringify({kaoyan: todayStr(), combined: todayStr()}); store.set(pauseKey, unreadRaw);
  ck(restore() && !autoState().pausedToday && store.get(pauseKey) === unreadRaw,
    "读最新map失败只作本页恢复，不覆盖未知的其他书暂停");
  failReadKeys.delete(pauseKey);
  ck(restore() && !stored(pauseKey).kaoyan && stored(pauseKey).combined === todayStr(),
    "读取恢复后可重试落盘，保留之前不可读的其他书暂停");
  T.pauseAutoResumeToday(); failKeys.add(pauseKey); restore(); failKeys.delete(pauseKey);
  T.simulateReload();
  ck(autoState().pausedToday && eq(T.getAutoResume(), custom), "失败恢复后真实刷新语义重新采用持久暂停，方案不变");
  restore();

  // 普通空页和用户已明确进入的本页等待应当区别处理。
  setup({dailyNew: 1, dayN: 1, groupSize: 1, autoResume: custom});
  T.pauseAutoResumeToday(); restore();
  ck(T.cur === null && !autoState().waitingForDue && !autoState().eligible,
    "普通空页恢复不授予隐含等待资格");
  ck(T.startEmptyWait(), "恢复后用户仍可明确进入本页等待");
  T.pauseAutoResumeToday(); restore();
  ck(autoState().waitingForDue && T.cur === null && eq(T.getAutoResume(), custom),
    "已明确等待的页面恢复后保留资格和原方案，不直接开组");
  T.stopEmptyWait();
  T.setAutoResume({enabled: false}); T.pauseAutoResumeToday();
  const disabledPause = store.get(pauseKey);
  ck(!restore() && !T.getAutoResume().enabled && store.get(pauseKey) === disabledPause,
    "关闭配置时恢复操作不暗中开启或解除暂停");
}
// 本文件共用一个真实 app 实例。恢复本节改变的设置/今日暂停后，再测试本页持续熔断；
// 租约写失败会保留 autoResumeStorageError，不能让它污染前面的正常自动续背场景。
T.setAutoResume(DEFAULT_AR);

/* ================= 9. 存储不可用：放弃并提示，不循环空开组 ================= */
console.log("== 9. 租约存储不可用 ==");
{
  completionPage({ dailyNew: 20, groupSize: 10 });
  autoTick(); autoTick(DEFAULT_AR.idleMs + 1000);
  ck(autoState().phase === "countdown", "先进入倒计时");
  failKeys.add(LEASE_KEY);
  autoTick(DEFAULT_AR.countdownMs + 1000);
  const st = autoState();
  ck(T.cur === null, "租约写入失败时放弃自动开组");
  ck(st.storageError === true, "记录存储不可用状态", JSON.stringify(st));
  ck(/存储|手动/.test(st.reason), "提示手动继续，不假装已开始", st.reason);
  autoTick(10 * 60000);
  ck(T.cur === null, "存储不可用后不循环空开组");
  ck(T.startAutoResumeNow() === false, "存储不可用时手动重试也拒绝（避免半套启动）");
  failKeys.delete(LEASE_KEY);
  T.pauseAutoResumeToday(); T.restoreAutoResumeToday(); autoTick(600000);
  ck(autoState().storageError === true && T.cur === null,
    "恢复今日暂停不清租约存储错误熔断，不绕过安全守卫自动开组");
  T.startSession("main");
  ck(T.cur !== null, "用户仍可手动点继续开始下一组");
}

/* ================= 10. 调试钩子只读性 ================= */
console.log("== 10. 只读调试钩子 ==");
{
  const before = JSON.stringify(T.getS());
  autoState();
  autoCandidates();
  T.getAutoResume();
  ck(JSON.stringify(T.getS()) === before, "只读钩子不修改学习状态");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
