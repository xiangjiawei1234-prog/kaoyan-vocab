/**
 * 08 设置与当前组生命周期（回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据 + 受控时钟），不复制业务逻辑。
 *
 * 覆盖：
 *  - sessionPlan 扩展 scopeSig/scopeCount/dailyNewTarget，本组开始时冻结范围/计划；
 *  - dailyNew/order/fmin/fmax/pmin/kyOnly/pos/posMode/combo 预设/groupSize 改动只保存与预览，
 *    不 startSession、不重建队列、不清判定/撤销/特训/子组现场；
 *  - 设置页“下一组预览 + 当前组快照”文案与显式“应用并重新开始”按钮行为；
 *  - 无进行中组（完成页）改设置不自动开组，由用户点继续；
 *  - 组内改范围后队列仍按开始时的范围快照（不逐张剔除、分母固定）；
 *  - 切书/跨天与显式重开后新计划一致；特训、子组内改设置稳定。
 *
 * 运行：node --max-old-space-size=512 js/test-lifecycle.mjs
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

/* ================= 0. 契约钩子 ================= */
console.log("== 0. 契约钩子与计划快照字段 ==");
{
  const required = ["getPlan", "getSettingsLifecycle", "hasPendingScopeSettings", "applySettingsRestart",
    "resetSettingsClass", "scopeSummaryText", "getAutoResume", "getCandidatesNow", "getAutoResumeState"];
  for (const name of required) ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  const p = T.getPlan();
  ck(p && typeof p.scopeSig === "string" && Number.isInteger(p.scopeCount) && Number.isInteger(p.dailyNewTarget),
    "getPlan() 含 scopeSig/scopeCount/dailyNewTarget", JSON.stringify(p));
  ck(T.hasPendingScopeSettings() === false, "刚开组时设置与快照一致（pending=false）");
  const lc = lifecycle();
  ck(lc && lc.pending === false && lc.active === true && lc.nextScopeCount === T.inScopeCount(),
    "getSettingsLifecycle() 预览下一组词数且当前组 active", JSON.stringify(lc));
}

/* ================= 1. 连续改设置不重建当前组 ================= */
console.log("== 1. 连续改设置：只保存/预览，不重建当前组 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  const before = groupSig();
  const planBefore = clone(plan());
  const cases = [
    ["dailyNew", () => setInput("#dailyNew", 37), () => settings().dailyNew === 37],
    ["order", () => setInput("#order", "shuffle"), () => settings().order === "shuffle"],
    ["fmin", () => setInput("#fmin", 3), () => settings().fmin === 3],
    ["fmax", () => setInput("#fmax", 50), () => settings().fmax === 50],
    ["pmin", () => setInput("#pmin", 2), () => settings().pmin === 2],
    ["kyOnly", () => setCheck("#kyOnly", true), () => settings().kyOnly === true],
    ["groupSize", () => setInput("#groupSize", 5), () => settings().groupSize === 5],
    ["showEx（外观立即生效）", () => setCheck("#showEx", false), () => settings().showEx === false],
    ["posMode 按钮", () => clickPosMode("all"), () => T.getPosMode() === "all"],
    ["词性 chip", () => clickChip("v"), () => settings().pos.includes("v")],
    ["combo 预设", () => clickCombo("core"), () => settings().fmin === 5 && settings().pmin === 3],
    ["pmin 预设", () => clickPminPreset(5), () => settings().pmin === 5],
    ["恢复默认筛选", () => clickCombo("reset"), () => settings().fmin === 1 && settings().pmin === 2 && settings().pos.length === 0]
  ];
  for (const [label, act, changed] of cases) {
    act();
    ck(changed(), `${label} 已写入并自动保存`, JSON.stringify(settings()));
    ck(eqGroup(groupSig(), before), `${label} 不重建当前组（当前卡/队列/进度保持）`, JSON.stringify(groupSig()));
  }
  ck(T.hasPendingScopeSettings() === true, "改设置后 isPending=true");
  const lc = lifecycle();
  ck(lc.pending === true && lc.active === true, "生命周期状态：进行中 + 待应用", JSON.stringify(lc));
  ck(lc.plan && lc.plan.scopeCount === planBefore.scopeCount && lc.plan.dailyNewTarget === planBefore.dailyNewTarget,
    "生命周期里的当前组仍是开始时的快照", JSON.stringify(lc.plan));
  const savedState = stored();
  ck(savedState && savedState.settings.dailyNew === 37 && savedState.settings.groupSize === 5,
    "设置仍即时自动保存（计划/范围字段落盘）");
  ck(savedState.settings.order === "shuffle" && savedState.settings.posMode === "primary",
    "落盘值来自最后一次「恢复默认筛选」链（order 保留、posMode 回 primary）",
    JSON.stringify({ order: savedState.settings.order, posMode: savedState.settings.posMode }));
  const study = T.getPlan();
  ck(study.dailyNewTarget === planBefore.dailyNewTarget && study.scopeSig === planBefore.scopeSig,
    "本组计划 scopeSig/dailyNewTarget 冻结（不追溯）");
}

