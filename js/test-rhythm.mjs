/**
 * 19 自定义十档复习时间与预设（回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据 + 受控时钟），不复制业务逻辑。
 * 运行：node --max-old-space-size=512 js/test-rhythm.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const CET4_KEY = "cet4_vocab_v1";
const APP_ID = "kaoyan-vocab";
const MIN_MS = 60 * 1000;
const DAY = 1440;

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

/* ---------------- 受控时钟 ---------------- */
let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
const RealDate = Date;
class ClockDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = ClockDate;
const advance = (ms) => { now += ms; };
const todayStr = (t = now) => {
  const d = new RealDate(t);
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
    textContent: "", hidden: false, disabled: false, files: [], scrollTop: 0,
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
    appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
    remove() {},
    _attrs: {},
    setAttribute(k, v) {
      el._attrs[k] = String(v);
      if (k.startsWith("data-")) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
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
    closest(selector) {
      let node = el;
      while (node) {
        if (matchSelector(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 10, top: 10, right: 250, bottom: 130, width: 240, height: 120 }; },
    focus() { document.activeElement = el; },
    blur() {},
    click() { fireClick(el); }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._h; },
    set(v) { el._h = String(v); }
  });
  return el;
}
/** 通用事件派发：自身 handler + 沿 parentNode 冒泡监听（供 change/input 委托测试）。 */
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

/* ---------------- 数据与 app.js ---------------- */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const registry = new Map();
function ensureEl(sel) {
  if (!registry.has(sel)) registry.set(sel, mkEl(sel.includes("input") ? "input" : sel.includes("button") ? "button" : "div"));
  return registry.get(sel);
}

// 复习节奏设置区节点（ui-shell 静态 HTML；app-core 接线）。桩不能解析 innerHTML，
// 因此为「静态渲染」路径提供稳定节点；若实现改为动态生成，测试会在对应断言处显式失败。
const rhythmPresetButtons = ["balanced", "light", "intense", "legacy"].map(name => {
  const b = mkEl("button");
  b.setAttribute("data-preset", name);
  b.dataset.preset = name;
  b.setAttribute("aria-pressed", name === "balanced" ? "true" : "false");
  return b;
});
const rhythmResetButton = mkEl("button");
Object.defineProperty(rhythmResetButton, "dataset", { value: { rhythmReset: "" }, writable: false });
const rhythmStageInputs = Array.from({ length: 10 }, (_, i) => {
  const inp = mkEl("input");
  inp.setAttribute("data-stage-index", String(i));
  return inp;
});
const rhythmStageUnits = Array.from({ length: 10 }, (_, i) => {
  const sel = mkEl("select");
  sel.setAttribute("data-stage-unit-select", String(i));
  return sel;
});
const rhythmRelearnInput = mkEl("input");
const rhythmRelearnUnit = mkEl("select");
const rhythmRelearnContainer = mkEl("div");
rhythmRelearnContainer.appendChild(rhythmRelearnInput);
rhythmRelearnContainer.appendChild(rhythmRelearnUnit);
const rhythmContainer = mkEl("div");
const rhythmStagesContainer = mkEl("div");
const rhythmPresetsContainer = mkEl("div");
globalThis.document = {
  querySelector: (s) => {
    if (s === "#rhythmPresets") return rhythmPresetsContainer;
    if (s === "#rhythmStages") return rhythmStagesContainer;
    if (s === "#rhythmRelearn") return rhythmRelearnContainer;
    if (s === "#rhythmRelearn [data-relearn]") return rhythmRelearnInput;
    if (s === "#rhythmRelearn [data-relearn-unit]") return rhythmRelearnUnit;
    const stagePick = s.match(/^#rhythmStages \[data-stage-index="(\d+)"\]$/);
    if (stagePick) return rhythmStageInputs[Number(stagePick[1])] || null;
    return ensureEl(s);
  },
  querySelectorAll: (s) => {
    if (s === "[data-preset]" || s === "#rhythmPresets [data-preset]" || s === "#rhythmPresets button") return rhythmPresetButtons;
    if (s === "[data-rhythm-reset]") return [rhythmResetButton];
    if (s === "#rhythmStages [data-stage-index]" || s === "[data-stage-index]") return rhythmStageInputs;
    if (s === "#rhythmStages [data-stage-unit-select]" || s === "[data-stage-unit-select]") return rhythmStageUnits;
    if (s === "#rhythmRelearn [data-relearn-unit]" || s === "[data-relearn-unit]") return [rhythmRelearnUnit];
    return [];
  },
  addEventListener() {},
  createElement: (t) => mkEl(t),
  documentElement: { dataset: {}, style: {} },
  visibilityState: "visible",
  activeElement: null
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  innerWidth: 1200, innerHeight: 800,
  requestAnimationFrame: (fn) => { fn(); return 0; },
  cancelAnimationFrame() {}
};
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.setInterval = () => 0;
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.clearInterval = () => {};
globalThis.confirm = () => true;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };
globalThis.performance = { now: () => now };

