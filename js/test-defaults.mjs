/**
 * 21 统一默认值与按类恢复默认（回归）
 * 执行真实 js/app.js（DOM 桩 + 受控时钟 + 预置旧记录），不复制业务逻辑。
 *
 * 覆盖：
 *  - DEF/freshState/normalizeState 作为唯一默认值来源：新用户四书可直接学习；
 *  - 新用户默认值逐项核对（词书/新词/复习上限/每组/曲线/顺序/范围/外观/键盘/自动续背/临时加量）；
 *  - 旧记录兼容分支与新用户默认分开：缺 stages→旧版密集、缺 cap→不限、缺 autoResume→关闭；
 *  - 单个非法字段只修该字段，不整份重置；旧 v1/v2/v3 备份导入不报错、不丢字段；
 *  - 设置页控件显示值与实际行为一致；TXT 拆分默认 4000、打印来源默认错词本；
 *  - 「恢复默认」按类：学习计划 / 范围筛选 / 外观与键盘，只影响该类，不清空学习/熟练/收藏。
 *
 * 运行：node --max-old-space-size=512 js/test-defaults.mjs
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
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
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

/* ---------------- 预置旧版记录（21 旧记录兼容分支） ---------------- */
store.set(KEY, JSON.stringify({
  settings: {dailyNew: 33, theme: "dark", order: "wrong"},
  progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0
}));

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

/** 通用夹具：清空当前书记录并写入范围/计划；不伪造 session。 */
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
    pos: [], posMode: "primary", singleCharKeys: true, dailyReviewCap: 0,
    groupSize: o.groupSize === undefined ? 30 : o.groupSize,
    backlogGuard: true
  });
  const d = todayStr();
  s.days[d] = { n: o.dayN || 0, r: o.dayN || 0, ok: o.dayN || 0, no: 0 };
  s.reviewDay = { d, used: 0 };
  s.extraDay = { d, extra: 0 };
  T.startSession("main");
  return s;
}
function answerAllKnown() {
  let guard = 0;
  while (T.cur != null && guard++ < 200) { T.judge(true); T.tryNext(); }
  return guard;
}
function setInput(id, value) {
  const el = stateEl(id);
  el.value = String(value);
  el.checked = false;
  fireEvent(el, "change");
}
function setCheck(id, value) {
  const el = stateEl(id);
  el.checked = !!value;
  fireEvent(el, "change");
}
function clickChip(k) {
  const b = posChips.find(x => x.dataset.pos === k);
  fireClick(b);
}
function clickPosMode(mode) {
  fireClick(posModeButtons.find(b => b.dataset.posMode === mode));
}
function clickCombo(name) {
  fireClick(comboButtons.find(b => b.dataset.combo === name));
}
function clickPminPreset(v) {
  fireClick(pminPresetButtons.find(b => b.dataset.pmin === String(v)));
}