/* ================= 2. 设置页预览/当前组文案/显式重开 ================= */
console.log("== 2. 设置页预览与「应用并重新开始」==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  T.show("set");
  // 先完成一次设置变更，产生 pending。
  setInput("#dailyNew", 30);
  const nextHtml = stateEl("#settingsNextPreview").innerHTML;
  ck(/下一组预览/.test(nextHtml) && nextHtml.includes(String(T.inScopeCount())),
    "设置页实时预览「下一组」匹配词数", nextHtml);
  ck(nextHtml.includes("每日 30 新词") && nextHtml.includes("每组 10 词"),
    "预览含范围摘要与当前计划", nextHtml);
  const curHtml = stateEl("#settingsCurrentGroup").innerHTML;
  ck(/当前组/.test(curHtml) && /分母固定/.test(curHtml),
    "设置页标明当前组使用开始时的范围/计划且分母固定", curHtml);
  ck(/设置已更改，将在下一组生效/.test(curHtml), "当前组明确标注设置待应用", curHtml);
  const pendingText = stateEl("#planPendingText").innerHTML;
  ck(/本组每日新词计划 <b>20<\/b>/.test(pendingText)
    && /下一组已保存计划 <b>30<\/b>/.test(pendingText),
    "待应用提示分别说明本组冻结计划与下一组已保存计划", pendingText);
  ck(stateEl("#s-newlabel").textContent === "下组目标" && stateEl("#s-newmax").textContent === "30",
    "计划待生效时统计条明确显示下组目标，设置页修改也同步数字");
  const newGoalTitle = stateEl("#newGoalChip").getAttribute("title");
  ck(newGoalTitle.includes("当前组每日新词计划 20") && newGoalTitle.includes("下一组计划 30"),
    "统计条标题解释当前组与下一组目标，未修改额度公式", newGoalTitle);
  const btn = stateEl("#applySettingsRestart");
  ck(btn.hidden === false && btn.disabled === false, "待应用时显示可用的「应用并重新开始本组」");
  const before = groupSig();
  const planBefore = clone(T.getPlan());
  btn.onclick();
  const after = groupSig();
  ck(after.answered === 0 && after.qi === 0 && T.cur != null, "点击后重建本组（进度归零、有新卡）");
  const newPlan = T.getPlan();
  ck(newPlan.dailyNewTarget === 30 && T.hasPendingScopeSettings() === false,
    "新组计划使用当前设置（每日 30），pending 清零", JSON.stringify({ d: newPlan.dailyNewTarget, pending: T.hasPendingScopeSettings() }));
  ck(newPlan.startedAt >= planBefore.startedAt, "重开生成新的 startedAt");
  const lc = lifecycle();
  ck(lc.active === true && lc.pending === false, "生命周期回到「当前组与设置一致」", JSON.stringify(lc));
  ck(stateEl("#s-newlabel").textContent === "今日新词", "新组应用计划后恢复今日新词标签");

  // 无进行中组：完成本组后改设置不自动开组，点继续才按新设置开组。
  answerAllKnown();
  ck(T.cur === null, "本组已完成后进入完成页");
  const donePlan = clone(T.getPlan());
  const doneGroup = groupSig();
  setInput("#dailyNew", 12);
  ck(T.cur === null && eqGroup(groupSig(), doneGroup), "完成页改设置不自动开组（当前卡/队列不变）", JSON.stringify(groupSig()));
  ck(T.getPlan().scopeSig === donePlan.scopeSig, "完成页改设置不改写上一组计划快照");
  const doneHtml = stateEl("#card").innerHTML;
  ck(/设置已更改：下一组将按新设置开始/.test(doneHtml),
    "完成页明确标注「下一组按新设置、上一组仍按开始时的范围统计」", doneHtml.slice(0, 300));
  ck(lifecycle().active === false, "完成页 lifecycle.active=false");
  const curHtml2 = stateEl("#settingsCurrentGroup").innerHTML;
  ck(/当前没有进行中的组/.test(curHtml2), "设置页提示无进行中组、点继续时才按新设置开组", curHtml2);
  ck(stateEl("#applySettingsRestart").hidden === true, "无进行中组时隐藏「应用并重新开始本组」");
  T.startSession("main");
  ck(T.cur != null && T.getPlan().dailyNewTarget === 12, "用户点继续后按新设置开组");
}

/* ================= 3. 学习页待应用提示 ================= */
console.log("== 3. 学习页轻提示与重开入口 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  const before = groupSig();
  setInput("#dailyNew", 25);
  const box = stateEl("#planPendingNotice");
  ck(box.hidden === false, "进行中组改设置后学习页出现待应用提示");
  const text = stateEl("#planPendingText").innerHTML;
  ck(/下一组生效/.test(text) && /分母固定/.test(text), "提示说明只影响下一组、本组分母固定", text);
  const nextBtn = stateEl("#planPendingApply");
  ck(typeof nextBtn.onclick === "function", "提示内提供「应用并重新开始」按钮");
  nextBtn.onclick();
  ck(T.cur != null && T.getPlan().dailyNewTarget === 25 && T.hasPendingScopeSettings() === false,
    "提示内按钮同样重建本组并应用新计划");
  ck(stateEl("#planPendingNotice").hidden === true, "重开后提示消失");
  // 无 pending 时不显示。
  setup({ dailyNew: 20, groupSize: 10 });
  ck(stateEl("#planPendingNotice").hidden === true, "设置与快照一致时不显示待应用提示");
}