const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
new Function(wordsJs)();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;
for (const file of ["cet-words-data.js", "combined-words-data.js"]) {
  new Function(fs.readFileSync(path.join(HERE, file), "utf8"))();
}
const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try { new Function(appJs)(); }
catch (e) { console.error("app.js 执行失败:", e.stack || e.message); process.exit(1); }
const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab"); process.exit(1); }
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* ---------------- 契约常量与辅助 ---------------- */
const EXPECT_PRESETS = {
  balanced: { stages: [1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn: 1440 },
  light: { stages: [1440, 4320, 10080, 20160, 30240, 43200, 64800, 86400, 129600, 172800], relearn: 1440 },
  intense: { stages: [30, 240, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400], relearn: 30 },
  legacy: { stages: [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400], relearn: 5 }
};
const clone = v => JSON.parse(JSON.stringify(v));
const setting = () => T.getS().settings;
const stageMsOf = (minutes) => minutes * MIN_MS;
const sumDays = stages => stages.reduce((n, m) => n + m, 0) / DAY;

/** 兼容不同返回形状：优先按实现契约，其次接受等价结构。 */
function presetOf(name) {
  const all = T.getStagePresets();
  let raw = null;
  if (Array.isArray(all)) raw = all.find(x => x && (x.name === name || x.id === name || x.key === name));
  else if (all && typeof all === "object") raw = all[name];
  if (!raw) return null;
  if (Array.isArray(raw)) return { stages: raw, relearn: null };
  const stages = raw.stages || raw.minutes || raw.stageMinutes || raw.stagesMinutes;
  const relearn = raw.relearn !== undefined ? raw.relearn : raw.relearnMinutes;
  return { stages: stages, relearn: relearn };
}
function cycleSummary() {
  const v = T.getCycleSummary();
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (typeof v.summary === "string") return v.summary;
    if (typeof v.days === "number") return v.days + " 天";
  }
  return String(v);
}
function summaryDays() {
  const m = cycleSummary().match(/(\d+(?:\.\d+)?)\s*天/);
  return m ? Number(m[1]) : null;
}
function totalScope() {
  const s = setting();
  Object.assign(s, { fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], posMode: "primary", order: "freq", dailyNew: 20 });
  T.getS().progress = {}; T.getS().days = {}; T.getS().stars = {}; T.getS().proficient = {};
  T.startSession();
}
/** 把某词推进到指定目标前：逐次「会」直到 stage 达到 target（每步前清 verdict）。 */
function knowTo(i, target) {
  for (let k = 0; k < 20; k++) {
    const p = T.getS().progress[i];
    if (p && p[0] >= target) break;
    T.setCur(i); T.setVerdict(null);
    T.judge(true);
  }
  return T.getS().progress[i];
}
/** 找范围内、未熟练、且尚未有主学习进度的词（用于新配置下的首次判定）。 */
function unlearnedIndex() {
  const W = T.getW(), S = T.getS();
  for (let i = 0; i < W.length; i++) {
    if (!T.inScope(i) || T.isProficient(i)) continue;
    if (!T.hasMainProgress(S.progress[i])) return i;
  }
  return -1;
}
/** 找一个可用来判定的词（范围内、未熟练）。 */
function freshWordIndex() {
  const W = T.getW();
  for (let i = 0; i < W.length; i++) if (T.inScope(i) && !T.isProficient(i)) return i;
  return -1;
}

/* ---------------- 0. 钩子与默认值 ---------------- */
console.log("== 0. 契约钩子与新用户默认（balanced） ==");
{
  for (const name of ["getStages", "getRelearn", "getStagePresets", "getCycleSummary",
    "applyStagePreset", "setStageMinutes", "setRelearnMinutes", "normalizeStageConfig"]) {
    ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  }
  ck(typeof T.stageLabel === "function", "导出 stageLabel（档位文案随曲线动态）");
  const fresh = Array.isArray(T.getStages()) ? T.getStages() : [];
  ck(fresh.length === 10 && fresh.every(Number.isInteger),
    "全新记录 default stages 为 10 个分钟整数", JSON.stringify(fresh));
  ck(JSON.stringify(fresh) === JSON.stringify(EXPECT_PRESETS.balanced.stages),
    "新用户默认 = balanced（1/2/4/7/10/15/21/30/45/60 天，分钟整数）", JSON.stringify(fresh));
  ck(T.getRelearn() === EXPECT_PRESETS.balanced.relearn,
    "新用户 relearn=1440 分钟（1 天）", String(T.getRelearn()));
  ck(setting().stagePreset === "balanced", "新用户 stagePreset=balanced", String(setting().stagePreset));
}