/* ---------------- 21 期望默认值（与 DEF/文档一致，显式写出以免静默漂移） ---------------- */
const EXPECT = {
  book: "kaoyan",
  dailyNew: 20, dailyReviewCap: 100, groupSize: 30, backlogGuard: true,
  order: "shuffle", fmin: 1, fmax: 0, pmin: 2, kyOnly: false, pos: [], posMode: "primary",
  stages: [1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400],
  relearn: 1440, stagePreset: "balanced",
  theme: "light", showPh: true, showEx: true, showFm: true, autoSpk: false, singleCharKeys: true,
  keys: {know: "f", dont: "j", next: " ", speak: "s", star: "b", proficient: "m"},
  autoResume: {enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000}
};
function assertFreshDefaults(label) {
  const s = settings();
  ck(s.dailyNew === EXPECT.dailyNew, `${label}：每日新词 ${EXPECT.dailyNew}`, String(s.dailyNew));
  ck(s.dailyReviewCap === EXPECT.dailyReviewCap, `${label}：单日复习上限 ${EXPECT.dailyReviewCap}`, String(s.dailyReviewCap));
  ck(s.groupSize === EXPECT.groupSize && s.backlogGuard === EXPECT.backlogGuard,
    `${label}：每组 ${EXPECT.groupSize} / 积压保护开`, `${s.groupSize}/${s.backlogGuard}`);
  ck(s.order === EXPECT.order, `${label}：随机乱序`, String(s.order));
  ck(s.fmin === EXPECT.fmin && s.fmax === EXPECT.fmax && s.pmin === EXPECT.pmin && s.kyOnly === EXPECT.kyOnly,
    `${label}：范围默认 ≥1 次 / 上限不限 / ≥2 套卷 / 大纲关`,
    JSON.stringify({fmin: s.fmin, fmax: s.fmax, pmin: s.pmin, kyOnly: s.kyOnly}));
  ck(eq(s.pos, []) && s.posMode === EXPECT.posMode, `${label}：词性不限 / 主要词性口径`, JSON.stringify(s.pos) + "/" + s.posMode);
  ck(eq(s.stages, EXPECT.stages) && s.relearn === EXPECT.relearn && s.stagePreset === EXPECT.stagePreset,
    `${label}：均衡十档曲线 + 1 天重学`, `${JSON.stringify(s.stages)}/${s.relearn}/${s.stagePreset}`);
  ck(s.theme === EXPECT.theme && s.showPh && s.showEx && s.showFm && !s.autoSpk && s.singleCharKeys,
    `${label}：浅色 / 显示音标例句词形 / 自动发音关 / 单字符快捷键开`, JSON.stringify({
      theme: s.theme, showPh: s.showPh, showEx: s.showEx, showFm: s.showFm, autoSpk: s.autoSpk, single: s.singleCharKeys
    }));
  ck(eq(s.keys, EXPECT.keys), `${label}：默认按键 F/J/空格/S/B/M`, JSON.stringify(s.keys));
  ck(s.autoResume && s.autoResume.enabled === true && s.autoResume.threshold === 5
    && s.autoResume.idleMs === 120000 && s.autoResume.countdownMs === 15000,
    `${label}：自动续背默认开启（5 张 / 2 分钟 / 15 秒）`, JSON.stringify(s.autoResume));
  const ed = T.getExtraDay(), rd = T.getReviewLedger();
  ck(ed.extra === 0 && ed.d === todayStr(), `${label}：今日临时加量 0`, JSON.stringify(ed));
  ck(rd.used === 0 && rd.d === todayStr(), `${label}：今日复习台账 0`, JSON.stringify(rd));
  ck(S().days[todayStr()] === undefined || S().days[todayStr()].n === 0, `${label}：今日已学 0`);
}

/* ================= 0. 契约钩子 ================= */
console.log("== 0. 契约钩子 ==");
{
  for (const name of ["normalizeState", "importState", "buildExport", "resetSettingsClass", "getAutoResume", "getS"]) {
    ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  }
  const ar = T.getAutoResume();
  ck(ar && typeof ar.enabled === "boolean" && Number.isInteger(ar.threshold)
    && Number.isInteger(ar.idleMs) && Number.isInteger(ar.countdownMs),
    "getAutoResume() 返回规范化对象", JSON.stringify(ar));
}

