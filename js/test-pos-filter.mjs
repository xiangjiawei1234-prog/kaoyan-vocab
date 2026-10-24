/**
 * 06 统一词性筛选语义验收
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据），不复制业务逻辑。
 * 覆盖：posMode 默认/迁移/非法回退、primary 与现状逐位一致、all 模式词性并集、
 * 单一判据一致性（inScope/直方图/队列/列表/统计/TXT）、x 其他口径、posline 展示、
 * 设置交互与持久化、四书独立、导出导入往返、12,082 词直方图冒烟。
 * 运行：node --max-old-space-size=512 js/test-pos-filter.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const APP_ID = "kaoyan-vocab";

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

/* ---------------- DOM 桩（支持 posMode 按钮的真实 click 冒泡与焦点） ---------------- */
function mkEl(tag = "div") {
  const events = new Map();
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), _h: "", style: {}, dataset: {}, value: "", checked: false,
    textContent: "", hidden: false, disabled: false, files: [], scrollTop: 0,
    clientHeight: 600, clientWidth: 300, offsetWidth: 240, offsetHeight: 120,
    onclick: null, onchange: null, oninput: null, parentNode: null,
    classList: {
      add(...a) { a.forEach(x => classes.add(x)); },
      remove(...a) { a.forEach(x => classes.delete(x)); },
      toggle(c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    removeEventListener() {},
    appendChild() {}, remove() {},
    _attrs: {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
    closest() { return null; },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 10, top: 10, right: 250, bottom: 130, width: 240, height: 120 }; },
    focus() { document.activeElement = el; },
    blur() { if (document.activeElement === el) document.activeElement = null; },
    click() { fireClick(el); },
    _events: events
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._h; },
    set(v) { el._h = String(v); }
  });
  return el;
}
/** 真实点击语义：先自身 onclick，再沿 parentNode 冒泡触发 addEventListener("click")。 */
function fireClick(target) {
  const ev = {
    type: "click", target, detail: 1,
    preventDefault() {}, stopPropagation() {},
    currentTarget: target
  };
  let node = target;
  while (node) {
    ev.currentTarget = node;
    if (typeof node.onclick === "function") node.onclick(ev);
    for (const fn of node._events?.get?.("click") || []) fn(ev);
    node = node.parentNode;
  }
  return ev;
}

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const registry = new Map();
function ensureEl(sel) {
  if (!registry.has(sel)) registry.set(sel, mkEl(sel.includes("button") ? "button" : "div"));
  return registry.get(sel);
}
// 设置页词性口径按钮（ui-shell 静态 HTML 的 [data-pos-mode]），只保留一份稳定实例，
// 便于 app.js 绑定 onclick 后测试直接点击。
const posModeEl = mkEl("div");
const posModeButtons = ["primary", "all"].map(mode => {
  const b = mkEl("button");
  b.dataset.posMode = mode;
  b.parentNode = posModeEl;
  return b;
});
const posChipButtons = ["n", "v", "a", "d", "x"].map(k => {
  const b = mkEl("button");
  b.dataset.pos = k;
  return b;
});
function matchSimple(el, selector) {
  for (const part of String(selector).split(",")) {
    const sel = part.trim();
    if (sel === ".view" && el.classList.contains("view")) return true;
    if (sel === ".nav button" && el.tagName === "BUTTON") return true;
    if (sel === ".keybtn" && el.classList.contains("keybtn")) return true;
    if (sel === "#posMode button" && el.tagName === "BUTTON" && el.parentNode === posModeEl) return true;
    if (sel === "[data-pos-mode]" && el.dataset && el.dataset.posMode !== undefined) return true;
    if (sel === "#posChips button" && el.dataset && el.dataset.pos !== undefined) return true;
    const id = sel.match(/^#([\w-]+)$/);
    if (id && el.id === id[1]) return true;
  }
  return false;
}
const allFixtureEls = posModeButtons.concat(posChipButtons);
globalThis.document = {
  querySelector: (s) => {
    if (s === "#posMode") return posModeEl;
    const modePick = s.match(/^#posMode \[data-pos-mode="([^"]+)"\]$/);
    if (modePick) return posModeButtons.find(b => b.dataset.posMode === modePick[1]) || null;
    return ensureEl(s);
  },
  querySelectorAll: (s) => {
    if (s === "[data-pos-mode]" || s === "#posMode button" || s === "#posMode [data-pos-mode]") return posModeButtons;
    if (s === "#posChips button") return posChipButtons;
    return allFixtureEls.filter(el => matchSimple(el, s));
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
globalThis.confirm = () => true;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

/* ---------------- 四词书数据（先有 window 再执行数据脚本） ---------------- */
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

/* ---------------- 通用辅助 ---------------- */
const clone = v => JSON.parse(JSON.stringify(v));
const POSN = ["名词", "动词", "形容词", "副词", "介词", "限定词", "代词", "助动词", "并列连词", "从属连词", "数词", "小品词", "专有名词", "感叹词", "其他", "符号"];
const POSMAP = { n: [0], v: [1], a: [2], d: [3] };
const BOOK_KEYS = { kaoyan: "kaoyan_vocab_v1", cet4: "cet4_vocab_v1", cet6: "cet6_vocab_v1", combined: "combined_vocab_v1" };
const rawW = () => T.getW();
const idxOf = (word) => rawW().findIndex(x => x.w === word);
const setting = () => T.getS().settings;
const tagSet = (x) => new Set(Array.from(T.posTagsOf(x) || []));
const storeState = () => (store.has(KEY) ? JSON.parse(store.get(KEY)) : null);
const lines = (txt) => { const s = String(txt || "").trim(); return s ? s.split("\n").length : 0; };
function setScope({ posMode = "primary", pos = [], fmin = 1, fmax = 0, pmin = 0, kyOnly = false } = {}) {
  Object.assign(setting(), { posMode, pos, fmin, fmax, pmin, kyOnly });
  return setting();
}
function resetProgress() {
  const S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
}
/** 旧口径（x.p 主标签 + POSMAP）的期望匹配，用于证明 primary 与现状逐位一致。 */
function legacyMatch(x, sel) {
  if (!sel || !sel.length) return true;
  for (const k of sel) {
    if (k === "x") { if (![0, 1, 2, 3].includes(x.p)) return true; }
    else if (POSMAP[k] && POSMAP[k].includes(x.p)) return true;
  }
  return false;
}
function manualInScopeCount() {
  let n = 0;
  for (let i = 0; i < rawW().length; i++) if (T.inScope(i)) n++;
  return n;
}
function listCountFromDom() {
  const text = ensureEl("#listCount").textContent || "";
  const m = text.match(/共\s*(\d+)\s*词/);
  return m ? Number(m[1]) : -1;
}
function applyListScope() {
  ensureEl("#q").value = "";
  ensureEl("#fst").value = "all";
  ensureEl("#fsc").value = "scope";
  T.applyFilter(false);
  return listCountFromDom();
}
function poslineTextOf(html) {
  const src = String(html || "");
  // 卡片用 <div class="posline">；词表详情用 <span class="tag pos-tag">。
  const m = src.match(/<div class="posline">([\s\S]*?)<\/div>/)
    || src.match(/<span class="tag pos-tag">([\s\S]*?)<\/span>/);
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

/* ---------------- 0. 契约钩子与默认值 ---------------- */
console.log("== 0. 钩子与默认值 ==");
{
  for (const name of ["posTagOfPos", "posTagsOf", "posMatches", "getPosMode"]) {
    ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  }
  ck(T.getPosMode() === "primary", "全新记录默认 posMode=primary", String(T.getPosMode()));
  ck(setting().posMode === "primary", "settings.posMode 默认 primary");
  const fresh = T.normalizeState({ progress: {}, days: {} });
  ck(fresh.settings.posMode === "primary", "normalizeState 缺失 posMode → primary");
}

/* ---------------- 1. 迁移 / 非法回退 / 不丢其他设置 ---------------- */
console.log("== 1. 旧记录迁移与非法值回退 ==");
{
  const base = { progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 };
  const legacy = T.normalizeState({ ...clone(base), settings: { dailyNew: 7, order: "freq", pos: ["v"], pmin: 3 } });
  ck(legacy.settings.posMode === "primary", "旧记录缺 posMode：不报错并回退 primary");
  ck(legacy.settings.dailyNew === 7 && legacy.settings.order === "freq"
    && Array.isArray(legacy.settings.pos) && legacy.settings.pos.join() === "v"
    && legacy.settings.pmin === 3, "旧记录其他设置完整保留",
    JSON.stringify([legacy.settings.dailyNew, legacy.settings.order, legacy.settings.pos, legacy.settings.pmin]));
  const kept = T.normalizeState({ ...clone(base), settings: { posMode: "all", dailyNew: 9 } });
  ck(kept.settings.posMode === "all" && kept.settings.dailyNew === 9, "合法 posMode=all 被保留");
  for (const bad of ["foo", 1, true, null, "", "PRIMARY", "ALL", {}, []]) {
    let out;
    try { out = T.normalizeState({ ...clone(base), settings: { posMode: bad, dailyNew: 5 } }); }
    catch (e) { ck(false, `非法 posMode ${JSON.stringify(bad)} 不应抛错：${e.message}`); continue; }
    ck(out.settings.posMode === "primary" && out.settings.dailyNew === 5,
      `非法 posMode ${JSON.stringify(bad)} → primary 且不丢其他设置`, out.settings.posMode);
  }

  // 旧版 v1 平铺记录经 importState 导入后同样回退 primary。
  const v1 = {
    settings: { dailyNew: 6, order: "wrong", pos: ["n"] },
    progress: { 0: [1, 1000, 1, 0, 500] }, days: {}, stars: {}, timeSec: 0
  };
  const imported = T.importState(clone(v1));
  ck(imported && imported.settings.posMode === "primary", "导入 v1 旧记录：posMode 回退 primary");
  ck(T.getS().settings.dailyNew === 6 && T.getS().settings.order === "wrong"
    && T.getS().settings.pos.join() === "n", "导入 v1 后其他设置不被覆盖",
    JSON.stringify([T.getS().settings.dailyNew, T.getS().settings.order, T.getS().settings.pos]));

  // v2/v3 备份中 settings 缺 posMode：导入不报错并回退 primary。
  for (const version of [2, 3]) {
    const bk = {
      app: APP_ID, version, activeBook: "kaoyan",
      books: {
        kaoyan: {
          settings: { dailyNew: 8, order: "freq", pos: ["a"] },
          progress: { 1: [1, 2000, 1, 0, 1000] }, days: {}, stars: {}, proficient: {},
          ...(version === 3 ? { dv: 3 } : {})
        }
      }
    };
    let out = null, err = null;
    try { out = T.importState(clone(bk)); } catch (e) { err = e; }
    ck(!err, `导入旧 v${version} 备份不报错`, err && err.message);
    ck(T.getBook() === "kaoyan" && T.getS().settings.posMode === "primary",
      `旧 v${version} 备份缺 posMode → 导入后 primary`);
    ck(T.getS().settings.dailyNew === 8 && T.getS().settings.pos.join() === "a",
      `旧 v${version} 备份其他设置保留`);
    ck(out && out.settings && out.settings.posMode === "primary", `importState v${version} 返回状态含 posMode=primary`);
  }
  // 恢复干净状态继续后续范围断言。
  const S = T.getS();
  Object.assign(S.settings, { posMode: "primary", pos: [], dailyNew: 20, order: "shuffle", fmin: 1, fmax: 0, pmin: 2, kyOnly: false });
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  T.startSession();
}

/* ---------------- 2. 派生词性层语义 ---------------- */
console.log("== 2. posTagOfPos / posTagsOf / posMatches 语义 ==");
{
  const tags = Array.from({ length: 16 }, (_, i) => T.posTagOfPos(i));
  ck(tags.slice(0, 4).join(",") === "n,v,a,d", "posTagOfPos 0–3 依次为名词/动词/形容词/副词", tags.slice(0, 4).join(","));
  ck(tags.slice(4).every(t => t === "x"), "posTagOfPos 4–15 均归入 x（其他）", tags.slice(4).join(","));
  ck(T.posTagOfPos(-1) === "x" && T.posTagOfPos(99) === "x", "非法词性下标安全归入 x");

  const W = rawW();
  const work = W[idxOf("work")], use = W[idxOf("use")], modern = W[idxOf("modern")];
  const talk = W[idxOf("talk")], stats = W[idxOf("statistics")], however = W[idxOf("however")];
  ck(!!work && !!use && !!modern && !!talk && !!stats && !!however, "考研夹具词条存在");
  ck(tagSet(work).has("n") && tagSet(work).has("v") && tagSet(work).size === 2,
    "work：主标签名词 + 释义含动词 → {n,v}", Array.from(tagSet(work)).join(","));
  ck(tagSet(use).has("v") && tagSet(use).has("n"), "use：动词主标签 + 名词义 → {v,n}");
  ck(tagSet(modern).size === 1 && tagSet(modern).has("a"), "modern：仅形容词 → {a}", Array.from(tagSet(modern)).join(","));
  ck(tagSet(however).has("d") && tagSet(however).has("x"), "however：副词 + conj. → {d,x}", Array.from(tagSet(however)).join(","));
  ck(Array.isArray(T.posTagsOf(work)) && T.posTagsOf(work).join(",") === "n,v",
    "posTagsOf 返回数组且按 n,v,a,d,x 固定顺序（work → n,v）", JSON.stringify(T.posTagsOf(work)));
  ck(T.posTagsOf(however).join(",") === "d,x", "posTagsOf 固定顺序：however → d,x", JSON.stringify(T.posTagsOf(however)));

  // 无法识别词性前缀时不猜测，只返回主标签（纯函数契约，构造词条验证）。
  const unknown = { w: "zzz-no-pos-prefix", p: 2, m: "纯中文释义，没有词性缩写", fm: "" };
  const fallback = Array.from(T.posTagsOf(unknown));
  ck(fallback.length === 1 && fallback[0] === "a", "释义无词性前缀时只返回主标签，不猜测", fallback.join(","));

  // posMatches = 单一判据
  ck(T.posMatches(work, ["v"]) === false, "primary：work 主标签名词，选动词不匹配");
  ck(T.posMatches(work, ["n"]) === true, "primary：work 选名词匹配");
  ck(T.posMatches(work, []) === true, "选择为空视为不限，任何词都匹配");
  const oldMode = T.getPosMode();
  if (oldMode !== "primary") throw new Error("默认应为 primary");
  const S = T.getS();
  S.settings.posMode = "all";
  ck(T.posMatches(work, ["v"]) === true && T.posMatches(work, ["n"]) === true,
    "all：work 同时匹配动词与名词（释义词性并集）");
  ck(T.posMatches(modern, ["v"]) === false && T.posMatches(modern, ["a"]) === true,
    "all：modern 只匹配形容词");
  ck(T.posMatches(stats, ["x"]) === false, "all：statistics 释义只有名词，不匹配其他(x)");
  ck(T.posMatches(however, ["x"]) === true, "all：however 释义含 conj. → 匹配其他(x)");
  S.settings.posMode = "primary";
  ck(T.posMatches(stats, ["x"]) === false, "primary：statistics 主标签名词，不匹配其他(x)");
  ck(T.posMatches(however, ["x"]) === false, "primary：however 主标签副词，不匹配其他(x)");
  S.settings.posMode = "all";
  ck(T.posMatches(however, ["x"]) === true, "all：however 的 conj. 归入其他(x) 匹配");
  ck(T.posMatches(however, ["d"]) === true, "all：however 的主标签副词也匹配");
  S.settings.posMode = "primary";
  const like = W.find(x => x.w === "like");
  if (like) {
    ck(T.posMatches(like, ["x"]) === true, "primary：介词等主标签（p∉0–3）匹配其他(x)", `p=${like.p}`);
  }
}

/* ---------------- 3. primary 与现状逐位一致 ---------------- */
console.log("== 3. primary 模式与旧口径逐位一致 ==");
{
  const W = rawW();
  resetProgress();
  for (const sel of [["n"], ["v"], ["a"], ["d"], ["x"], ["n", "v"], ["a", "d", "x"]]) {
    setScope({ posMode: "primary", pos: sel, fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
    T.startSession();
    const expected = W.filter(x => legacyMatch(x, sel)).length;
    ck(T.inScopeCount() === expected,
      `primary 选 ${JSON.stringify(sel)} 范围词数 = 旧 p 主标签口径`,
      `${T.inScopeCount()} vs ${expected}`);
  }
  // 逐词逐选位与旧口径完全一致（不只是总数相等）。
  for (const sel of [["n"], ["v"], ["a"], ["d"], ["x"]]) {
    setScope({ posMode: "primary", pos: sel });
    let differ = 0;
    for (const x of W) if (T.posMatches(x, sel) !== legacyMatch(x, sel)) differ++;
    ck(differ === 0, `primary 逐词选 ${JSON.stringify(sel)} 与旧 p 口径完全一致`, `差异 ${differ}`);
  }
}

/* ---------------- 4. 单一判据一致性（关键） ---------------- */
console.log("== 4. 单一判据一致性：范围/直方图/队列/列表/统计/TXT ==");
function consistencySuite(mode, sel = ["v"]) {
  const label = `posMode=${mode} 选 ${JSON.stringify(sel)}`;
  resetProgress();
  setScope({ posMode: mode, pos: sel, fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
  T.startSession();
  const W = rawW();
  const inScopeTruth = manualInScopeCount();
  ck(inScopeTruth > 0, `${label}：范围内有词（样本有效）`, String(inScopeTruth));

  // 直方图 total 与逐词 inScope 真值一致，分桶和等于 total。
  const hist = T.freqHistogram();
  ck(hist.total === inScopeTruth, `${label}：freqHistogram().total 等于逐词 inScope 真值计数`,
    `${hist.total} vs ${inScopeTruth}`);
  ck(Array.isArray(hist.bins) && hist.bins.reduce((n, b) => n + b.count, 0) === hist.total,
    `${label}：直方图分桶和等于 total`);

  // 若实现导出 passBaseFilters，再断言与 posMatches/inScope 同一判据。
  if (typeof T.passBaseFilters === "function") {
    let differ = 0, count = 0;
    const select = setting().pos || [];
    for (const x of W) {
      const scope = T.passBaseFilters(x);
      const viaPos = T.posMatches(x, select);
      const legacy = mode === "primary" ? legacyMatch(x, select) : null;
      if (scope !== viaPos) differ++;
      if (legacy !== null && scope !== legacy) differ++;
      if (scope) count++;
    }
    ck(differ === 0, `${label}：passBaseFilters 全部经 posMatches，无第二处词性判断`, `differ=${differ}`);
    ck(count === inScopeTruth, `${label}：passBaseFilters 计数与 inScope 一致`, `${count} vs ${inScopeTruth}`);
  }

  // 列表筛选（范围+全部状态）计数 = inScopeCount。
  const listed = applyListScope();
  ck(listed === T.inScopeCount(), `${label}：词表范围筛选计数 = inScopeCount`, `${listed} vs ${T.inScopeCount()}`);

  // 统计页词频分层合计 = inScopeCount。
  const mastery = T.frequencyMastery();
  const masteryTotal = (mastery.rows || []).reduce((n, r) => n + (r.total || 0), 0);
  ck(mastery.total === T.inScopeCount() && masteryTotal === T.inScopeCount(),
    `${label}：统计页词频分层合计 = inScopeCount`,
    `${mastery.total}/${masteryTotal} vs ${T.inScopeCount()}`);

  // 队列：可入组的每个词都在范围内且非熟练。
  const q = T.buildQueue(Date.now());
  const queueBad = [];
  for (const i of [...(q.fresh || []), ...(q.due || [])]) {
    if (!T.inScope(i)) queueBad.push(["outOfScope", i]);
    if (T.isProficient(i)) queueBad.push(["proficient", i]);
  }
  ck(queueBad.length === 0, `${label}：buildQueue 返回词全部在范围内且不含熟练词`,
    queueBad.slice(0, 3).map(x => x.join(":")).join(","));

  // TXT 导出口径：范围导出 = 范围内非熟练词；筛选导出 = 列表筛选结果。
  const scopeNonProf = (() => { let n = 0; for (let i = 0; i < W.length; i++) if (T.inScope(i) && !T.isProficient(i)) n++; return n; })();
  ck(lines(T.wordBookTxt("scope")) === scopeNonProf, `${label}：TXT 范围导出行数 = 范围内非熟练词`,
    `${lines(T.wordBookTxt("scope"))} vs ${scopeNonProf}`);
  ck(lines(T.wordBookTxt("filter")) === listed, `${label}：TXT 筛选导出行数 = 词表筛选计数`,
    `${lines(T.wordBookTxt("filter"))} vs ${listed}`);
  return { inScopeTruth, histTotal: hist.total };
}
{
  const primary = consistencySuite("primary", ["v"]);
  const all = consistencySuite("all", ["v"]);
  ck(all.inScopeTruth > primary.inScopeTruth,
    "all 模式选动词的范围内词数显著多于 primary（释义并集生效）",
    `${all.inScopeTruth} vs ${primary.inScopeTruth}`);
  ck(all.histTotal === all.inScopeTruth && primary.histTotal === primary.inScopeTruth,
    "两种模式直方图 total 都等于各自范围真值");
  // 空选择时两种模式范围都等于全库。
  setScope({ posMode: "primary", pos: [] });
  const pAll = T.inScopeCount();
  setScope({ posMode: "all", pos: [] });
  const aAll = T.inScopeCount();
  ck(pAll === rawW().length && aAll === rawW().length, "选择为空时两种模式范围都是全库",
    `${pAll}/${aAll} vs ${rawW().length}`);
}

/* ---------------- 5. "x 其他"口径 ---------------- */
console.log("== 5. x（其他）口径 ==");
{
  const W = rawW();
  const stats = W[idxOf("statistics")];
  const like = W.find(x => x.w === "like");
  const can = W.find(x => x.w === "can");
  const however = W[idxOf("however")];
  setScope({ posMode: "primary", pos: ["x"] });
  ck(!T.posMatches(stats, ["x"]), "primary：statistics（名词）不算其他");
  if (like) ck(T.posMatches(like, ["x"]), "primary：介词主标签 like 归入其他(x)");
  if (can) ck(T.posMatches(can, ["x"]), "primary：助动词主标签 can 归入其他(x)");
  ck(!T.posMatches(however, ["x"]), "primary：副词主标签 however 不算其他");
  setScope({ posMode: "all", pos: ["x"] });
  ck(T.posMatches(however, ["x"]), "all：however 释义含 conj. → 归入其他(x)");
  ck(T.posMatches(like, ["x"]), "all：like 释义含 prep. → 归入其他(x)");
  ck(!T.posMatches(stats, ["x"]), "all：statistics 释义只有名词，仍不匹配其他(x)");
}

/* ---------------- 6. posline 展示 ---------------- */
console.log("== 6. 卡片/详情 posline 展示 ==");
{
  const W = rawW();
  const useIdx = idxOf("use"), modernIdx = idxOf("modern"), workIdx = idxOf("work");
  const use = W[useIdx], modern = W[modernIdx], work = W[workIdx];
  T.setVerdict(null);
  T.setCur(useIdx);
  const cardHtml = ensureEl("#card").innerHTML;
  const usePos = poslineTextOf(cardHtml);
  ck(usePos.startsWith(POSN[use.p]), "卡片 posline 以主词性开头", usePos);
  ck(usePos === "动词 · 释义亦含名词",
    "卡片对多词性词显示「动词 · 释义亦含名词」", usePos);
  ck(usePos.length <= 24, "posline 保持简短，不写成整句", usePos);
  ck(!/名词, ?动词|名词、动词/.test(usePos.replace("释义亦含", "").replace(" · ", "")),
    "posline 不是把 POSN 全文二次拼接", usePos);

  T.setCur(modernIdx);
  const modernPos = poslineTextOf(ensureEl("#card").innerHTML);
  ck(modernPos === POSN[modern.p], "单词性词卡片 posline 仍是纯「形容词」", modernPos);

  T.setCur(workIdx);
  const workPos = poslineTextOf(ensureEl("#card").innerHTML);
  ck(workPos === "名词 · 释义亦含动词", "work 卡片显示「名词 · 释义亦含动词」", workPos);

  T.openWord(useIdx);
  const detailPos = poslineTextOf(ensureEl("#wordDetail").innerHTML);
  ck(detailPos.startsWith(POSN[use.p]) && detailPos.includes("释义亦含"),
    "词表详情同样显示多词性提示", detailPos);
  T.closeSheet();
}

/* ---------------- 7. 设置交互：UI、保存、重建、导出导入 ---------------- */
console.log("== 7. 设置交互与持久化 ==");
{
  const W = rawW();
  const work = W[idxOf("work")];
  // 默认 primary：点「全部词性」按钮切到 all。
  T.switchBook("kaoyan");
  resetProgress();
  setScope({ posMode: "primary", pos: ["v"], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
  setting().dailyNew = 500; setting().order = "freq";
  T.startSession();
  const primaryQ = T.Q.slice();
  const listedPrimary = T.inScopeCount();
  ck(!primaryQ.includes(idxOf("work")) && !T.inScope(idxOf("work")),
    "primary 选动词时 work（名词主标签）不在范围/队列");
  ck(T.getPosMode() === "primary", "切换前为 primary");

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ck(/id="posMode"/.test(html) && /data-pos-mode="primary"/.test(html) && /data-pos-mode="all"/.test(html),
    "index.html 含 #posMode 与两种口径按钮（真实 UI 已落地，不是桩里伪造）");
  const allBtn = posModeButtons.find(b => b.dataset.posMode === "all");
  const primaryBtn = posModeButtons.find(b => b.dataset.posMode === "primary");
  ck(!!allBtn && !!primaryBtn, "存在 [data-pos-mode] 设置按钮");
  ck(primaryBtn.classList.contains("on") && primaryBtn.getAttribute("aria-pressed") === "true"
    && !allBtn.classList.contains("on") && allBtn.getAttribute("aria-pressed") === "false",
    "设置页默认选中「按主要词性」且 aria-pressed 同步");
  fireClick(allBtn);
  ck(T.getPosMode() === "all", "点击「按释义全部词性」后 getPosMode()=all", String(T.getPosMode()));
  ck(allBtn.classList.contains("on") && allBtn.getAttribute("aria-pressed") === "true"
    && !primaryBtn.classList.contains("on"), "切换后 all 按钮选中态/aria 同步");
  ck(setting().posMode === "all", "内存 settings.posMode 已更新");
  const savedAll = storeState();
  ck(savedAll && savedAll.settings.posMode === "all", "设置自动保存到 localStorage",
    savedAll && savedAll.settings.posMode);
  ck(T.inScopeCount() > listedPrimary, "all 模式下范围词数变大",
    `${T.inScopeCount()} vs ${listedPrimary}`);
  ck(T.inScope(idxOf("work")), "all 模式下 work 进入范围");
  // 08 新产品语义：范围类设置默认只应用到下一组，当前组不被重建、进度与已判定现场保持。
  ck(T.qi === 0 && T.answered === 0, "posMode 变化不重建当前组（进度保持）", `qi=${T.qi}`);
  ck(JSON.stringify(T.Q) === JSON.stringify(primaryQ), "当前组队列保持开始时的词性口径");
  ck(T.hasPendingScopeSettings() === true, "检测到设置已更改、待应用到下一组");
  ck(T.getSettingsLifecycle().nextScopeCount === T.inScopeCount(), "下一组预览词数 = 当前设置范围词数");
  ck(T.applySettingsRestart() === true, "显式「应用并重新开始」重建本组");
  ck(T.qi === 0 && T.answered === 0, "显式重开后进度归零");
  ck(T.Q.every(i => T.inScope(i)), "重建后的队列全部在当前范围内");
  ck(T.Q.includes(idxOf("work")), "重建后的队列包含仅 all 模式命中的 work");

  // 切回 primary：范围词数恢复，设置同步保存。
  fireClick(posModeButtons.find(b => b.dataset.posMode === "primary"));
  ck(T.getPosMode() === "primary", "切回 primary 生效");
  ck(T.inScopeCount() === listedPrimary, "切回 primary 后范围词数恢复",
    `${T.inScopeCount()} vs ${listedPrimary}`);
  ck(storeState().settings.posMode === "primary", "primary 同样自动保存");

  // pos 清空后 all/primary 数量一致（并集不影响无词性选择时的基数）。
  setting().pos = [];
  T.startSession();
  const allCountNoSel = T.inScopeCount();

  // 导出/导入往返保留 posMode。
  fireClick(allBtn);
  const exported = T.buildExport();
  ck(exported && exported.books && exported.books.kaoyan
    && exported.books.kaoyan.settings.posMode === "all",
    "备份 v3 导出包含当前书 posMode=all",
    exported?.books?.kaoyan?.settings?.posMode);
  fireClick(posModeButtons.find(b => b.dataset.posMode === "primary"));
  ck(T.getPosMode() === "primary", "改回 primary 后准备导入");
  T.importState(clone(exported));
  ck(T.getBook() === "kaoyan" && T.getS().settings.posMode === "all",
    "导入备份往返后 posMode=all 保留", String(T.getS().settings.posMode));
  setting().pos = [];
  T.startSession();
  ck(T.inScopeCount() === allCountNoSel, "导入后词性并集口径同样生效",
    `${T.inScopeCount()} vs ${allCountNoSel}`);
  // 复原为默认，避免影响后续四书断言。
  setScope({ posMode: "primary", pos: [], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
  T.startSession();
}

/* ---------------- 8. 四书独立与各书并集语义 ---------------- */
console.log("== 8. 四书独立 ==");
{
  const bookCases = [
    ["cet4", "talk", "n"],
    ["cet6", "lead", "n"],
    ["combined", "work", "v"]
  ];
  ck(T.switchBook("kaoyan") === true, "回到考研词书");
  fireClick(posModeButtons.find(b => b.dataset.posMode === "all"));
  ck(T.getBook() === "kaoyan" && T.getPosMode() === "all", "考研设为 all");
  for (const [book, word, selTag] of bookCases) {
    ck(T.switchBook(book) === true, `切换到 ${book}`);
    ck(T.getPosMode() === "primary", `${book} 默认仍为 primary（每书独立，不串设置）`,
      String(T.getPosMode()));
    const i = T.getW().findIndex(x => x.w === word);
    ck(i >= 0, `${book} 含夹具词 ${word}`);
    const W = T.getW();
    setScope({ posMode: "primary", pos: [selTag], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
    T.startSession();
    const primaryHas = T.inScope(i);
    const primaryCount = T.inScopeCount();
    setting().posMode = "all";
    T.startSession();
    const allHas = T.inScope(i);
    const allCount = T.inScopeCount();
    ck(!primaryHas && allHas,
      `${book}：${word} 仅 all 模式命中 [${selTag}]（primary 按主标签排除）`,
      JSON.stringify({ p: W[i].p, primaryHas, allHas }));
    ck(allCount > primaryCount, `${book}：all 模式范围词数变大`, `${allCount} vs ${primaryCount}`);
    // 每本书自己保存 posMode。
    fireClick(posModeButtons.find(b => b.dataset.posMode === "all"));
    ck(T.getPosMode() === "all", `${book} 通过 UI 切到 all`);
  }
  ck(T.switchBook("kaoyan") === true, "切回考研");
  ck(T.getPosMode() === "all", "考研保留自己的 all 设置");
  ck(T.switchBook("cet4") === true, "再切四级");
  ck(T.getPosMode() === "all", "四级保留自己的 all 设置");
  ck(T.switchBook("cet6") === true, "再切六级");
  ck(T.getPosMode() === "all", "六级保留自己的 all 设置");
  // 恢复默认口径，避免污染后续断言。
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    if (!T.switchBook(id)) continue;
    const s = setting();
    s.posMode = "primary"; s.pos = []; s.fmin = 1; s.fmax = 0; s.pmin = 0; s.kyOnly = false;
    T.startSession();
  }
  ck(T.switchBook("kaoyan") === true, "最终回到考研词书");
}

/* ---------------- 9. 12,082 词性能冒烟 ---------------- */
console.log("== 9. 综合词书直方图性能冒烟 ==");
{
  ck(T.switchBook("combined") === true, "切换到综合词书");
  const W = T.getW();
  ck(W.length === 12082, "综合词书为 12,082 词", String(W.length));
  resetProgress();
  for (const mode of ["primary", "all"]) {
    setScope({ posMode: mode, pos: ["v"], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
    T.startSession();
    const started = process.hrtime.bigint();
    const hist = T.freqHistogram();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`  性能：综合书 12,082 词 freqHistogram（${mode}，选动词）耗时 ${ms.toFixed(1)}ms，total=${hist.total}`);
    ck(ms < 500, `${mode} 模式 12,082 词 freqHistogram < 500ms`, `${ms.toFixed(1)}ms`);
    const truth = manualInScopeCount();
    ck(hist.total === truth, `${mode} 模式综合书直方图 total = inScope 真值`, `${hist.total} vs ${truth}`);
  }
  // 冷缓存：先让六级书占用词性派生缓存，再切回综合书，第一次直方图必然包含一次
  // O(n) 构建（缓存键 = 当前 W 引用 + bookId，因此切到别的书会失效）。
  ck(T.switchBook("cet6") === true, "先切到六级书以占住词性派生缓存");
  setScope({ posMode: "all", pos: ["v"], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
  T.freqHistogram();
  // 切书会经 startSession→buildQueue 触发一次 O(n) 派生层构建；记录真实切换耗时。
  const swStart = process.hrtime.bigint();
  ck(T.switchBook("combined") === true, "再切回综合书（词性派生缓存失效）");
  const switchMs = Number(process.hrtime.bigint() - swStart) / 1e6;
  console.log(`  性能：切回综合书（含一次 12,082 词词性派生层构建 + 重建队列）耗时 ${switchMs.toFixed(1)}ms`);
  setScope({ posMode: "all", pos: ["v"], fmin: 1, fmax: 0, pmin: 0, kyOnly: false });
  const coldStart = process.hrtime.bigint();
  const coldHist = T.freqHistogram();
  const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
  // 注意：切书时 startSession→buildQueue 已触发一次 O(n) 词性派生层构建，
  // 所以这里量到的是「切书后直方图」的真实用户路径耗时；派生层构建本身随切书一次性完成。
  console.log(`  性能：切书后综合书 freqHistogram（all，选动词）耗时 ${coldMs.toFixed(1)}ms，total=${coldHist.total}`);
  ck(coldMs < 500, "12,082 词切书后直方图 < 500ms", `${coldMs.toFixed(1)}ms`);
  ck(coldHist.total === manualInScopeCount(), "冷缓存直方图 total 仍等于 inScope 真值");

  // 词性并集缓存：连续两次直方图不应重复解析释义（第二次明显更快或至少不更慢）。
  const t1 = process.hrtime.bigint();
  T.freqHistogram();
  const first = Number(process.hrtime.bigint() - t1) / 1e6;
  const t2 = process.hrtime.bigint();
  T.freqHistogram();
  const second = Number(process.hrtime.bigint() - t2) / 1e6;
  console.log(`  性能：连续两次直方图 ${first.toFixed(1)}ms / ${second.toFixed(1)}ms`);
  ck(second < 500 && first < 500, "连续直方图调用均 < 500ms");
  T.switchBook("kaoyan");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