/* ---------------- 1. 四预设逐项一致 / 应用与保存 ---------------- */
console.log("== 1. 预设值与 applyStagePreset ==");
{
  const presets = T.getStagePresets();
  ck(presets && typeof presets === "object", "getStagePresets 返回可枚举结构");
  const expectedLabels = { balanced: "均衡", light: "轻负荷", intense: "短期强化", legacy: "旧版密集" };
  for (const name of Object.keys(expectedLabels)) {
    ck(presets[name] && presets[name].label === expectedLabels[name],
      `预设 ${name} 展示名「${expectedLabels[name]}」`, presets[name] && presets[name].label);
  }
  // getStages 返回副本：外部修改不得影响内部配置。
  T.applyStagePreset("balanced");
  const copyProbe = T.getStages();
  copyProbe[0] = 999999;
  ck(T.getStages()[0] === EXPECT_PRESETS.balanced.stages[0], "getStages 返回副本，改外部数组不影响内部配置");
  for (const name of Object.keys(EXPECT_PRESETS)) {
    const got = presetOf(name);
    ck(!!got, `预设 ${name} 存在`);
    if (!got) continue;
    const expectStages = EXPECT_PRESETS[name].stages;
    ck(JSON.stringify(got.stages) === JSON.stringify(expectStages),
      `预设 ${name} 十档分钟值与设计文档 §1.1 完全一致`,
      JSON.stringify(got.stages));
    ck(got.relearn === EXPECT_PRESETS[name].relearn,
      `预设 ${name} relearn=${EXPECT_PRESETS[name].relearn} 分钟`, String(got.relearn));
  }
  // balanced 预计完整周期 = 195 天 = 280800 分钟。
  T.applyStagePreset("balanced");
  const cs = T.getCycleSummary();
  ck(cs && cs.minutes === 280800, "balanced 周期摘要 minutes=280800", JSON.stringify(cs));
  ck(summaryDays() !== null && Math.abs(summaryDays() - 195) <= 1,
    "balanced 周期摘要 ≈ 195 天（十档之和）", cycleSummary());
  ck(cs && cs.text === "约 195 天", "balanced 摘要文本为「约 195 天」", cs && cs.text);
  // legacy = 172115 分钟 → 「约 120 天」（119.52 四舍五入）。
  T.applyStagePreset("legacy");
  const legacyCs = T.getCycleSummary();
  ck(legacyCs && legacyCs.minutes === 172115, "legacy 周期摘要 minutes=172115", JSON.stringify(legacyCs));
  ck(summaryDays() !== null && Math.abs(summaryDays() - 120) <= 1,
    "legacy 周期摘要 ≈ 120 天（十档之和）", cycleSummary());
  ck(legacyCs && legacyCs.text === "约 120 天", "legacy 摘要文本为「约 120 天」", legacyCs && legacyCs.text);
  const legacySummary = cycleSummary();

  // apply 后状态与磁盘同步
  T.applyStagePreset("light");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.light.stages),
    "applyStagePreset(light) 后 getStages 更新");
  ck(T.getRelearn() === EXPECT_PRESETS.light.relearn, "applyStagePreset(light) 后 getRelearn 更新");
  ck(setting().stagePreset === "light", "applyStagePreset(light) 后 stagePreset=light");
  const saved = store.has(KEY) ? JSON.parse(store.get(KEY)) : null;
  ck(saved && JSON.stringify(saved.settings.stages) === JSON.stringify(EXPECT_PRESETS.light.stages)
    && saved.settings.relearn === EXPECT_PRESETS.light.relearn,
    "applyStagePreset 已写入当前书 state（localStorage）");
  ck(cycleSummary() !== legacySummary, "周期摘要随曲线变化", `${legacySummary} → ${cycleSummary()}`);

  // 四个预设逐个应用：state、钩子与 localStorage 同步。
  for (const name of Object.keys(EXPECT_PRESETS)) {
    const r = T.applyStagePreset(name);
    ck(r && r.ok === true && r.preset === name, `应用预设 ${name} 返回 ok + preset`);
    ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS[name].stages)
      && T.getRelearn() === EXPECT_PRESETS[name].relearn
      && setting().stagePreset === name,
      `应用预设 ${name} 后 getStages/getRelearn/stagePreset 同步`);
    const raw = store.has(KEY) ? JSON.parse(store.get(KEY)) : null;
    ck(raw && JSON.stringify(raw.settings.stages) === JSON.stringify(EXPECT_PRESETS[name].stages)
      && raw.settings.relearn === EXPECT_PRESETS[name].relearn
      && raw.settings.stagePreset === name,
      `应用预设 ${name} 已保存到当前书 state`);
  }
  T.applyStagePreset("light");

  // 自定义编辑：stagePreset 变 custom；与预设不匹配时不得假装预设。
  const edited = EXPECT_PRESETS.light.stages.slice();
  edited[0] = 2000;
  const ok = T.setStageMinutes(0, 2000);
  ck(ok && ok.ok === true && JSON.stringify(ok.stages) === JSON.stringify(edited)
    && ok.preset === "custom", "setStageMinutes 返回 {ok:true, stages, relearn, preset:\"custom\"}",
    JSON.stringify(ok));
  ck(T.getStages()[0] === 2000, "setStageMinutes 更新第 1 档", String(T.getStages()[0]));
  ck(setting().stagePreset === "custom", "自定义编辑后 stagePreset=custom", String(setting().stagePreset));
  const rl = T.setRelearnMinutes(2880);
  ck(rl && rl.ok === true && rl.relearn === 2880 && rl.preset === "custom",
    "setRelearnMinutes 返回 {ok:true, relearn:2880, preset:\"custom\"}", JSON.stringify(rl));
  ck(T.getRelearn() === 2880, "setRelearnMinutes 更新值为 2880", String(T.getRelearn()));
  const appliedLight = T.applyStagePreset("light");
  ck(appliedLight && appliedLight.ok === true && appliedLight.preset === "light"
    && JSON.stringify(appliedLight.stages) === JSON.stringify(EXPECT_PRESETS.light.stages),
    "applyStagePreset(light) 返回 {ok:true, stages, relearn, preset:\"light\"}", JSON.stringify(appliedLight));
  const appliedBad = T.applyStagePreset("nonsense");
  ck(appliedBad && appliedBad.ok === false && appliedBad.error && appliedBad.error.index === -1,
    "applyStagePreset(非法名) 返回 ok:false + error.index=-1", JSON.stringify(appliedBad));
  T.applyStagePreset("balanced");
}

/* ---------------- 2. 旧记录 = legacy 分支 ---------------- */
console.log("== 2. 新用户 balanced vs 旧记录 legacy ==");
{
  const legacyState = T.normalizeState({
    settings: { dailyNew: 7, order: "freq", fmin: 3 },
    progress: { 0: [1, now + 1000, 1, 0, now] },
    days: {}, stars: {}, proficient: {}
  });
  ck(JSON.stringify(legacyState.settings.stages) === JSON.stringify(EXPECT_PRESETS.legacy.stages),
    "旧记录缺 stages → legacy 密集曲线（5/30/720/…分钟）",
    JSON.stringify(legacyState.settings.stages));
  ck(legacyState.settings.relearn === 5, "旧记录缺 relearn → 5 分钟", String(legacyState.settings.relearn));
  ck(legacyState.settings.stagePreset === "legacy", "旧记录 stagePreset=legacy", String(legacyState.settings.stagePreset));
  ck(legacyState.settings.dailyNew === 7 && legacyState.settings.order === "freq" && legacyState.settings.fmin === 3,
    "旧记录其他设置不丢", JSON.stringify([legacyState.settings.dailyNew, legacyState.settings.order, legacyState.settings.fmin]));
  ck(Array.isArray(legacyState.progress[0]) && legacyState.progress[0][0] === 1,
    "旧记录进度保留");
  ck(legacyState.progress[0][1] === now + 1000,
    "旧记录已有到期时间原样保留（迁移不重排 p[1]）", String(legacyState.progress[0][1]));
  // 显式空设置对象（已有记录）也走 legacy，而不是被当成新用户 balanced。
  const explicitOld = T.normalizeState({ settings: {}, progress: {}, days: {} });
  ck(JSON.stringify(explicitOld.settings.stages) === JSON.stringify(EXPECT_PRESETS.legacy.stages),
    "已有记录但 settings 为空：仍按旧记录 legacy，不套用新用户 balanced");
  // normalizeState 只用于「已有记录」：无 settings 字段的记录同样按旧记录兼容 → legacy。
  const bareOld = T.normalizeState({ progress: {}, days: {} });
  ck(JSON.stringify(bareOld.settings.stages) === JSON.stringify(EXPECT_PRESETS.legacy.stages),
    "无 settings 字段的已有记录也按旧记录兼容 → legacy（不误套新用户 balanced）");
  // 真正的新用户由 freshState/DEF 提供：直接读取当前全新 boot 状态。
  ck(JSON.stringify(setting().stages) !== null, "DEF/freshState 提供新用户默认曲线（已在第 0 节断言 balanced）");
}