/* ================= 1. 旧记录兼容分支（与全新默认分开） ================= */
console.log("== 1. 预置旧记录：兼容分支与新用户默认分开 ==");
{
  const s = settings();
  ck(s.dailyNew === 33 && s.theme === "dark" && s.order === "wrong",
    "旧记录已有显式偏好保留（dailyNew/主题/顺序）", JSON.stringify({dailyNew: s.dailyNew, theme: s.theme, order: s.order}));
  ck(eq(s.stages, [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400]) && s.relearn === 5
    && s.stagePreset === "legacy", "旧记录缺 stages → 旧版密集曲线（不覆盖原到期时间）",
    JSON.stringify({stages: s.stages, relearn: s.relearn}));
  ck(s.dailyReviewCap === 0, "旧记录缺 dailyReviewCap → 0（不限，旧行为）", String(s.dailyReviewCap));
  ck(s.autoResume && s.autoResume.enabled === false && s.autoResume.threshold === 5
    && s.autoResume.idleMs === 120000 && s.autoResume.countdownMs === 15000,
    "旧记录缺 autoResume → 关闭（推荐方案其余默认）", JSON.stringify(s.autoResume));
  ck(s.groupSize === 30 && s.backlogGuard === true && s.posMode === "primary",
    "旧记录缺 07/06 字段 → 30/开/primary", JSON.stringify({g: s.groupSize, b: s.backlogGuard, m: s.posMode}));
  ck(s.showPh === true && s.showEx === true && s.showFm === true && s.autoSpk === false && s.singleCharKeys === true,
    "旧记录缺显示/键盘字段 → 默认值");
  ck(T.getBook() === "kaoyan", "旧记录启动仍在考研书");
  ck(T.cur != null && T.Q.length > 0, "旧记录启动即可继续学习（直接出一组卡）", `cur=${T.cur} Q=${T.Q.length}`);

  // 设置页为旧用户提供「开启推荐方案」，不静默开启。
  T.show("set");
  ck(stateEl("#autoResumeLegacy").hidden === false, "旧记录设置页显示「开启推荐方案」提示");
  ck(stateEl("#autoResumePresets") && true, "设置页含自动续背预设容器");
  const arBefore = T.getAutoResume();
  ck(arBefore.enabled === false, "旧记录在用户操作前保持关闭");
  stateEl("#autoResumeRecommend").onclick();
  const arAfter = T.getAutoResume();
  ck(arAfter.enabled === true && arAfter.threshold === 5 && arAfter.idleMs === 120000 && arAfter.countdownMs === 15000,
    "点「开启推荐方案」= 5 张 / 2 分钟 / 15 秒", JSON.stringify(arAfter));
  ck(stateEl("#autoResumeLegacy").hidden === true, "开启后推荐提示隐藏");
  ck(stored().settings.autoResume.enabled === true, "自动续背设置落盘");
}

/* ================= 2. 新用户默认值（重置后四书） ================= */
console.log("== 2. 新用户默认：重置后与三本未写过的书 ==");
{
  fireClick(stateEl("#rst"));
  ck(T.cur != null && T.Q.length > 0, "重置为全新记录后打开即可学习（无需先设选项）", `Q=${T.Q.length}`);
  assertFreshDefaults("考研全新");
  for (const id of ["cet4", "cet6", "combined"]) {
    T.switchBook(id);
    assertFreshDefaults(id + "全新");
    ck(T.cur != null && T.Q.length > 0, `${id} 全新打开即可学习`, `Q=${T.Q.length}`);
  }
  T.switchBook("kaoyan");
}