/* ================= 4. 已揭示卡 / 撤销现场稳定 ================= */
console.log("== 4. 已揭示卡与撤销现场在改设置时稳定 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  T.judge(true);
  ck(T.phase === "revealed" && T.verdict === true, "先判定一张卡（已揭示）");
  const undoLen = T.getS ? 1 : 1;
  setInput("#dailyNew", 44);
  setInput("#fmin", 2);
  clickPosMode("all");
  clickChip("a");
  ck(T.cur != null && T.phase === "revealed" && T.verdict === true, "改设置不清空判定/揭示状态");
  ck(/释义与用法/.test(stateEl("#card").innerHTML), "已揭示卡内容仍在");
  // 撤销现场：撤销判定仍可用（队列/进度回滚）。
  T.undo();
  ck(T.verdict === null && T.phase === "recall" && T.answered === 0, "改设置后撤销现场仍可用（撤销回到未判定）");
  // 已翻页的撤销（下一步）仍可用。
  T.judge(true);
  T.tryNext();
  setInput("#dailyNew", 33);
  T.undo();
  ck(T.qi === 0 && T.verdict === true && T.phase === "revealed",
    "改设置后可撤销翻页（撤销栈保留，回到已判定卡）",
    JSON.stringify({ qi: T.qi, verdict: T.verdict, phase: T.phase }));
}

/* ================= 5. 特训 / 子组内改设置 ================= */
console.log("== 5. 特训与受控子组内改设置稳定 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  const i = T.cur;
  T.judge(false);
  T.tryNext();
  ck(T.startDrill() === true && T.drillMode === true, "进入错词特训");
  const drillGroup = { cur: T.cur, Q: T.Q.slice() };
  setInput("#dailyNew", 21);
  clickPosMode("all");
  ck(T.drillMode === true && T.cur === drillGroup.cur && eq(T.Q, drillGroup.Q),
    "特训内改设置不重建特训队列/当前卡");
  ck(T.hasPendingScopeSettings() === true, "特训内可检测到设置待应用");
  const restartInDrill = stateEl("#planPendingApply");
  ck(stateEl("#planPendingNotice").hidden === true, "特训内不显示学习页待应用提示（不抢界面）");
  ck(T.applySettingsRestart() === false, "特训中显式重开被拒绝（先退出特训）");
  T.exitDrill();
  ck(T.drillMode === false, "退出特训回到主组");

  // 完成主组后加量，从完成页进入 extra 子组；子组内改设置保持稳定。
  answerAllKnown();
  T.grantExtraNew(10);
  const entered = T.startExtraSubgroup();
  ck(entered === true && T.isExtraSubgroup() === true, "完成页加量后进入临时加量子组");
  const subGroup = { cur: T.cur, Q: T.Q.slice() };
  setInput("#dailyNew", 22);
  ck(T.isExtraSubgroup() === true && T.cur === subGroup.cur && eq(T.Q, subGroup.Q),
    "子组内改设置不重建子组队列");
  T.endExtraSubgroup();
  ck(T.isExtraSubgroup() === false, "返回原组现场不丢进度");
}

/* ================= 6. 组内范围快照：不逐张剔卡、分母固定 ================= */
console.log("== 6. 组内改范围：队列沿用开始时快照 ==");
{
  const s = setup({ dailyNew: 20, groupSize: 8, order: "freq" });
  const initialQ = T.Q.slice();
  const total = T.getGroupTotal();
  ck(total === 8, "本组入组 8 张（分母固定）", String(total));
  // 改成很窄的范围，使当前组里的部分词不在新范围内。
  setInput("#fmin", 500);
  ck(T.inScopeCount() < total, "新设置范围已明显缩小", `${T.inScopeCount()} < ${total}`);
  const outOfScope = initialQ.filter(i => !T.inScope(i));
  ck(outOfScope.length > 0, "当前组中确有词不在新范围内", String(outOfScope.length));
  T.judge(true);
  T.tryNext();
  ck(T.getGroupTotal() === total, "组内改范围不改变本组分母", String(T.getGroupTotal()));
  ck(T.Q.length === total && outOfScope.every(i => T.Q.includes(i)) || T.qi > 0,
    "下一张卡不会因新范围把已入组卡逐张剔除", `Q=${T.Q.length} qi=${T.qi}`);
  // 一直答完：分母固定、完成页仍显示本组完成 x/total。
  answerAllKnown();
  ck(T.cur === null, "本组按开始时的范围走完");
  const footer = stateEl("#groupFooterText").innerHTML;
  ck(new RegExp("本组完成 <b>" + total + "</b>/<b>" + total + "</b>").test(footer),
    "完成页本组完成数/分母仍为开始时入组张数", footer);
}