/* ---------------- 3. 校验：整组回退 + 可定位错误 ---------------- */
console.log("== 3. 配置校验与整组回退 ==");
{
  T.applyStagePreset("balanced");
  const good = T.getStages().slice();
  const relearn = T.getRelearn();
  const cases = [
    [[1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800], relearn, -1, "长度≠10（结构错误 index=-1）"],
    [[1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400, 99999], relearn, -1, "长度=11（结构错误 index=-1）"],
    [[1440, 1440, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn, 1, "不严格递增（重复在第 2 档）"],
    [[1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 10000], relearn, 9, "第 10 档小于第 9 档"],
    [[1440, 2880, 5760, 43200, 10080, 21600, 30240, 43200, 64800, 86400], relearn, 4, "第 5 档小于第 4 档"],
    [[0, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn, 0, "第 1 档 0 分钟"],
    [[-1, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn, 0, "第 1 档负数"],
    [[1440.5, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], relearn, 0, "第 1 档非整数"],
    [[525601, 525602, 525603, 525604, 525605, 525606, 525607, 525608, 525609, 525610], relearn, 0, "第 1 档超过 365 天"],
    [[1440, 2880, 5760, 10080, 14400, 21600, 30240, 43200, 64800, 86400], 0, -1, "relearn=0（index=-1）"]
  ];
  for (const [stages, rel, label] of [
    [null, relearn, "stages=null"],
    [undefined, relearn, "stages=undefined"],
    [{}, relearn, "stages=对象不是数组"]
  ]) {
    const res = T.normalizeStageConfig(stages, rel);
    ck(res && res.ok === false && res.stages === null && res.error && res.error.index === -1,
      `非法配置「${label}」整组拒绝且 index=-1`, JSON.stringify(res));
  }
  for (const [stages, rel, expectIndex, label] of cases) {
    let res = null, err = null;
    try { res = T.normalizeStageConfig(stages, rel); } catch (e) { err = e; }
    ck(!err, `非法配置「${label}」不抛异常`, err && err.message);
    ck(res && res.ok === false, `非法配置「${label}」被整组拒绝`, JSON.stringify(res));
    ck(res && res.stages === null && res.relearn === null,
      `非法配置「${label}」返回 stages=null/relearn=null`, JSON.stringify(res));
    ck(res && res.error && typeof res.error.message === "string" && res.error.message.length > 0,
      `非法配置「${label}」返回可展示错误信息`, JSON.stringify(res && res.error));
    ck(res && res.error && res.error.index === expectIndex,
      `非法配置「${label}」错误定位到 ${expectIndex}`, JSON.stringify(res && res.error));
    ck(JSON.stringify(T.getStages()) === JSON.stringify(good)
      && T.getRelearn() === relearn,
      `非法配置「${label}」不改变现有曲线（整组回退）`);
  }
  // setStageMinutes 非法输入：保留原配置并返回错误。
  const before = T.getStages().slice();
  let badResult = null, badErr = null;
  try { badResult = T.setStageMinutes(4, 1); } catch (e) { badErr = e; }
  ck(!badErr, "setStageMinutes 非法值不抛异常");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(before), "setStageMinutes 非法值整组保留原配置");
  ck(badResult && badResult.ok === false && badResult.error && badResult.error.index === 4,
    "setStageMinutes 非法值返回 ok:false + 定位到第 5 档", JSON.stringify(badResult));
  // 合法编辑仍可用。
  T.setStageMinutes(0, 1500);
  ck(T.getStages()[0] === 1500, "合法 setStageMinutes 生效");
  T.applyStagePreset("balanced");
}

/* ---------------- 4. 单位/边界 ---------------- */
console.log("== 4. 单位换算与边界（1 分钟 / 365 天） ==");
{
  T.applyStagePreset("balanced");
  // 边界：1 分钟与 525600 分钟可保存（用末尾档逐个上调，保证严格递增）。
  const edges = EXPECT_PRESETS.balanced.stages.slice();
  edges[0] = 1;
  const okMin = T.normalizeStageConfig(edges, 1);
  ck(okMin && okMin.ok === true && okMin.stages[0] === 1 && okMin.relearn === 1,
    "边界：第 1 档 1 分钟、relearn 1 分钟可保存", JSON.stringify(okMin));
  const edgesMax = EXPECT_PRESETS.balanced.stages.slice();
  for (let i = 9; i >= 1; i--) edgesMax[i] = 525600 - (9 - i);
  // 第 10 档 = 525600，前 9 档递增且小于 525600。
  ck(edgesMax[9] === 525600 && edgesMax[8] < edgesMax[9],
    "构造 365 天上界合法曲线", JSON.stringify(edgesMax));
  const okMax = T.normalizeStageConfig(edgesMax, 525600);
  ck(okMax && okMax.ok === true && okMax.stages[9] === 525600 && okMax.relearn === 525600,
    "边界：525600 分钟（365 天）可保存", JSON.stringify(okMax));
  const badRelearn = T.normalizeStageConfig(edgesMax, 525601);
  ck(badRelearn.ok === false && badRelearn.error.index === -1
    && typeof badRelearn.error.message === "string", "边界：relearn 525601 拒绝且 index=-1");
  const eg = edgesMax.slice(); eg[9] = 525601;
  ck(T.normalizeStageConfig(eg, 1440).ok === false, "边界：单档 525601 拒绝");
  // 应用边界值到真实设置（合法）；落库均为整数分钟。
  // 边界值通过正式设置 API 落库。
  T.applyStagePreset("balanced");
  const edgeMin = T.setStageMinutes(0, 1);
  ck(edgeMin && edgeMin.ok === true && T.getStages()[0] === 1,
    "设置 API：第 1 档 1 分钟可保存", JSON.stringify(edgeMin));
  const edgeMax = T.setStageMinutes(9, 525600);
  ck(edgeMax && edgeMax.ok === true && T.getStages()[9] === 525600,
    "设置 API：第 10 档 525600 分钟（365 天）可保存", JSON.stringify(edgeMax));
  ck(T.setStageMinutes(9, 525601).ok === false && T.getStages()[9] === 525600,
    "设置 API：525601 分钟拒绝且保留原值");
  ck(T.setRelearnMinutes(1).ok === true && T.getRelearn() === 1, "设置 API：relearn 1 分钟可保存");
  ck(T.setRelearnMinutes(0).ok === false && T.getRelearn() === 1, "设置 API：relearn 0 拒绝且保留原值");
  T.applyStagePreset("balanced");
  T.setStageMinutes(0, 120);   // 2 小时
  ck(T.getStages()[0] === 120 && Number.isInteger(T.getStages()[0]), "120 分钟（2 小时）落库为整数 120");
  T.setStageMinutes(0, 1440);
  ck(T.getStages()[0] === 1440, "1440 分钟（1 天）落库为整数 1440");
  T.applyStagePreset("balanced");
  // UI 若提供分钟/小时/天单位控件，则三单位同一时长等价（静态 HTML 与逻辑一致）。
  ck(/id="rhythmStages"/.test(indexHtml) && /id="rhythmRelearn"/.test(indexHtml),
    "页面含十档与「不会后重学间隔」设置容器");
}

/* ---------------- 5. 调度正确性 ---------------- */
console.log("== 5. 调度：会用下一档、不会用 relearn、走满进入已掌握 ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("balanced");
  totalScope();
  const stages = T.getStages(), relearn = T.getRelearn();
  const i = freshWordIndex();
  ck(i >= 0, "存在可判定词");
  T.setCur(i); T.setVerdict(null);
  const t1 = Date.now();
  T.judge(true);
  let p = T.getS().progress[i];
  ck(p[0] === 1, "「会」从新学升到第 1 档", String(p[0]));
  ck(p[1] - t1 === stages[0] * MIN_MS,
    "第 1 档下次复习间隔 = balanced 首档 1 天（精确毫秒）",
    `${p[1] - t1} vs ${stages[0] * MIN_MS}`);
  const firstDue = p[1];
  T.setVerdict(null);
  T.judge(true);
  p = T.getS().progress[i];
  ck(p[0] === 2 && p[1] - now === stages[1] * MIN_MS,
    "再「会」升到第 2 档，间隔 = 2 天", `${p[0]} / ${p[1] - now}`);
  // 「不会」：归零并按 relearn 排下次复习。
  T.setVerdict(null);
  const tF = Date.now();
  T.judge(false);
  p = T.getS().progress[i];
  ck(p[0] === 0, "「不会」阶段归零", String(p[0]));
  ck(p[1] - tF === relearn * MIN_MS,
    "「不会」用跨组重学间隔 relearn=1 天（不是 5 分钟）", `${p[1] - tF} vs ${relearn * MIN_MS}`);
  ck(p[3] === 1, "「不会」错次 +1");
  // 走满 10 档后再会 → 已掌握，不再安排复习。
  T.getS().progress = {}; T.startSession();
  const j = freshWordIndex();
  const max = knowTo(j, 10);
  ck(max[0] === 10, "第 10 次「会」后 stage=10（第 10 档）", String(max[0]));
  ck(max[1] - now === stages[9] * MIN_MS,
    "第 10 档间隔 = 60 天（精确毫秒，受控时钟 0 误差）", String(max[1] - now));
  T.setCur(j); T.setVerdict(null); T.judge(true);
  const mastered = T.getS().progress[j];
  ck(mastered[0] === 11, "第 11 次「会」后 stage=11（已掌握）", String(mastered[0]));
  ck(T.wordReviewLabel(j).includes("已掌握"), "已掌握词不再安排复习", T.wordReviewLabel(j));
  ck(!T.buildQueue(Date.now()).due.includes(j), "已掌握词不进入到期队列");
}

/* ---------------- 6. 组内冻结 / 不追溯 ---------------- */
console.log("== 6. 组内冻结与不追溯 ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("balanced");
  totalScope();
  const balanced = EXPECT_PRESETS.balanced.stages.map(m => m * MIN_MS);
  ck(typeof T.getPlan === "function", "导出 getPlan（本组冻结快照）");
  const plan = T.getPlan ? T.getPlan() : null;
  ck(plan && JSON.stringify(plan.stagesMs) === JSON.stringify(balanced)
    && plan.relearnMs === EXPECT_PRESETS.balanced.relearn * MIN_MS,
    "开组时 getPlan() 冻结 stagesMs/relearnMs（balanced）", JSON.stringify(plan && plan.stagesMs));
  const i = freshWordIndex();
  T.setCur(i); T.setVerdict(null);
  // 开组时快照 = balanced；中途改为 legacy。
  T.applyStagePreset("legacy");
  const planAfter = T.getPlan ? T.getPlan() : null;
  ck(planAfter && JSON.stringify(planAfter.stagesMs) === JSON.stringify(balanced)
    && planAfter.relearnMs === EXPECT_PRESETS.balanced.relearn * MIN_MS,
    "改设置后当前组 getPlan() 快照不变（不重建）");
  ck(T.hasPendingScopeSettings() && ensureEl("#planPendingNotice").hidden === false,
    "改曲线后统一pending与学习页提示立即同步");
  const rhythmPending = ensureEl("#planPendingText").innerHTML;
  ck(rhythmPending.includes("均衡") && rhythmPending.includes("旧版密集")
    && rhythmPending.includes("不会后重学"), "提示分别呈现本组与下组曲线/重学差异", rhythmPending);
  ck(T.stageLabel(1, planAfter) === "第 1 档 · 1 天",
    "传入本组快照的档位标签仍显示旧曲线（balanced 1 天）", T.stageLabel(1, planAfter));
  ck(T.stageLabel(1) === "第 1 档 · 5 分钟",
    "不传快照时按当前设置显示新曲线（legacy 5 分钟）", T.stageLabel(1));
  const t = Date.now();
  T.judge(true);
  const p = T.getS().progress[i];
  ck(p[1] - t === balanced[0],
    "开组后改设置不改变当前卡判定间隔（使用本组快照 balanced 1 天，不是 legacy 5 分钟）",
    `${p[1] - t} vs ${balanced[0]}`);
  // 当前组后续翻页仍用快照。
  T.tryNext(true);
  const k = T.cur;
  if (k != null) {
    T.setVerdict(null);
    T.judge(true);
    const pk = T.getS().progress[k];
    ck(pk[1] - t === balanced[0], "同组内后续判定仍用开组快照", `${pk[1] - t} vs ${balanced[0]}`);
  }
  // 重新开组后新判定使用新配置 legacy。
  T.startSession();
  const n = unlearnedIndex();
  ck(n >= 0, "新一组存在未学词可判定");
  T.setCur(n); T.setVerdict(null);
  const t2 = Date.now();
  T.judge(true);
  const pn = T.getS().progress[n];
  ck(pn[1] - t2 === EXPECT_PRESETS.legacy.stages[0] * MIN_MS,
    "startSession() 之后的新判定使用新配置 legacy 5 分钟",
    `${pn[1] - t2} vs ${EXPECT_PRESETS.legacy.stages[0] * MIN_MS}`);

  // 不追溯：已有 progress 的 p[1] 在改配置前后逐条不变。
  T.applyStagePreset("balanced");
  totalScope();
  const progressBefore = {};
  for (let x = 0; x < 20; x++) {
    const W = T.getW();
    if (!T.inScope(x)) continue;
    T.getS().progress[x] = [1, now + (x + 1) * DAY * MIN_MS, 1, 0, now];
    progressBefore[x] = now + (x + 1) * DAY * MIN_MS;
  }
  const dueBefore = T.countDue();
  T.applyStagePreset("light");
  T.setStageMinutes(0, 720);
  let changed = 0;
  for (const [x, due] of Object.entries(progressBefore)) {
    if (!T.getS().progress[x] || T.getS().progress[x][1] !== due) changed++;
  }
  ck(changed === 0, "改配置后已有 progress 的 p[1] 逐条不变（不追溯重排）", `changed=${changed}`);
  ck(T.countDue() === dueBefore, "改配置不制造新的立即到期词", `${T.countDue()} vs ${dueBefore}`);
  T.applyStagePreset("balanced");
}

/* ---------------- 7. 已判定后改设置再改判/撤销 ---------------- */
console.log("== 7. 改判与撤销按当时快照 ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("balanced");
  totalScope();
  const i = freshWordIndex();
  T.setCur(i); T.setVerdict(null);
  const t0 = Date.now();
  T.judge(true);
  const snapAfterJudge = clone(T.getS().progress[i]);
  ck(snapAfterJudge[1] - t0 === EXPECT_PRESETS.balanced.stages[0] * MIN_MS, "首判按 balanced 快照写入");
  // 中途换 intense（relearn=30 分钟），快照应仍为 balanced（relearn=1440 分钟）。
  T.applyStagePreset("intense");
  T.judge(false);   // 改判
  const rejudged = clone(T.getS().progress[i]);
  ck(rejudged[0] === 0 && rejudged[1] - now === EXPECT_PRESETS.balanced.relearn * MIN_MS,
    "改判用当时快照的 relearn（balanced 1440 分钟）而不是新配置 intense 的 30 分钟",
    `${rejudged[1] - now} vs ${EXPECT_PRESETS.balanced.relearn * MIN_MS}`);
  T.undo();         // 撤销改判
  ck(T.getS().progress[i] && T.getS().progress[i][1] === snapAfterJudge[1]
    && T.getS().progress[i][0] === snapAfterJudge[0],
    "撤销改判恢复到改判前快照", JSON.stringify(T.getS().progress[i]));
  T.undo();         // 撤销首判
  ck(T.getS().progress[i] === undefined, "撤销首判后回到未学状态", JSON.stringify(T.getS().progress[i]));
  T.applyStagePreset("balanced");
}

/* ---------------- 8. 文案动态 / 无「约 120 天」硬编码 ---------------- */
console.log("== 8. 档位文案与周期文案动态 ==");
{
  T.applyStagePreset("balanced");
  ck(T.stageLabel(0) === "新学", "档位 0 文案为「新学」", T.stageLabel(0));
  ck(T.stageLabel(1) === "第 1 档 · 1 天", "balanced 第 1 档为「第 1 档 · 1 天」", T.stageLabel(1));
  ck(T.stageLabel(2) === "第 2 档 · 2 天", "balanced 第 2 档为「第 2 档 · 2 天」", T.stageLabel(2));
  ck(T.stageLabel(10) === "第 10 档 · 60 天", "balanced 第 10 档为「第 10 档 · 60 天」", T.stageLabel(10));
  ck(T.stageLabel(11) === "已掌握", "已掌握档位文案为「已掌握」", T.stageLabel(11));
  ck(typeof T.formatMinutes === "function" && T.formatMinutes(1440) === "1 天"
    && T.formatMinutes(720) === "12 小时" && T.formatMinutes(5) === "5 分钟",
    "formatMinutes 唯一格式化：1440→1 天、720→12 小时、5→5 分钟",
    [T.formatMinutes && T.formatMinutes(1440), T.formatMinutes && T.formatMinutes(720), T.formatMinutes && T.formatMinutes(5)].join(","));
  T.applyStagePreset("legacy");
  ck(T.stageLabel(1) === "第 1 档 · 5 分钟", "legacy 第 1 档为「第 1 档 · 5 分钟」", T.stageLabel(1));
  ck(T.stageLabel(2) === "第 2 档 · 30 分钟", "legacy 第 2 档为「第 2 档 · 30 分钟」", T.stageLabel(2));
  ck(T.stageLabel(3) === "第 3 档 · 12 小时", "legacy 第 3 档为「第 3 档 · 12 小时」", T.stageLabel(3));
  T.applyStagePreset("intense");
  ck(T.stageLabel(1) === "第 1 档 · 30 分钟", "intense 第 1 档为「第 1 档 · 30 分钟」", T.stageLabel(1));
  T.applyStagePreset("balanced");
  const balancedSummary = cycleSummary();
  const editLast = T.setStageMinutes(9, 129600);   // 第 10 档 60 天 → 90 天（合法）
  ck(editLast && editLast.ok === true, "编辑第 10 档为 90 天成功");
  ck(cycleSummary() !== balancedSummary && summaryDays() !== null && Math.abs(summaryDays() - 225) <= 1,
    "编辑某档后周期摘要随之变化（195 天 → 225 天）", `${balancedSummary} → ${cycleSummary()}`);
  // 页面不得再有固定「约 120 天」承诺（app.js 与 index.html 静态检查）。
  const appText = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
  ck(!/约\s*120\s*天/.test(appText), "app.js 无「约 120 天」固定文案");
  ck(!/约\s*120\s*天/.test(indexHtml), "index.html 无「约 120 天」固定文案");
  ck(!/完整周期约\s*120/.test(indexHtml), "设置页无固定完整周期承诺");
  T.applyStagePreset("balanced");
}

/* ---------------- 9. 迁移 / 备份 / dv ---------------- */
console.log("== 9. 备份与旧记录迁移 ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("light");
  const dvBefore = T.getS().dv;
  const exported = T.buildExport();
  const bookState = exported && exported.books && exported.books.kaoyan;
  ck(bookState && JSON.stringify(bookState.settings.stages) === JSON.stringify(EXPECT_PRESETS.light.stages)
    && bookState.settings.relearn === EXPECT_PRESETS.light.relearn
    && bookState.settings.stagePreset === "light",
    "v3 导出包含 stages/relearn/stagePreset",
    JSON.stringify(bookState && bookState.settings.stagePreset));
  T.applyStagePreset("balanced");
  T.importState(clone(exported));
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.light.stages)
    && T.getRelearn() === EXPECT_PRESETS.light.relearn,
    "导入往返保留复习曲线");
  ck(T.getS().dv === dvBefore, "设置/曲线变化不改变 dv（词库数据版本）", `${T.getS().dv} vs ${dvBefore}`);
  // 旧备份（settings 无 stages/relearn）导入：legacy，不报错，进度保留。
  const oldBackup = {
    app: APP_ID, version: 3, activeBook: "kaoyan",
    books: {
      kaoyan: {
        settings: { dailyNew: 9, order: "freq" },
        progress: { 2: [1, now + 5000, 1, 0, now] }, days: {}, stars: {}, proficient: {}, dv: dvBefore
      }
    }
  };
  let err = null;
  try { T.importState(clone(oldBackup)); } catch (e) { err = e; }
  ck(!err, "导入旧备份（无 stages/relearn）不报错", err && err.message);
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.legacy.stages)
    && T.getRelearn() === 5, "旧备份导入后为 legacy 曲线 + relearn 5");
  ck(T.getS().settings.dailyNew === 9 && T.getS().settings.order === "freq",
    "旧备份其他设置保留");
  ck(T.getS().progress[2] && T.getS().progress[2][1] === now + 5000,
    "旧备份已有到期时间原样保留（不追溯）");
  ck(T.getS().dv === dvBefore, "旧备份导入 dv 不变");
  T.applyStagePreset("balanced");
}