/* ================= 3. 设置页控件显示值与行为一致 ================= */
console.log("== 3. 设置页控件显示值与默认行为一致 ==");
{
  T.show("set");
  ck(String(stateEl("#dailyNew").value) === "20", "控件 #dailyNew 显示 20", String(stateEl("#dailyNew").value));
  ck(String(stateEl("#groupSize").value) === "30", "控件 #groupSize 显示 30", String(stateEl("#groupSize").value));
  ck(stateEl("#order").value === "shuffle", "控件 #order 显示随机乱序", String(stateEl("#order").value));
  ck(String(stateEl("#fmin").value) === "1" && stateEl("#fmax").value === "", "控件词频 1 / 上限空（不限）",
    `${stateEl("#fmin").value}|${stateEl("#fmax").value}`);
  ck(String(stateEl("#pmin").value) === "2", "控件最少套卷 2", String(stateEl("#pmin").value));
  ck(stateEl("#kyOnly").checked === false, "控件大纲限定关闭");
  ck(stateEl("#showPh").checked === true && stateEl("#showEx").checked === true
    && stateEl("#showFm").checked === true && stateEl("#autoSpk").checked === false,
    "控件音标/例句/词形开、自动发音关");
  ck(stateEl("#singleCharKeys").checked === true, "控件单字符快捷键开启");
  ck(stateEl("#reviewCapCustom").value === "100", "复习上限自定义框显示 100", String(stateEl("#reviewCapCustom").value));
  ck(stateEl("#backlogGuard").checked === true, "积压保护开关开");
  ck(String(stateEl("#autoResumeThreshold").value) === "5", "自动续背阈值控件 5", String(stateEl("#autoResumeThreshold").value));
  ck(String(stateEl("#autoResumeIdleMin").value) === "2", "自动续背挂机分钟控件 2", String(stateEl("#autoResumeIdleMin").value));
  ck(String(stateEl("#autoResumeCountdownSec").value) === "15", "自动续背倒计时控件 15", String(stateEl("#autoResumeCountdownSec").value));
  ck(/已开启/.test(stateEl("#autoResumeStatus").textContent), "自动续背状态文案明确已开启", stateEl("#autoResumeStatus").textContent);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(html.includes('id="s-newmax">20<') && html.includes('id="s-revmax">100<'),
    "index.html 初始占位与默认一致（今日新词 20 / 复习上限 100）");
  const printIdx = html.indexOf('id="printSource"');
  const printBlock = printIdx > 0 ? html.slice(printIdx, printIdx + 500) : "";
  ck(printIdx > 0 && printBlock.indexOf('<option value="wrong">错词本</option>') > 0
    && printBlock.indexOf('<option value="wrong">') < printBlock.indexOf('<option value="star">'),
    "打印来源默认错词本（来源下拉的第一个选项）", printBlock.slice(0, 160));
  ck(html.includes('id="txtSplitAmount"') && /id="txtSplitAmount"[^>]*value="4000"/.test(html),
    "TXT 拆分默认每份 4000 词（静态默认值）");
  const appSrc = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
  ck(/const TXT_SPLIT_DEFAULT = 4000;/.test(appSrc), "TXT 拆分默认值来自唯一常量 TXT_SPLIT_DEFAULT");
  ck(/id="autoResume"/.test(html) && /id="autoResumePause"/.test(html) && /id="autoResumePresets"/.test(html),
    "index.html 含自动续背完成页与设置页节点");
  ck(/data-reset="plan"/.test(html) && /data-reset="appearance"/.test(html),
    "index.html 含按类恢复默认按钮（计划/外观）");
}

/* ================= 4. 单个非法字段只修该字段 ================= */
console.log("== 4. 非法值回退：只修该字段，不整份重置 ==");
{
  const norm = (settingsPatch, extra) => T.normalizeState(Object.assign({ progress: {}, days: {}, settings: settingsPatch }, extra || {}), "kaoyan").settings;
  const kept = norm({ dailyNew: 650, theme: "dark", order: "shuffle", autoResume: { enabled: true, threshold: 5, idleMs: 120000, countdownMs: 15000 } });
  ck(kept.dailyNew === 500, "非法 dailyNew=650 → 500", String(kept.dailyNew));
  ck(kept.theme === "dark" && kept.order === "shuffle", "非法字段旁的其他设置保留");
  const badOrder = norm({ order: "<img>", theme: "dark" });
  ck(badOrder.order === "shuffle" && badOrder.theme === "dark", "非法 order → 默认 shuffle，主题保留");
  const badCap = norm({ dailyReviewCap: 9999, dailyNew: 8 });
  ck(badCap.dailyReviewCap === 0 && badCap.dailyNew === 8, "非法复习上限 → 0（旧记录兼容）且 dailyNew 保留");
  const partial = norm({ autoResume: { enabled: true } });
  ck(partial.autoResume.enabled === true && partial.autoResume.threshold === 5
    && partial.autoResume.idleMs === 120000 && partial.autoResume.countdownMs === 15000,
    "autoResume 只给 enabled 时其余子项取默认", JSON.stringify(partial.autoResume));
  const badSub = norm({ autoResume: { enabled: true, threshold: "x", idleMs: -1, countdownMs: 999999 } });
  ck(badSub.autoResume.enabled === true && badSub.autoResume.threshold === 5
    && badSub.autoResume.idleMs === 120000 && badSub.autoResume.countdownMs === 15000,
    "autoResume 单个非法子项只修该子项（enabled 保留）", JSON.stringify(badSub.autoResume));
  const badEnabled = norm({ autoResume: { enabled: "yes", threshold: 3 } });
  ck(badEnabled.autoResume.enabled === false && badEnabled.autoResume.threshold === 3,
    "autoResume.enabled 非布尔 → false，合法阈值保留", JSON.stringify(badEnabled.autoResume));
  const missing = norm({ dailyNew: 44 });
  ck(missing.stages.length === 10 && missing.stages[0] === 5 && missing.relearn === 5,
    "旧记录缺 stages → legacy 曲线（与新用户 balanced 分开）");
  const badStages = norm({ stages: [1, 2, 3], relearn: 5, theme: "dark" });
  ck(badStages.stages[0] === 5 && badStages.relearn === 5 && badStages.theme === "dark",
    "非法曲线整组回退 legacy，其他字段保留");
  const good = norm({ stages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], relearn: 60, stagePreset: "whatever" });
  ck(eq(good.stages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) && good.relearn === 60 && good.stagePreset === "custom",
    "合法曲线保留并按数值反推 preset");
}