/* ================= 7. 跨天与切书 ================= */
console.log("== 7. 跨天 / 切书一致 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  T.judge(true);
  const i = T.cur, verdictBefore = T.verdict;
  setInput("#dailyNew", 31);
  advance(24 * 60 * 60 * 1000);
  T.refreshForResume();
  ck(T.cur === i && T.verdict === verdictBefore, "跨天 refreshForResume 不重建当前卡/判定");
  ck(T.getPlan().dailyNewTarget === 20, "跨天本组仍用开始时的计划快照");
  ck(T.hasPendingScopeSettings() === true, "跨天后仍标记待应用，下一组才生效");

  // 切书：目标书按自己的设置开新组，不会带着上一本书的 pending。
  const kaoyanDn = settings().dailyNew;
  T.switchBook("cet4");
  ck(T.getBook() === "cet4" && T.getPlan().bookId === "cet4", "切书后新组计划属于目标词书");
  ck(T.getPlan().dailyNewTarget === settings().dailyNew, "切书后计划使用目标书设置");
  ck(T.hasPendingScopeSettings() === false, "切书后新组与设置一致（无 pending）");
  T.switchBook("kaoyan");
  ck(T.getBook() === "kaoyan" && settings().dailyNew === kaoyanDn, "切回考研：本书设置仍保留");
  ck(T.getPlan().bookId === "kaoyan" && T.hasPendingScopeSettings() === false,
    "切回后按本书设置重新开组，pending 清零");
}

/* ================= 8. 频段滑块提交走同一保存/预览链 ================= */
console.log("== 8. 频段滑块提交 ==");
{
  setup({ dailyNew: 20, groupSize: 10 });
  const before = groupSig();
  const minEl = stateEl("#fminRange");
  minEl.value = "600";
  fireEvent(minEl, "input");
  fireEvent(minEl, "change");
  ck(settings().fmin > 1, "频段滑块提交更新 fmin", String(settings().fmin));
  ck(eqGroup(groupSig(), before), "频段滑块提交不重建当前组");
  const saved = stored();
  ck(saved && saved.settings.fmin === settings().fmin, "频段滑块设置已自动保存");
}

/* ================= 9. 恢复默认设置不重建当前组 ================= */
console.log("== 9. 按类恢复默认不影响学习进度 ==");
{
  setup({ dailyNew: 33, groupSize: 10 });
  const otherIdx = T.getW().length - 1;
  S().progress[otherIdx] = [1, now + 1000, 1, 0, now];
  const profIdx = T.getW().findIndex((x, i) => !T.Q.includes(i) && !T.isProficient(i));
  T.setProficient(profIdx, true);
  T.startSession("main");
  const before = groupSig();
  const profBefore = clone(S().proficient);
  const progressBefore = clone(S().progress);
  const r = T.resetSettingsClass("scope");
  ck(r.ok === true && settings().fmin === 1 && settings().pmin === 2 && settings().pos.length === 0,
    "范围筛选恢复默认（词频/套卷/词性/大纲）", JSON.stringify(settings()));
  ck(eqGroup(groupSig(), before), "范围筛选恢复默认不重建当前组");
  ck(eq(S().proficient, profBefore) && eq(S().progress, progressBefore),
    "恢复默认不清空熟练名单与学习进度");
  ck(T.resetSettingsClass("nope").ok === false, "未知恢复类别返回失败");
}

/* ================= 10. 跨标签仅设置变化保留当前组 ================= */
console.log("== 10. 跨标签设置同步不重开当前组 ==");
function receiveStoredSettings(change, { omitZeroDay = false } = {}) {
  const incoming = clone(stored());
  Object.assign(incoming.settings, change);
  if (omitZeroDay) incoming.days = {};
  store.set(KEY, JSON.stringify(incoming));
  for (const fn of winHandlers.get("storage") || []) fn({key: KEY});
}
{
  setup({dailyNew: 20, groupSize: 5});
  T.show("study");
  T.judge(true);
  const before = groupSig(), frozen = clone(plan()), word = T.cur;
  receiveStoredSettings({theme: "dark", groupSize: 3, pmin: 3});
  ck(eqGroup(groupSig(), before), "另一标签改主题/组长/范围不替换Q或重置已答数");
  ck(T.phase === "revealed" && T.verdict === true && T.cur === word, "另一标签设置同步保留当前揭示与判定");
  ck(eq(plan(), frozen), "跨标签设置同步仍保留冻结计划");
  ck(settings().theme === "dark" && document.documentElement.dataset.theme === "dark", "跨标签外观即时生效");
  ck(settings().groupSize === 3 && T.hasPendingScopeSettings(), "跨标签计划保存并提示下组生效");
  ck(String(stateEl("#scopeLabel").textContent).includes(frozen.scopeCount.toLocaleString())
    && String(stateEl("#scopeLabel").title).includes("下一组"), "学习页页头显示本组范围并解释下组设置");
  T.undo();
  ck(T.verdict === null && T.answered === 0 && !S().progress[word], "跨标签仅设置同步后撤销原判定仍有效");
}
{
  setup({groupSize: 5});
  T.resetSettingsClass("appearance");  // 使主记录和基线落盘，但不制造学习进度。
  const before = groupSig();
  receiveStoredSettings({fontSize: "large"}, {omitZeroDay: true});
  ck(eqGroup(groupSig(), before) && settings().fontSize === "large", "缺失日记录与全零日记录等价，字号同步不重建组");
}
{
  setup({groupSize: 5}); T.judge(true); T.openGuide();
  const before = groupSig();
  receiveStoredSettings({showEx: !settings().showEx});
  ck(!stateEl("#guideSheet").hidden && stateEl("#main").inert, "另一标签只改显示偏好不关闭已有浮层");
  ck(eqGroup(groupSig(), before) && T.phase === "revealed", "浮层内设置同步保留学习现场");
  T.closeSheet();
  ck(eqGroup(groupSig(), before), "关闭浮层后应用延迟显示更新不重开组");
}

