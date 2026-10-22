/**
 * 10 语境义试点接线（回归）
 * 加载真实 js/senses-data.js + 真实 js/app.js（DOM 桩 + 真实四词书数据），不复制业务逻辑。
 *
 * 覆盖：
 *  - 页面接线：index.html 在 app.js 之前加载 senses-data.js；sw.js ASSETS 含该文件且版本一致；
 *  - 四书隔离：同一单词按本书义项渲染，不串书；
 *  - 有效义项渲染：已核对义项、原句/来源（label 优先）、surface 命中、lang=en、附加义折叠；
 *  - 无效数据/字段非法时完整回退扁平释义（中性说明，不一律声称逐义核验）；
 *  - 普通词无义项数据时保持既有扁平释义文案；
 *  - 综合书 apply/content 补充义（涂抹、敷 / 含量）以四级真题来源标签呈现，不影响一词一卡；
 *  - 例句点词查义容器/词形可查；wordSenseEntry/meaningHtml 不改变学习队列、进度、判定；
 *  - 打印/TXT/备份范围不受义项层影响；数据文件离线可用（无模块/网络依赖）。
 *
 * 运行：node --max-old-space-size=512 js/test-senses.mjs
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
// 10：语境义可选内容层在 app.js 之前加载（真实交付文件）。
new Function(fs.readFileSync(path.join(HERE, "senses-data.js"), "utf8"))();
if (!globalThis.window.WORD_SENSES) { console.error("senses-data.js 未挂载 window.WORD_SENSES"); process.exit(1); }
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


/* ---------------- 10 断言适配层（只读真实数据/真实 app.js） ---------------- */
const DATA = () => globalThis.window.WORD_SENSES;
const W = () => T.getW();
const findWord = (w) => W().findIndex(x => x.w === w);
const bookData = (book) => (DATA() && DATA().books && DATA().books[book]) || {};
const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const ORIGINAL_SENSES = JSON.parse(JSON.stringify(DATA()));
const stripTags = html => String(html || "").replace(/<[^>]*>/g, " ");
const plainOf = html => norm(stripTags(html));
/** 英文词序列（忽略标点/空白差异）：用于核对渲染原句与数据原句逐词一致。 */
const wordTokens = text => norm(text).toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ").split(/\s+/).filter(Boolean);
function restoreSenses(){ globalThis.window.WORD_SENSES = JSON.parse(JSON.stringify(ORIGINAL_SENSES)); }
function htmlFor(word){
  const i = findWord(word);
  if (i < 0) return {i: -1, x: null, html: "", compact: ""};
  const x = W()[i];
  return {i: i, x: x, html: T.meaningHtml(x), compact: T.meaningHtml(x, true)};
}
function senseItemCount(html){ return (html.match(/class="sense-item"/g) || []).length; }
function stateProbe(){
  const s = S();
  return JSON.stringify({
    progress: s.progress, days: s.days, reviewDay: s.reviewDay, extraDay: s.extraDay,
    Q: T.Q, cur: T.cur, verdict: T.verdict, answered: T.answered, groupTotal: T.getGroupTotal()
  });
}