/* ================= 5. 旧备份 v1/v2/v3 导入兼容 ================= */
console.log("== 5. 旧备份 v1/v2/v3 导入：不报错、不丢字段 ==");
{
  // 先回到全新记录。
  fireClick(stateEl("#rst"));
  // v1 平铺旧备份（缺 autoResume 等新字段）
  T.importState({
    settings: { dailyNew: 13, theme: "dark", fmin: 2 },
    progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 60
  });
  const s1 = settings();
  ck(s1.dailyNew === 13 && s1.theme === "dark" && s1.fmin === 2, "v1 旧备份设置导入不报错且字段保留",
    JSON.stringify({d: s1.dailyNew, t: s1.theme, f: s1.fmin}));
  ck(s1.autoResume.enabled === false, "v1 旧备份缺 autoResume → 关闭");
  ck(s1.dailyReviewCap === 0 && eq(s1.stages, [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400]),
    "v1 旧备份缺 cap/stages → 不限 / legacy 曲线");
  ck(S().timeSec === 60, "v1 旧备份累计时长保留", String(S().timeSec));
  // v2 分书备份（考研 settings 缺新字段）
  T.importState({
    app: "kaoyan-vocab", version: 2, exportedAt: new Date().toISOString(), activeBook: "kaoyan",
    books: { kaoyan: { settings: { dailyNew: 17, theme: "dark" }, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 } }
  });
  ck(settings().dailyNew === 17 && settings().theme === "dark", "v2 备份设置导入且字段保留");
  ck(settings().autoResume.enabled === false, "v2 备份缺 autoResume → 关闭");
  // v3 当前版本导出：自定义自动续背往返保留。
  T.setAutoResume({ enabled: true, threshold: 7, idleMs: 180000, countdownMs: 10000 });
  const backup = T.buildExport();
  ck(backup && backup.version === 3 && backup.books.kaoyan.settings.autoResume.threshold === 7,
    "v3 导出包含 autoResume 完整字段");
  T.setAutoResume({ enabled: false, threshold: 5, idleMs: 120000, countdownMs: 15000 });
  T.importState(backup);
  const ar3 = T.getAutoResume();
  ck(ar3.enabled === true && ar3.threshold === 7 && ar3.idleMs === 180000 && ar3.countdownMs === 10000,
    "v3 备份导入往返保留自动续背自定义设置", JSON.stringify(ar3));
  ck(settings().dailyNew === 17 && settings().theme === "dark", "v3 导入后其他设置仍保留");
}