/* ---------------- 10. 十档末端 / MASTER ---------------- */
console.log("== 10. 十档末端与 MASTER ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("balanced");
  totalScope();
  const stages = T.getStages();
  const i = freshWordIndex();
  const p9 = knowTo(i, 9);
  ck(p9[0] === 9, "第 9 次「会」后 stage=9", String(p9[0]));
  ck(T.stageLabel(9).includes("45 天"), "第 9 档文案 = 45 天", T.stageLabel(9));
  T.setCur(i); T.setVerdict(null);
  T.judge(true);
  const p10 = T.getS().progress[i];
  ck(p10[0] === 10 && T.stageLabel(10).includes("60 天"),
    "stage 9→10：进入第 10 档（60 天）", `${p10[0]} / ${T.stageLabel(10)}`);
  ck(!T.buildQueue(Date.now()).due.includes(i), "第 10 档未到期的词不在 due");
  ck(!T.isMastered(i), "stage=10 尚未已掌握");
  T.setCur(i); T.setVerdict(null);
  T.judge(true);
  const pMaster = T.getS().progress[i];
  ck(pMaster[0] === 11 && T.isMastered(i), "走满十档后再会 → MASTER（已掌握）", String(pMaster[0]));
  ck(T.stageLabel(11).includes("已掌握"), "MASTER 的档位文案为「已掌握」", T.stageLabel(11));
  advance(365 * DAY * MIN_MS);
  ck(!T.buildQueue(Date.now()).due.includes(i), "已掌握词即使时间过去很久也不再排复习");
  ck(!T.wordReviewLabel(i).includes("下次复习"), "已掌握词复习标签不再显示下次复习", T.wordReviewLabel(i));
}