/* ================= 11. storage事件延迟时保存采用设置三方合并 ================= */
console.log("== 11. 延迟设置事件不抢掉本次有效判定 ==");
{
  setup({dailyNew: 20, groupSize: 5}); T.judge(true); T.tryNext();
  const cur = T.cur, before = groupSig(), frozen = clone(plan());
  const incoming = clone(stored()); incoming.settings.theme = "dark"; incoming.settings.groupSize = 2;
  store.set(KEY, JSON.stringify(incoming));  // 模拟其他标签已写入，但storage事件尚未送达。
  T.judge(true);
  ck(T.cur === cur && T.phase === "revealed" && T.answered === before.answered + 1,
    "最新主记录只差设置时，本页判定正常提交且不重开组");
  ck(settings().theme === "dark" && settings().groupSize === 2 && eq(plan(), frozen),
    "保存冲突采用最新设置，仍不改本组冻结计划");
  ck(!!stored().progress[cur] && stored().settings.theme === "dark", "学习判定与远端设置一并落盘，不相互覆盖");
  T.undo();
  ck(!S().progress[cur] && settings().theme === "dark", "合并后撤销只回滚判定，不撤销远端偏好");
}
{
  setup({groupSize: 5}); T.judge(true);
  const incoming = clone(stored()); incoming.settings.theme = "dark";
  store.set(KEY, JSON.stringify(incoming));
  T.setGroupSize(7); // 本地显式改组长，与远端主题改动应逐字段合并。
  ck(settings().groupSize === 7 && settings().theme === "dark", "并发修改不同设置字段保留双方改动");
  ck(stored().settings.groupSize === 7 && stored().settings.theme === "dark", "不同字段合并结果已保存");
}

/* ================= 12. 实际外部内容变化仍权威同步 ================= */
console.log("== 12. 不把真实学习推进或清空误判成设置更新 ==");
{
  setup({groupSize: 5}); T.judge(true);
  const external = clone(stored()), other = T.Q[1];
  external.progress[other] = [1, now + 86400000, 1, 0, now];
  external.days[todayStr()].n++; external.days[todayStr()].r++; external.days[todayStr()].ok++;
  store.set(KEY, JSON.stringify(external));
  for (const fn of winHandlers.get("storage") || []) fn({key: KEY});
  ck(!!S().progress[other] && T.answered === 0, "其他标签真实主进度推进仍采用权威存储并安全开组");
  S().reviewDay = {d: todayStr(), used: 9};
  S().extraDay = {d: todayStr(), extra: 40};
  S().spelling = {sessions: 2, attempts: 2, correct: 1, skipped: 0, lastDay: null, lastSession: null};
  store.clear();
  for (const fn of winHandlers.get("storage") || []) fn({key: null});
  ck(Object.keys(S().progress).length === 0 && T.answered === 0, "localStorage.clear仍清除旧状态，不复活记录");
  ck(S().reviewDay.used === 0 && S().extraDay.extra === 0 && S().spelling.sessions === 0,
    "清空存储不复活旧复习台账/临时加量/专项汇总");
  T.resetSettingsClass("appearance");
  ck(stored().reviewDay.used === 0 && stored().extraDay.extra === 0 && stored().spelling.sessions === 0,
    "清空后再保存外观也不回写旧辅助记录");
}