/* ================= 0. 数据接线与静态契约 ================= */
console.log("== 0. senses-data.js 接线与静态契约 ==");
{
  ck(!!DATA() && DATA().schemaVersion === 1, "window.WORD_SENSES 已加载且 schemaVersion=1");
  const entries = Object.values(DATA().books).reduce((n, b) => n + Object.keys(b).length, 0);
  const senses = Object.values(DATA().books).reduce((n, b) =>
    n + Object.values(b).reduce((m, e) => m + e.preferred.length, 0), 0);
  ck(entries === 96 && senses === 98, "真实数据规模 96 条目 / 98 义项（四书键控）", `${entries}/${senses}`);
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sensesPos = indexHtml.indexOf("js/senses-data.js");
  const appPos = indexHtml.indexOf("js/app.js?v=");
  ck(sensesPos > 0 && appPos > sensesPos, "index.html 在 app.js 之前加载 senses-data.js", `${sensesPos} < ${appPos}`);
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  ck(/\.\/js\/senses-data\.js/.test(sw), "sw.js ASSETS 包含 js/senses-data.js（离线可用）");
  const appVer = (indexHtml.match(/js\/app\.js\?v=([^"]+)/) || [])[1] || "";
  ck(/"kaoyan-vocab-v\d+"/.test(sw) && !!appVer && sw.includes("./js/app.js?v=" + appVer),
    "SW 缓存与 app.js 资源版本一致（版本由 index.html 动态核对）", appVer);
  const dataSrc = fs.readFileSync(path.join(HERE, "senses-data.js"), "utf8");
  ck(!/\bfetch\s*\(|XMLHttpRequest|^\s*(import|export)\s/m.test(dataSrc),
    "数据文件可直接 <script> 加载：无网络请求、无模块语法");
  ck(/window\.WORD_SENSES\s*=/.test(dataSrc), "数据文件挂载 window.WORD_SENSES（非独立 JSON 请求）");
  const backup = JSON.stringify(T.buildExport());
  ck(!backup.includes("WORD_SENSES") && !backup.includes("senses-data"), "语境义内容层不进备份 v3");
}

/* ================= 1. 四书隔离 ================= */
console.log("== 1. 四书隔离：同一单词按本书义项渲染 ==");
{
  T.switchBook("kaoyan");
  const kyClass = htmlFor("class");
  ck(kyClass.i >= 0 && kyClass.html.includes("阶级，社会阶层"), "考研 class 渲染本书义项「阶级，社会阶层」");
  ck(!kyClass.html.includes("班级规模"), "考研 class 不混入四级义项「班级规模」");
  ck(kyClass.html.includes("sense-block") && kyClass.html.includes("本书真题已核对义项"),
    "有效义项渲染为 sense-block 并标注「本书真题已核对义项」");

  T.switchBook("cet4");
  const c4Class = htmlFor("class");
  ck(c4Class.i >= 0 && c4Class.html.includes("班级规模"), "四级 class 渲染本书义项「班级规模」");
  ck(!c4Class.html.includes("阶级，社会阶层"), "四级 class 不混入考研义项「阶级，社会阶层」");
  ck(c4Class.html !== kyClass.html, "同一单词跨书渲染内容不同（四书键控隔离）");

  T.switchBook("kaoyan");
  const kyPlace = htmlFor("place");
  ck(kyPlace.html.includes("地方；位置"), "考研 place 渲染「地方；位置」");
  T.switchBook("cet6");
  const c6Place = htmlFor("place");
  ck(c6Place.html.includes("发生，举行") || c6Place.html.includes("take place"), "六级 place 渲染「发生，举行（take place）」");
  ck(!c6Place.html.includes("地方；位置"), "六级 place 不混入考研义项");
  T.switchBook("kaoyan");
}

/* ================= 2. 有效义项：原句 / 来源 / surface / lang / 折叠 ================= */
console.log("== 2. 有效义项渲染：原句、来源、surface 与折叠 ==");
{
  T.switchBook("kaoyan");
  const entry = bookData("kaoyan").pay;
  ck(!!entry, "真实数据含 kaoyan/pay");
  const rendered = htmlFor("pay");
  const example = entry.preferred[0].examples[0];
  ck(rendered.html.includes("值得，合算"), "渲染已核对义项释义");
  ck(rendered.html.includes("sense-label") && rendered.html.includes("本书真题已核对义项"), "含义项区标签");
  ck(rendered.html.includes('class="sense-quote"') && rendered.html.includes('lang="en"'),
    "英文原句使用 .sense-quote 且 lang=en");
  ck(!/class="sense-meaning"[^>]*lang="en"/.test(rendered.html), "中文义项不加 lang=en（中英容器分开）");
  ck(norm(example.quote).includes(norm(example.surface)), "数据 surface 在 quote 中命中（空白归一/大小写不敏感）",
    example.surface);
  const quoteWords = wordTokens(example.quote);
  const quoteMatch = rendered.html.match(/<p class="sense-quote"[^>]*>([\s\S]*?)<\/p>/);
  const renderedWords = wordTokens(plainOf(quoteMatch ? quoteMatch[1] : ""));
  ck(JSON.stringify(renderedWords.slice(0, quoteWords.length)) === JSON.stringify(quoteWords),
    "渲染包含完整真实原句（去标签后逐词一致，非编造）", norm(example.quote).slice(0, 40));
  ck(rendered.html.includes(example.source), "渲染包含真题出处", example.source);
  ck(/data-exw="[^"]+"/.test(rendered.html) && rendered.html.includes("ex-word"), "原句内单词可点（.ex-word + data-exw）");
  ck(rendered.html.includes("sense-evidence") && rendered.html.includes("查看原句与出处"),
    "原句/出处收进可展开 details（默认折叠）");
  ck(rendered.html.includes("sense-item"), "义项用 sense-item 列表渲染");
  ck(rendered.compact.includes("sense-popup") && rendered.compact.includes("值得，合算"),
    "紧凑模式（例句浮层）用 sense-popup 渲染义项摘要");
  ck(rendered.compact.includes("本书真题已核对义项优先"), "紧凑模式注明「已核对义项优先」");
  // label 优先于 source
  T.switchBook("combined");
  const applyEntry = bookData("combined").apply;
  const applyRendered = htmlFor("apply");
  const labeled = applyEntry.preferred[1].examples[0];
  ck(applyRendered.html.includes(labeled.label) && applyRendered.html.indexOf(labeled.label) >= 0,
    "有 label 时来源显示 label（四级真题来源标签）", labeled.label);
  ck(applyRendered.html.includes("四级真题 · 2015.06") || applyRendered.html.includes("四级真题"), "综合 apply 补充义标注四级真题来源");
  T.switchBook("kaoyan");
}

/* ================= 3. 附加义折叠 ================= */
console.log("== 3. 其他常见义折叠，不冒充已核对义项 ==");
{
  T.switchBook("kaoyan");
  const entry = bookData("kaoyan").state;
  const rendered = htmlFor("state");
  const additional = entry.additional.trim();
  ck(additional.length > 0 && rendered.html.includes(additional), "附加义字符串进入折叠区", additional);
  const addIdx = rendered.html.indexOf("sense-additional");
  const closeListIdx = rendered.html.indexOf("</ol>");
  ck(addIdx > closeListIdx && rendered.html.includes("其他词典释义"),
    "附加义位于已核对义项列表之后（<details> 折叠）");
  ck(rendered.html.includes("这些释义尚未逐义核验"), "附加义明确标注尚未逐义核验");
  ck(rendered.html.indexOf(additional) > addIdx, "附加义只在折叠区内出现，不混入 preferred 列表");
  ck(rendered.html.includes("本书真题已核对义项") && rendered.html.includes("尚未穷尽历年全部用法"),
    "已核对义项说明保持中性、不扩大承诺");
  // additional 为空时不出折叠区
  const emptyAdditional = JSON.parse(JSON.stringify(DATA()));
  emptyAdditional.books.kaoyan.pay.additional = "";
  globalThis.window.WORD_SENSES = emptyAdditional;
  const payHtml = htmlFor("pay").html;
  ck(!payHtml.includes("sense-additional") && !payHtml.includes("其他词典释义"),
    "additional 为空时不渲染「其他词典释义」折叠区");
  restoreSenses();
}

/* ================= 4. 无效数据完整回退 ================= */
console.log("== 4. 无效数据/字段非法：完整回退扁平释义 ==");
{
  T.switchBook("kaoyan");
  const i = findWord("class");
  const x = W()[i];
  const validHtml = T.meaningHtml(x);
  ck(validHtml.includes("sense-block") && validHtml.includes("本书真题已核对义项"),
    "基线：class 有有效义项时渲染 sense-block（回退分支稍后逐个验证）");
  const fallbackNote = "词典释义，具体用法请结合例句；例句点词可查义。";
  const mutators = [
    ["schemaVersion 非 1", d => { d.schemaVersion = 2; }],
    ["缺 books 对象", d => { delete d.books; }],
    ["缺当前词书键", d => { delete d.books.kaoyan; }],
    ["缺当前单词键", d => { delete d.books.kaoyan.class; }],
    ["entry 非对象", d => { d.books.kaoyan.class = "x"; }],
    ["preferred 为空数组", d => { d.books.kaoyan.class = {preferred: [], additional: ""}; }],
    ["义项 meaning 为空", d => { d.books.kaoyan.class = {preferred: [{meaning: "", examples: [{source: "s", quote: "q class", surface: "class"}]}], additional: ""}; }],
    ["examples 为空", d => { d.books.kaoyan.class = {preferred: [{meaning: "义", examples: []}], additional: ""}; }],
    ["quote 不含 surface", d => { d.books.kaoyan.class = {preferred: [{meaning: "义", examples: [{source: "s", quote: "nothing here", surface: "class"}]}], additional: ""}; }],
    ["surface 为空", d => { d.books.kaoyan.class = {preferred: [{meaning: "义", examples: [{source: "s", quote: "a class here", surface: ""}]}], additional: ""}; }],
    ["source 为空", d => { d.books.kaoyan.class = {preferred: [{meaning: "义", examples: [{source: "", quote: "a class here", surface: "class"}]}], additional: ""}; }],
    ["additional 非字符串", d => { d.books.kaoyan.class.additional = 42; }],
    ["entry 为 null", d => { d.books.kaoyan.class = null; }]
  ];
  for (const [label, mutate] of mutators) {
    const copy = JSON.parse(JSON.stringify(ORIGINAL_SENSES));
    mutate(copy);
    globalThis.window.WORD_SENSES = copy;
    const html = T.meaningHtml(x);
    ck(html.includes("sense-dictionary") && html.includes("阶级"),
      `无效数据回退扁平释义：${label}`);
    ck(html.includes(fallbackNote), `回退时使用中性说明：${label}`);
    ck(!html.includes("本书真题已核对义项") && !html.includes("已核对原句") && !html.includes("已按真题考义整理"),
      `回退时不冒充逐义核验：${label}`);
  }
  restoreSenses();
  ck(T.meaningHtml(W()[i]).includes("sense-block"), "恢复真实数据后重新渲染有效义项");
}

/* ================= 5. 普通词回退与备选字段 ================= */
console.log("== 5. 普通词/无数据书的既有回退文案 ==");
{
  T.switchBook("kaoyan");
  const words = new Set(Object.keys(bookData("kaoyan")));
  const plain = W().find(x => !words.has(x.w));
  ck(!!plain, "当前书存在未收录义项数据的普通词");
  const html = T.meaningHtml(plain);
  ck(html.includes("sense-dictionary") && html.includes(plain.m.slice(0, 8)), "普通词回退为原扁平释义", plain.w);
  ck(html.includes("词典释义，具体用法请结合例句；例句点词可查义。"), "普通词回退使用中性文案");
  ck(!html.includes("sense-block") && !html.includes("本书真题已核对义项") && !html.includes("已按真题考义整理"), "普通词不伪造已核对义项");
  // 跨书：六级专属词在考研书不应命中
  T.switchBook("kaoyan");
  const hardHtml = T.meaningHtml(W()[findWord("hard")]);
  ck(!hardHtml.includes("确凿的，硬性的"), "六级专属语境义不会出现在考研书（四书隔离）");
  T.switchBook("kaoyan");
}

/* ================= 6. 综合书补充义（apply 涂抹/敷、content 含量） ================= */
console.log("== 6. 综合书补充义以考试来源标签呈现 ==");
{
  T.switchBook("combined");
  const apply = htmlFor("apply");
  ck(apply.i >= 0 && senseItemCount(apply.html) === 2, "综合 apply 有 2 个已核对义项", String(senseItemCount(apply.html)));
  ck(apply.html.includes("涂抹，敷") && apply.html.includes("施加；应用"),
    "综合 apply 同时呈现「施加；应用」与补充义「涂抹，敷」");
  ck(apply.html.includes("四级真题"), "综合 apply 补充义以四级真题来源标签呈现");
  ck(plainOf(apply.html).includes("apply negative stereotypes") && plainOf(apply.html).includes("apply sunscreen"),
    "综合 apply 两个义项分别配真实原句（非机械拼接释义）");
  const content = htmlFor("content");
  ck(senseItemCount(content.html) === 2 && content.html.includes("含量") && content.html.includes("内容；作品内容"),
    "综合 content 同时呈现「内容」与补充义「含量」");
  ck(content.html.includes("四级真题") && plainOf(content.html).includes("nicotine content"),
    "综合 content 补充义有四级真题原句与来源");
  ck(W().filter(x => x.w === "apply").length === 1 && W().filter(x => x.w === "content").length === 1,
    "综合书同一单词只出现一次（不影响一词一卡）");
  ck(apply.html.includes("sense-additional") && apply.html.includes("vi. 申请；适用"),
    "综合 apply 其他词典义仍折叠，不冒充已核对");
  // 补充义只在综合书：四级 apply 不显示「涂抹，敷」（四级词库释义里有，但语境义层不收录）
  T.switchBook("cet4");
  const c4Apply = htmlFor("apply");
  ck(c4Apply.i >= 0 && !c4Apply.html.includes("涂抹，敷"),
    "四级 apply 不显示综合书补充义（各书独立键控）");
  T.switchBook("kaoyan");
}

/* ================= 7. 例句点词查义（义项原句同样可查） ================= */
console.log("== 7. 义项原句点词查义不回归 ==");
{
  T.switchBook("combined");
  const entry = bookData("combined").apply;
  const surface = entry.preferred[0].examples[0].surface;
  ck(surface === "apply", "综合 apply 原句 surface=apply");
  ck(T.lookupExWord(surface) === findWord(surface), "义项原句中的 surface 可用既有查词入口命中", surface);
  const tokens = T.exTokens(entry.preferred[0].examples[0].quote);
  ck(tokens.some(t => /^[A-Za-z]/.test(t)), "原句可分词（点词查义入口依赖）");
  const exHtml = T.exHtml(entry.preferred[0].examples[0].quote, W()[findWord("apply")]);
  ck(exHtml.includes("ex-word") && exHtml.includes("data-exw="), "原句渲染为可点词 span（供委托打开浮层）");
  // 卡片渲染后存在查词委托入口
  const i = findWord("apply");
  T.setCur(i);
  T.judge(true);
  ck(/sense-block/.test(stateEl("#card").innerHTML), "背诵卡揭示态渲染语境义区（真实 renderCard）");
  ck(stateEl("#card").__exLookupBound === true, "卡片上的例句查词委托已绑定（整句入口）");
  T.undo();
  T.switchBook("kaoyan");
}

/* ================= 8. wordSenseEntry/meaningHtml 不改变学习状态 ================= */
console.log("== 8. 只读渲染：不改变队列/进度/判定 ==");
{
  for (const book of ["kaoyan", "cet4", "cet6", "combined"]) {
    T.switchBook(book);
    const words = Object.keys(bookData(book));
    const before = stateProbe();
    for (const w of words) {
      const i = findWord(w);
      if (i < 0) continue;
      T.meaningHtml(W()[i]);
      T.meaningHtml(W()[i], true);
    }
    ck(stateProbe() === before, `${book}：渲染全部义项不改变学习队列/进度/判定/额度`);
  }
  T.switchBook("kaoyan");
  const s = S();
  const progressBefore = JSON.stringify(s.progress);
  const daysBefore = JSON.stringify(s.days);
  const ledgerBefore = JSON.stringify(T.getReviewLedger());
  const i = findWord("class");
  const x = W()[i];
  T.meaningHtml(x);
  ck(JSON.stringify(S().progress) === progressBefore, "渲染后主进度不变");
  ck(JSON.stringify(S().days) === daysBefore, "渲染不写当日学习统计");
  ck(JSON.stringify(T.getReviewLedger()) === ledgerBefore, "渲染不消费复习额度");
  ck(T.isProficient(i) === false, "渲染不改变熟练状态");
}

/* ================= 9. 打印 / TXT / 范围不受义项层影响 ================= */
console.log("== 9. 打印、TXT 与范围不受义项层影响 ==");
{
  T.switchBook("kaoyan");
  const i = findWord("class");
  const x = W()[i];
  ck(T.inScope(i) && !T.isProficient(i), "class 在当前默认范围内（真实范围）");
  const txt = T.wordBookTxt("scope");
  const lines = txt.trim().split("\n");
  let inScopeN = 0;
  for (let k = 0; k < W().length; k++) if (T.inScope(k) && !T.isProficient(k)) inScopeN++;
  ck(lines.length === inScopeN, "TXT 导出仍按当前范围完整输出（不受义项层截断）", `${lines.length} vs ${inScopeN}`);
  ck(lines.includes("class"), "TXT 导出包含语境义单词（每行纯单词）");
  T.applyFilter(false);
  ck(Array.isArray(T.printBookEntries("filter")), "打印/词表入口可正常取数");
  const entries = T.printBookEntries("filter");
  const entry = entries.find(e => e.w === "class");
  ck(!!entry && entry.m === x.m, "打印词条释义仍是原 11 元组扁平释义（义项层只影响卡片/详情）",
    entry && entry.m);
  T.show("study");
}

/* ================= 10. 长义项与来源显示 ================= */
console.log("== 10. 长义项/来源字符串完整渲染（不截断） ==");
{
  T.switchBook("combined");
  const longWord = Object.keys(bookData("combined"))
    .sort((a, b) => (bookData("combined")[b].preferred[0].meaning || "").length - (bookData("combined")[a].preferred[0].meaning || "").length)[0];
  const rendered = htmlFor(longWord);
  ck(rendered.i >= 0 && rendered.html.includes(bookData("combined")[longWord].preferred[0].meaning),
    "最长义项字符串完整渲染（不截断）", longWord);
  let sourceShown = 0, sourceTotal = 0;
  for (const [w, e] of Object.entries(bookData("combined"))) {
    const html = htmlFor(w).html;
    for (const sense of e.preferred) for (const ex of sense.examples) {
      sourceTotal++;
      const label = ex.label || ex.source;
      if (html.includes(label) || html.includes(ex.source)) sourceShown++;
    }
  }
  ck(sourceShown === sourceTotal, "综合书每条义项的 source/label 均在渲染中显示",
    `${sourceShown}/${sourceTotal}`);
  T.switchBook("kaoyan");
}

/* ================= 11. 页面无重复加载/无内联注册冲突 ================= */
console.log("== 11. 页面接线一致性 ==");
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck((html.match(/js\/senses-data\.js/g) || []).length === 1, "index.html 只加载一次 senses-data.js");
  ck(!/serviceWorker\.register/.test(html), "index.html 不保留内联 SW 注册（13 契约）");
  const appVer2 = (html.match(/js\/app\.js\?v=([^"]+)/) || [])[1] || "";
  const sw2 = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  ck(!!appVer2 && sw2.includes("./js/app.js?v=" + appVer2)
    && html.includes("css/app.css?v=" + appVer2) && sw2.includes("./css/app.css?v=" + appVer2),
    "index.html 与 sw.js 的 app.css/app.js 版本一致", appVer2);
  T.switchBook("kaoyan");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