/* ---------------- 11. 四书独立 ---------------- */
console.log("== 11. 四书曲线互相独立 ==");
{
  T.switchBook("kaoyan");
  T.applyStagePreset("light");
  ck(T.switchBook("cet4") === true, "切换到四级");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.balanced.stages),
    "四级全新记录仍为 balanced（不继承考研 light）", JSON.stringify(T.getStages()));
  T.applyStagePreset("intense");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.intense.stages)
    && T.getRelearn() === EXPECT_PRESETS.intense.relearn, "四级设为 intense 生效");
  ck(T.switchBook("kaoyan") === true, "切回考研");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.light.stages),
    "考研保留自己的 light 曲线", JSON.stringify(T.getStages()));
  ck(T.switchBook("cet4") === true, "再切四级");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.intense.stages),
    "四级保留自己的 intense 曲线");
  const cet4Saved = store.has(CET4_KEY) ? JSON.parse(store.get(CET4_KEY)) : null;
  ck(cet4Saved && JSON.stringify(cet4Saved.settings.stages) === JSON.stringify(EXPECT_PRESETS.intense.stages),
    "四级的曲线保存在自己的存储键");
  const kaoyanSaved = store.has(KEY) ? JSON.parse(store.get(KEY)) : null;
  ck(kaoyanSaved && JSON.stringify(kaoyanSaved.settings.stages) === JSON.stringify(EXPECT_PRESETS.light.stages),
    "考研的曲线保存在自己的存储键");
  // 六级同样独立：默认 balanced，设 legacy 后切回考研/四级均不受影响。
  ck(T.switchBook("cet6") === true, "切换到六级");
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.balanced.stages),
    "六级全新记录为 balanced");
  T.applyStagePreset("legacy");
  ck(T.switchBook("kaoyan") === true && JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.light.stages),
    "六级改曲线不影响考研（考研仍 light）");
  ck(T.switchBook("cet6") === true && JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.legacy.stages),
    "六级保留自己的 legacy");
  // 复原。
  for (const id of ["kaoyan", "cet4", "cet6"]) {
    if (!T.switchBook(id)) continue;
    T.applyStagePreset("balanced");
  }
  T.switchBook("kaoyan");
}