/* ================= 13. raw-only 换代：导入/重置权威，旧辅助记录不能复活 ================= */
console.log("== 13. 显式替换换代与完成页主动同步 ==");
stateEl("#rst").onclick();
const emptyReplacement = clone(stored());
function seedReplacementProbe(hasProgress = false) {
  stateEl("#rst").onclick(); // 真实重置写入另一个代际，确保不是伪造 normalize 后的 S。
  setup({groupSize: 5});
  S().timeSec = 200;
  S().reviewDay = {d: todayStr(), used: 9};
  S().extraDay = {d: todayStr(), extra: 40};
  S().spelling = {sessions: 2, attempts: 2, correct: 1, skipped: 0, lastDay: null, lastSession: null};
  if (hasProgress) T.judge(true);
  T.setGroupSize(5);
}
function installReplacement(value = emptyReplacement) {
  store.set(KEY, JSON.stringify(value));
  store.set("kaoyan_vocab_proficient_v1", JSON.stringify(value.proficient || {}));
}
function receiveReplacement() {
  for (const fn of winHandlers.get("storage") || []) fn({key: KEY});
}
function blankAux() {
  return S().timeSec === 0 && S().reviewDay.used === 0 && S().extraDay.extra === 0 && S().spelling.sessions === 0;
}
{
  const first = stored()._replace;
  ck(typeof first === "string" && first.length > 0, "真实显式重置在主记录原文写入换代 nonce");
  T.setGroupSize(6);
  ck(stored()._replace === first, "普通设置保存携带同一 nonce，不制造换代");
  ck(!Object.hasOwn(S(), "_replace") && !Object.hasOwn(T.normalizeState(stored(), "kaoyan"), "_replace"),
    "raw-only 元数据不进入 S 或 normalize 白名单");
  ck(!Object.hasOwn(T.buildExport().books.kaoyan, "_replace"), "换代 nonce 不进入备份 v3");
  stateEl("#rst").onclick();
  ck(stored()._replace !== first, "同一毫秒内再次重置也生成不同 nonce");
}
for (const hadProgress of [false, true]) {
  seedReplacementProbe(hadProgress);
  installReplacement(); receiveReplacement();
  ck(blankAux() && Object.keys(S().progress).length === 0, "显式重置事件权威清除全部辅助累计（原有主进度=" + hadProgress + "）");
  T.setGroupSize(5);
  ck(stored().timeSec === 0 && stored().reviewDay.used === 0 && stored().extraDay.extra === 0 && stored().spelling.sessions === 0,
    "重置同步后普通保存不复活旧辅助累计（原有主进度=" + hadProgress + "）");
  ck(stored()._replace === emptyReplacement._replace, "重置同步后的普通保存保留远端代际");
}
for (const hadProgress of [false, true]) {
  seedReplacementProbe(hadProgress);
  installReplacement();
  T.setGroupSize(7); // storage 事件尚未送达，save 必须先识别替换。
  ck(blankAux() && Object.keys(S().progress).length === 0, "延迟事件后的 save 不跨代合并旧辅助累计（原有主进度=" + hadProgress + "）");
  ck(stored()._replace === emptyReplacement._replace && stored().extraDay.extra === 0,
    "延迟 save 采用权威原文，不覆盖重置记录");
}
{
  seedReplacementProbe();
  const smaller = clone(emptyReplacement);
  smaller.timeSec = 7; smaller.reviewDay.used = 2; smaller.extraDay.extra = 3;
  smaller.spelling = {sessions: 1, attempts: 1, correct: 1, skipped: 0, lastDay: null, lastSession: null};
  installReplacement(smaller); receiveReplacement();
  ck(S().timeSec === 7 && S().reviewDay.used === 2 && S().extraDay.extra === 3 && S().spelling.sessions === 1,
    "同学习内容但较小辅助累计的换代导入仍按整份替换，不取大");
}
{
  seedReplacementProbe();
  const word = T.cur, w = T.getW()[word].w;
  failKeys.add("kaoyan_vocab_proficient_v1");
  T.setProficient(word, true);
  failKeys.delete("kaoyan_vocab_proficient_v1");
  ck(!!S().proficient[w], "熟练写入失败时本页保留待写操作");
  installReplacement();
  T.setGroupSize(5);
  ck(!S().proficient[w] && !JSON.parse(store.get("kaoyan_vocab_proficient_v1"))[w],
    "延迟重置必须先于熟练键写入裁决，旧 pending 熟练不能复活");
}
{
  seedReplacementProbe();
  const study = window.__vocabStudy;
  study.tick(); study.act(); advance(2000); study.tick();
  ck(study.getDebug().pendingMs >= 1000, "计时换代探针确实有未落盘时长");
  installReplacement(); const raw = store.get(KEY);
  ck(study.flush() === false && store.get(KEY) === raw, "计时先识别远端换代并拒绝写回旧 S");
  receiveReplacement();
  ck(blankAux() && study.getDebug().pendingMs === 0, "换代事件丢弃重置前待计时长");
}
{
  seedReplacementProbe();
  const before = stored()._replace;
  const backup = T.buildExport();
  backup.books.kaoyan.timeSec = 7;
  T.importState(backup);
  ck(stored()._replace !== before && S().timeSec === 7, "真实当前书导入生成新代际并使用备份时长");
  ck(!Object.hasOwn(S(), "_replace") && !Object.hasOwn(T.buildExport().books.kaoyan, "_replace"),
    "导入后的代际仍只在主记录原文，不污染内存与备份");
  const nextBackup = T.buildExport(), otherBefore = store.get(BOOK_KEYS.cet4);
  nextBackup.books.cet4.timeSec = 12;
  T.importState(nextBackup);
  const otherAfter = JSON.parse(store.get(BOOK_KEYS.cet4));
  ck(typeof otherAfter._replace === "string" && otherAfter.timeSec === 12
    && otherAfter._replace !== (otherBefore ? JSON.parse(otherBefore)._replace : undefined),
    "非当前书导入 writeBookState 同样生成新代际");
}
{
  seedReplacementProbe();
  const baseline = clone(stored()), before = baseline._replace;
  failKeys.add(KEY);
  stateEl("#rst").onclick();
  failKeys.delete(KEY);
  ck(blankAux(), "显式重置写入失败后仍保留本页空白替换意图");
  const remote = clone(baseline); remote.settings.theme = "dark";
  store.set(KEY, JSON.stringify(remote));
  receiveReplacement();
  ck(blankAux(), "旧一代设置事件不覆盖待提交的失败重置");
  T.setGroupSize(5);
  ck(blankAux() && stored()._replace !== before && stored().extraDay.extra === 0 && stored().spelling.sessions === 0,
    "失败重置恢复写入后按替换重试，不把旧代时长/台账/加量/专项合回");
}
{
  seedReplacementProbe();
  const word = T.cur, w = T.getW()[word].w;
  T.setProficient(word, true);
  failKeys.add("kaoyan_vocab_proficient_v1");
  stateEl("#rst").onclick();
  failKeys.delete("kaoyan_vocab_proficient_v1");
  T.setGroupSize(5);
  ck(!S().proficient[w] && !JSON.parse(store.get("kaoyan_vocab_proficient_v1"))[w],
    "失败重置重试不读取旧熟练键复活已清空熟练名单");
}
{
  seedReplacementProbe();
  const before = store.get(KEY), beforeMemory = clone(S());
  const backup = T.buildExport(); backup.books.kaoyan.timeSec = 7;
  const write = localStorage.setItem;
  let failedOnce = false, rolledBack = false;
  localStorage.setItem = (key, value) => {
    if (key === KEY && !failedOnce) { failedOnce = true; throw new Error("quota-once"); }
    return write(key, value);
  };
  try { T.importState(backup); }
  catch (error) { rolledBack = /已回滚/.test(error.message); }
  finally { localStorage.setItem = write; }
  ck(rolledBack && store.get(KEY) === before && eq(S(), beforeMemory), "失败导入回滚主记录原文与内存，保留原代际");
  T.setGroupSize(5);
  ck(stored()._replace === JSON.parse(before)._replace, "导入回滚后普通保存不残留失败导入的换代 nonce");
}
{
  seedReplacementProbe(true); answerAllKnown();
  ck(T.cur == null && T.answered > 0, "完成页主动同步探针保留真实上一组撤销现场");
  installReplacement();
  ck(T.refreshSharedBeforeNextGroup() === true && blankAux(), "完成页主动读取尚未送达的远端重置");
  ck(T.answered === 0 && T.getGroupTotal() === 0 && T.Q.length === 0 && !T.getPlan(),
    "换代后旧完成组指标/冻结计划安全失效，不自动空开组");
  const disk = store.get(KEY); T.undo();
  ck(store.get(KEY) === disk && Object.keys(S().progress).length === 0, "旧完成组撤销不能污染新代主记录");
  ck(T.returnToPreviousResults() === false, "换代后不能返回上一代完成页");
}
{
  stateEl("#rst").onclick(); setup({groupSize: 5}); answerAllKnown();
  T.setGroupSize(5);
  const incoming = clone(stored()), word = 0;
  incoming.progress[word] = [1, now + 86400000, 1, 0, now];
  incoming.days[todayStr()] = {n: 1, r: 1, ok: 1, no: 0};
  store.set(KEY, JSON.stringify(incoming));
  ck(T.refreshSharedBeforeNextGroup() === true && !!S().progress[word],
    "完成页开组前同代真实主学习推进也从最新存储同步");
  const before = clone(S()), raw = store.get(KEY);
  store.set(KEY, "{broken");
  ck(T.refreshSharedBeforeNextGroup() === false && eq(S(), before), "坏存储拒绝下一组前同步并完整保留本页状态");
  store.set(KEY, raw);
}