/* ================= 6. 按类恢复默认 ================= */
console.log("== 6. 「恢复默认」按类实现：只影响该类 ==");
{
  fireClick(stateEl("#rst"));
  // 人为改动三类设置，并写入学习/熟练/收藏。
  Object.assign(settings(), {
    dailyNew: 77, groupSize: 7, dailyReviewCap: 0, backlogGuard: false, order: "wrong",
    autoResume: { enabled: false, threshold: 9, idleMs: 60000, countdownMs: 5000 },
    fmin: 5, fmax: 3, pmin: 0, kyOnly: true, pos: ["n"], posMode: "all",
    theme: "dark", showPh: false, showEx: false, showFm: false, autoSpk: true, singleCharKeys: false,
    keys: { know: "k", dont: "l", next: " ", speak: "s", star: "b", proficient: "m" }
  });
  const word = T.getW()[T.cur].w;
  T.setProficient(T.cur, true);
  const progressBefore = clone(S().progress);
  const profBefore = clone(S().proficient);
  const starsBefore = clone(S().stars);
  T.setAutoResume({ enabled: true, threshold: 7, idleMs: 180000, countdownMs: 10000 });

  T.resetSettingsClass("plan");
  let s = settings();
  ck(s.dailyNew === 20 && s.groupSize === 30 && s.dailyReviewCap === 100 && s.backlogGuard === true && s.order === "shuffle",
    "学习计划恢复默认：新词/每组/上限/积压/顺序", JSON.stringify({
      d: s.dailyNew, g: s.groupSize, c: s.dailyReviewCap, b: s.backlogGuard, o: s.order
    }));
  ck(s.autoResume.enabled === true && s.autoResume.threshold === 5 && s.autoResume.idleMs === 120000
    && s.autoResume.countdownMs === 15000, "学习计划恢复默认同时恢复自动续背推荐方案", JSON.stringify(s.autoResume));
  ck(s.fmin === 5 && s.posMode === "all" && s.theme === "dark" && s.showEx === false && s.keys.know === "k",
    "计划恢复默认不动范围/外观/按键");

  T.resetSettingsClass("scope");
  s = settings();
  ck(s.fmin === 1 && s.fmax === 0 && s.pmin === 2 && s.kyOnly === false && eq(s.pos, []) && s.posMode === "primary",
    "范围筛选恢复默认：词频/套卷/大纲/词性", JSON.stringify({fmin: s.fmin, fmax: s.fmax, pmin: s.pmin, m: s.posMode}));
  ck(s.dailyNew === 20 && s.theme === "dark" && s.showEx === false, "范围恢复默认不动计划/外观");

  T.resetSettingsClass("appearance");
  s = settings();
  ck(s.theme === "light" && s.showPh && s.showEx && s.showFm && !s.autoSpk,
    "外观与显示恢复默认：浅色 + 显示项 + 自动发音关", JSON.stringify({
      t: s.theme, p: s.showPh, e: s.showEx, f: s.showFm, a: s.autoSpk
    }));
  ck(eq(s.keys, EXPECT.keys), "外观与键盘恢复默认同时恢复默认按键");
  ck(s.singleCharKeys === false, "恢复默认按键不会自动重新启用单字符快捷键（AGENTS 契约）");
  ck(s.fmin === 1 && s.dailyNew === 20, "外观恢复默认不动范围/计划");
  ck(JSON.stringify(S().proficient) === JSON.stringify(profBefore), "恢复默认不清空熟练名单");
  ck(JSON.stringify(S().stars) === JSON.stringify(starsBefore), "恢复默认不清空收藏");
  ck(Object.keys(S().progress).length >= Object.keys(progressBefore).length, "恢复默认不清空学习进度");
  ck(!!S().proficient[word], "已标熟练的词仍在熟练名单中");
  ck(T.isProficient(T.getW().findIndex(x => x.w === word)), "熟练仍按正式判据生效");
}

/* ================= 7. TXT 拆分默认值行为 ================= */
console.log("== 7. TXT 拆分默认每份 4000 词 ==");
{
  fireClick(stateEl("#rst"));
  const n = T.inScopeCount();
  const opened = T.openTxtSplit("scope");
  ck(opened === true, "打开 TXT 拆分面板");
  ck(stateEl("#txtSplitAmount").value === "4000", "TXT 拆分数量默认 4000", String(stateEl("#txtSplitAmount").value));
  const files = T.getTxtSplitFiles();
  ck(files.length === Math.ceil(n / 4000), "默认按每份 4000 词切分", `${files.length} vs ${Math.ceil(n / 4000)}`);
  T.closeSheet();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