/* ---------------- 12. 设置页 UI 渲染与交互（真实 app.js 委托） ---------------- */
console.log("== 12. 设置页渲染、单位换算与交互 ==");
{
  for (const [id, label] of [["rhythmPresets", "预设"], ["rhythmStages", "十档编辑"],
    ["rhythmRelearn", "不会后重学间隔"], ["rhythmPreview", "周期预览"], ["rhythmError", "错误提示"]]) {
    ck(new RegExp('id="' + id + '"').test(indexHtml), `index.html 含 #${id}（${label}）`);
  }
  ck(/data-rhythm-reset/.test(indexHtml), "index.html 含 [data-rhythm-reset] 恢复默认入口");
  ck(/data-preset="balanced"/.test(indexHtml) && /data-preset="legacy"/.test(indexHtml),
    "index.html 预设按钮带 data-preset");
  ck(/id="rhythmRelearn"[\s\S]{0,500}组内[\s\S]{0,120}重考/.test(indexHtml),
    "页面明确区分「不会后重学间隔」与组内重考是两套机制（不误导改设置=关闭重考）");

  T.switchBook("kaoyan");
  T.applyStagePreset("balanced");
  const balancedBtn = rhythmPresetButtons.find(b => b.dataset.preset === "balanced");
  const legacyBtn = rhythmPresetButtons.find(b => b.dataset.preset === "legacy");
  ck(typeof legacyBtn.onclick === "function" && typeof balancedBtn.onclick === "function",
    "预设按钮已由 app.js 绑定 onclick");
  ck(balancedBtn.getAttribute("aria-pressed") === "true"
    && legacyBtn.getAttribute("aria-pressed") === "false",
    "预设按钮 aria-pressed 与当前 balanced 曲线同步");
  fireClick(legacyBtn);
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.legacy.stages),
    "点击「旧版密集」预设按钮切换到 legacy", JSON.stringify(T.getStages().slice(0, 2)));
  T.applyStagePreset("balanced");

  const preview = ensureEl("#rhythmPreview").textContent || "";
  ck(preview.includes("完整周期") && preview.includes("约 195 天"),
    "预览显示 balanced 完整周期「约 195 天」", preview);
  ck(preview.includes("均衡曲线") && preview.includes("不会后重学 1 天"),
    "预览显示预设名与不会后重学间隔", preview);
  ck((ensureEl("#rhythmStatus").textContent || "").includes("均衡"),
    "状态栏显示当前：均衡", ensureEl("#rhythmStatus").textContent);

  const stagesHtml = rhythmStagesContainer.innerHTML || "";
  const rowCount = (stagesHtml.match(/data-stage-row=/g) || []).length;
  ck(rowCount === 10, "十档编辑区渲染 10 行", `rows=${rowCount}`);
  ck(/data-stage-index="0"/.test(stagesHtml) && /data-stage-unit-select="0"/.test(stagesHtml)
    && /1 天/.test(stagesHtml) && /data-stage-index="9"/.test(stagesHtml),
    "十档行含输入、单位选择与动态换算预览（首档 1 天）", stagesHtml.slice(0, 240));
  const relearnHtml = rhythmRelearnContainer.innerHTML || "";
  ck(/data-relearn="1"/.test(relearnHtml) && /data-relearn-unit/.test(relearnHtml) && /1 天/.test(relearnHtml),
    "不会后重学间隔区渲染输入/单位/动态预览", relearnHtml.slice(0, 200));

  // 逐档编辑：非法值显示错误并定位第 5 档；合法值清除错误。
  T.applyStagePreset("balanced");
  const stageInput4 = rhythmStageInputs[4];
  ck(typeof stageInput4.onchange === "function", "第 5 档输入已绑定 onchange");
  stageInput4.value = "1";   // 单位为天：1 天 < 第 4 档 7 天，非法
  fireEvent(stageInput4, "change");
  ck(ensureEl("#rhythmError").hidden === false, "非法编辑时 #rhythmError 可见");
  ck((ensureEl("#rhythmError").textContent || "").includes("第 5 档"),
    "非法编辑错误定位到第 5 档", ensureEl("#rhythmError").textContent);
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.balanced.stages),
    "非法编辑不改动原曲线");
  stageInput4.value = "11";  // 11 天：大于 7 天且小于下一档 10 天，合法
  fireEvent(stageInput4, "change");
  ck(T.getStages()[4] === 11 * DAY, "UI 合法编辑第 5 档为 11 天", String(T.getStages()[4]));
  ck(ensureEl("#rhythmError").hidden === true && !ensureEl("#rhythmError").textContent,
    "合法编辑后错误提示清空");
  ck(setting().stagePreset === "custom", "逐档编辑后 stagePreset=custom", String(setting().stagePreset));
  T.applyStagePreset("balanced");

  // 单位换算：分钟 / 小时 / 天 输入同一时长都落库为同一整数分钟。
  function uiSetUnit(index, unit) {
    const sel = rhythmStageUnits[index];
    sel.value = unit;
    fireEvent(sel, "change");
  }
  function uiSetStage(index, value) {
    const input = rhythmStageInputs[index];
    input.value = String(value);
    fireEvent(input, "change");
  }
  T.applyStagePreset("balanced");
  uiSetUnit(0, "m");
  uiSetStage(0, 120);
  ck(T.getStages()[0] === 120, "UI 输入 120 分钟 → 120", String(T.getStages()[0]));
  uiSetUnit(0, "h");
  uiSetStage(0, 2);
  ck(T.getStages()[0] === 120, "UI 输入 2 小时 → 120 分钟", String(T.getStages()[0]));
  uiSetUnit(0, "d");
  uiSetStage(0, 1);
  ck(T.getStages()[0] === 1440, "UI 输入 1 天 → 1440 分钟", String(T.getStages()[0]));
  ck(Number.isInteger(T.getStages()[0]) && T.getStages().every(Number.isInteger),
    "单位换算落库无浮点残留（全为整数分钟）", JSON.stringify(T.getStages()));
  T.applyStagePreset("balanced");

  // 不会后重学间隔：UI 委托输入 2 天 → 2880 分钟。
  ck(typeof rhythmRelearnInput.onchange === "function", "重学间隔输入已绑定 onchange");
  rhythmRelearnUnit.value = "d";
  fireEvent(rhythmRelearnUnit, "change");
  rhythmRelearnInput.value = "2";
  fireEvent(rhythmRelearnInput, "change");
  ck(T.getRelearn() === 2880, "UI 设置不会后重学间隔 2 天 → 2880 分钟", String(T.getRelearn()));
  ck(setting().stagePreset === "custom", "编辑重学间隔后 stagePreset=custom");
  T.applyStagePreset("balanced");

  // 恢复默认按钮（静态节点，bindSet 时赋 onclick）。
  T.applyStagePreset("legacy");
  ck(typeof rhythmResetButton.onclick === "function", "[data-rhythm-reset] 已绑定 onclick");
  fireClick(rhythmResetButton);
  ck(JSON.stringify(T.getStages()) === JSON.stringify(EXPECT_PRESETS.balanced.stages)
    && T.getRelearn() === EXPECT_PRESETS.balanced.relearn,
    "点击恢复默认回到 balanced 预设", JSON.stringify(T.getStages().slice(0, 2)));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