/* ================= 14. M02 曲线/重学间隔统一待生效差异 ================= */
console.log("== 14. 曲线与不会后重学间隔的待生效提示 ==");
{
  setup({groupSize: 5}); T.applyStagePreset("balanced"); T.startSession(); T.show("set");
  T.judge(true);
  const before = groupSig(), frozen = clone(plan()), word = T.cur;
  const dueBefore = S().progress[word][1];
  T.setStageMinutes(0, 720);
  ck(T.hasPendingScopeSettings(), "只改单档曲线也标记设置待应用");
  ck(eqGroup(groupSig(), before) && eq(plan(), frozen) && T.phase === "revealed",
    "改单档保留当前队列、揭示判定、分母和完整冻结计划");
  ck(S().progress[word][1] === dueBefore && plan().scopeSig === frozen.scopeSig,
    "改单档不追溯到期时间，不扩展或改写scopeSig");
  const current = stateEl("#settingsCurrentGroup").innerHTML;
  const next = stateEl("#settingsNextPreview").innerHTML;
  ck(/下一组生效/.test(current) && /复习曲线/.test(current) && /均衡/.test(current)
    && /自定义/.test(current) && /1 档/.test(current),
    "设置页显示本组到下组曲线名及变更档数", current);
  ck(/自定义/.test(next) && /不会后重学/.test(next), "下一组预览包含已保存的曲线与重学间隔", next);
  ck(!stateEl("#applySettingsRestart").hidden && !stateEl("#applySettingsRestart").disabled,
    "只改曲线也出现可用的显式重开入口");
  ck(!stateEl("#planPendingNotice").hidden && /复习曲线/.test(stateEl("#planPendingText").innerHTML),
    "学习页提示同步说明曲线待应用");
  T.setStageMinutes(0, 1440);
  ck(settings().stagePreset === "custom" && !T.hasPendingScopeSettings(),
    "改回本组参数即清pending，纯预设名称差异不算待应用");
  ck(stateEl("#planPendingNotice").hidden && stateEl("#applySettingsRestart").hidden
    && /与当前设置一致/.test(stateEl("#settingsCurrentGroup").innerHTML),
    "改回本组值后统一提示与重开入口清除");
  T.setStageMinutes(4, 11 * 1440);
  ck(T.hasPendingScopeSettings(), "首末档不变、只改中间第5档也能识别");
  T.setStageMinutes(4, 10 * 1440);
  T.undo();
  ck(T.verdict === null && T.answered === 0 && !S().progress[word], "曲线编辑后原组判定仍可完整撤销");
}
{
  setup({groupSize: 5}); T.applyStagePreset("balanced"); T.startSession(); T.show("study");
  const frozen = clone(plan()), before = groupSig();
  T.setRelearnMinutes(2880);
  ck(T.hasPendingScopeSettings() && eqGroup(groupSig(), before) && eq(plan(), frozen),
    "只改不会后重学间隔标记pending且保留本组现场");
  const hint = stateEl("#planPendingText").innerHTML;
  ck(!stateEl("#planPendingNotice").hidden && /不会后重学/.test(hint)
    && /1 天/.test(hint) && /2 天/.test(hint), "学习页准确显示重学间隔旧值到新值", hint);
  ck(/不会后重学/.test(stateEl("#settingsCurrentGroup").innerHTML)
    && /2 天/.test(stateEl("#settingsCurrentGroup").innerHTML), "设置页同步显示只改重学间隔的差异");
  ck(typeof stateEl("#planPendingApply").onclick === "function", "只改重学间隔也绑定学习页重开动作");
  ck(/自定义/.test(stateEl("#settingsNextPreview").innerHTML),
    "仅重学间隔自定义时摘要与复习节奏区按同一实际参数识别名称");
  stateEl("#planPendingApply").onclick?.();
  ck(!T.hasPendingScopeSettings() && plan().relearnMs === 2880 * 60000
    && stateEl("#planPendingNotice").hidden, "显式重开采用新重学间隔并清pending");
  T.setFontSize("large"); T.setReviewCap(77);
  ck(!T.hasPendingScopeSettings(), "即时字号和复习上限不参与冻结设置差异");
  T.setFontSize("standard");
}
{
  setup({groupSize: 5}); T.applyStagePreset("balanced"); T.startSession(); T.show("study");
  T.judge(true);
  const before = groupSig(), frozen = clone(plan()), word = T.cur;
  const legacy = T.getStagePresets().legacy;
  receiveStoredSettings({stages: legacy.stages, relearn: legacy.relearn, stagePreset: "legacy"});
  ck(T.hasPendingScopeSettings() && eqGroup(groupSig(), before) && eq(plan(), frozen),
    "跨标签只改曲线/重学间隔保留本组并标记待应用");
  ck(/旧版密集/.test(stateEl("#settingsCurrentGroup").innerHTML)
    && /不会后重学/.test(stateEl("#planPendingText").innerHTML), "跨标签差异同步到设置页和学习页");
  T.undo();
  ck(!S().progress[word] && T.answered === 0, "跨标签仅曲线变化后原判定仍可撤销");
}
{
  setup({groupSize: 5}); T.applyStagePreset("balanced"); T.startSession(); T.show("study");
  T.judge(true);
  const before = groupSig(), frozen = clone(plan());
  const snapshotKey = T.getSessionSnapshotKey();
  const oldSnapshot = store.get(snapshotKey);
  ck(JSON.parse(JSON.parse(oldSnapshot).scopeSig).length === 10, "恢复回归使用原10字段scopeSig快照");
  T.setStageMinutes(0, 720); T.setRelearnMinutes(2880);
  ck(store.get(snapshotKey) === oldSnapshot && T.getSessionSnapshotState().valid,
    "保存曲线不改旧快照，其与新设置不同仍有效");
  const reloaded = T.simulateReload();
  ck(reloaded.mode === "restored" && eqGroup(groupSig(), before) && eq(plan(), frozen),
    "旧scopeSig快照刷新后恢复原冻结曲线和已揭示现场");
  ck(T.hasPendingScopeSettings() && !stateEl("#planPendingNotice").hidden
    && /下一组生效/.test(stateEl("#planPendingText").innerHTML), "刷新恢复后仍显示曲线待应用");
  T.show("set");
  ck(!stateEl("#applySettingsRestart").hidden && /不会后重学/.test(stateEl("#settingsCurrentGroup").innerHTML),
    "刷新后设置页仍可查看差异并显式重开");
}
{
  setup({groupSize: 5}); T.applyStagePreset("balanced"); T.startSession(); T.show("study");
  T.judge(false); T.tryNext(); T.startDrill();
  const before = groupSig(), frozen = clone(plan());
  T.setRelearnMinutes(2880);
  ck(T.drillMode && T.hasPendingScopeSettings() && eqGroup(groupSig(), before) && eq(plan(), frozen),
    "特训内只改曲线设置保留特训与冻结父组");
  ck(stateEl("#planPendingNotice").hidden && stateEl("#applySettingsRestart").hidden
    && T.applySettingsRestart() === false, "特训内曲线差异不抢学习页、不可显式重开父组");
  T.exitDrill();
  ck(T.hasPendingScopeSettings() && !stateEl("#planPendingNotice").hidden,
    "退出特训后父组继续显示重学间隔待应用");
  T.setRelearnMinutes(1440); answerAllKnown(); T.grantExtraNew(10);
  ck(T.startExtraSubgroup(), "曲线隔离回归进入额外新词子组");
  const sub = groupSig(), subPlan = clone(plan());
  T.setStageMinutes(0, 720);
  ck(T.isExtraSubgroup() && T.hasPendingScopeSettings() && eqGroup(groupSig(), sub) && eq(plan(), subPlan),
    "子组内曲线变化与父组比较，不重建当前子组");
  ck(stateEl("#applySettingsRestart").hidden && T.applySettingsRestart() === false,
    "子组内曲线变化也不能重开父组");
  T.endExtraSubgroup();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
