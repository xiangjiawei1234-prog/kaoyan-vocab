/**
 * 20 单日复习上限与台账（回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据 + 受控时钟），不复制业务逻辑。
 *
 * 覆盖：
 *  - 新用户默认 100、旧记录缺字段 0、非法值回退、四书独立；
 *  - 备份 v3 含 settings.dailyReviewCap / reviewDay，往返保留，旧备份无字段导入为 0；
 *  - 台账逐条计数：新词首次不算、已学复习算、组内重考算、改判不算、撤销回滚、
 *    错词特训/熟练/收藏/详情不算；
 *  - 0/1/99/100/101 边界、调低到已用量以下、暂停本组、已揭示卡改判/撤销、提高上限恢复；
 *  - 暂停态不判定当前卡、不截断队列、不标完成、不改 p[1]、键盘门控；
 *  - 跨天 refreshForResume 归零、同日重开/刷新不重置；
 *  - 多标签先采纳存储中更大的 used 再 +1、写失败不清零；
 *  - getCapStats 各字段、TXT 导出不被额度截断、默认 cap=100 不误暂停。
 *
 * 运行：node --max-old-space-size=512 js/test-review-cap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const BOOK_KEYS = {
  kaoyan: "kaoyan_vocab_v1",
  cet4: "cet4_vocab_v1",
  cet6: "cet6_vocab_v1",
  combined: "combined_vocab_v1"
};

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else {
    fail++;
    const d = detail === undefined ? "" : String(detail);
    console.log(`  FAIL  ${label}  ${d.length > 400 ? d.slice(0, 400) + "…" : d}`);
  }
};
const clone = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lines = (txt) => {
  const s = String(txt || "").trim();
  return s ? s.split("\n").length : 0;
};

/* ---------------- 受控时钟（本地日） ---------------- */
const RealDate = Date;
let now = new RealDate(2026, 9, 10, 12, 0, 0).getTime();   // 2026-10-10 12:00
class ClockDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = ClockDate;
const advanceDay = () => { now += 24 * 60 * 60 * 1000; };
const dayStr = (t = now) => {
  const d = new RealDate(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------------- DOM 桩（捕获 document/window 事件以测键盘门控） ---------------- */
function mkEl(tag = "div") {
  const events = new Map();
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), _h: "", style: {}, dataset: {}, value: "", checked: false,
    textContent: "", hidden: true, disabled: false, files: [], scrollTop: 0,
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
      const dk = k.startsWith("data-") ? k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
      return dk && el.dataset[dk] !== undefined ? String(el.dataset[dk]) : null;
    },
    matches(selector) {
      return String(selector).split(",").some(part => {
        const sel = part.trim();
        const id = sel.match(/^#([\w-]+)$/);
        if (id) return el.id === id[1];
        const cls = sel.match(/^\.([\w-]+)$/);
        if (cls) return el.classList.contains(cls[1]);
        return false;
      });
    },
    closest(selector) { let n = el; while (n) { if (n.matches?.(selector)) return n; n = n.parentNode; } return null; },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    contains(node) { let n = node; while (n) { if (n === el) return true; n = n.parentNode; } return false; },
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

const store = new Map();
const failKeys = new Set();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (failKeys.has(k)) throw new Error("QuotaExceededError");
    store.set(k, String(v));
  },
  removeItem: k => store.delete(k)
};
const registry = new Map();
function ensureEl(sel) {
  if (!registry.has(sel)) {
    const tag = sel.includes("button") || sel === "#ok" || sel === "#no" || sel === "#nx"
      || sel === "#undoBtn" || sel === "#again" || sel === "#star" ? "button"
      : sel.includes("input") ? "input" : "div";
    registry.set(sel, mkEl(tag));
  }
  return registry.get(sel);
}
const docHandlers = new Map();
const winHandlers = new Map();
const bodyEl = mkEl("body");
globalThis.document = {
  querySelector: ensureEl,
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (!docHandlers.has(type)) docHandlers.set(type, []); docHandlers.get(type).push(fn); },
  removeEventListener() {},
  createElement: t => mkEl(t),
  documentElement: { dataset: {}, style: {} },
  visibilityState: "visible",
  activeElement: null,
  body: bodyEl,
  hidden: false
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
  speechSynthesis: { cancel() {}, speak() {} }
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
globalThis.speechSynthesis = globalThis.window.speechSynthesis;
globalThis.performance = { now: () => now };

/* ---------------- 四词书数据 + 真实 app.js ---------------- */
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

/* ---------------- 断言用适配层（只调用契约钩子，不复制业务逻辑） ---------------- */
const S = () => T.getS();
const settings = () => S().settings;
const cap = () => T.getReviewCap();
const ledger = () => {
  const v = T.getReviewLedger();
  return v && typeof v === "object" ? v : {};
};
const left = () => T.getCapLeft();
const stats = () => {
  const v = T.getCapStats();
  return v && typeof v === "object" ? v : {};
};
const paused = () => T.isCapPaused();
const reviewCapLeftValue = () => typeof T.reviewCapLeft === "function" ? T.reviewCapLeft() : T.reviewCapLeft;
const p1Snapshot = () => {
  const out = {};
  for (const [i, p] of Object.entries(S().progress || {})) out[i] = p[1];
  return out;
};
const stateProbe = () => clone({
  settings: S().settings, progress: S().progress, days: S().days,
  stars: S().stars, proficient: S().proficient, reviewDay: S().reviewDay
});
const stored = (key = KEY) => {
  const raw = store.get(key);
  return raw ? JSON.parse(raw) : null;
};
/** 优先用统一恢复入口；实现若只注册 pageshow/focus，则走真实事件入口。 */
function resume() {
  if (typeof T.refreshForResume === "function") { T.refreshForResume(); return "hook"; }
  for (const fn of winHandlers.get("focus") || []) fn({ type: "focus" });
  return "focus";
}
function pressKey(key) {
  T.show("study");
  const target = mkEl("div");
  const ev = {
    type: "keydown", key, code: key === " " ? "Space" : key, target,
    repeat: false, isComposing: false, defaultPrevented: false,
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    preventDefault() { ev.defaultPrevented = true; },
    stopPropagation() {}
  };
  for (const fn of docHandlers.get("keydown") || []) fn(ev);
  return ev;
}
const NOTICE_SELECTORS = ["#hint", "#toast", "#gateToast", "#appAlertBody", "#appAlertTitle",
  "#capNotice", "#capStatus", "#s-prog", "#studyAnnouncement", "#card"];
function noticeText() {
  const parts = [];
  for (const sel of NOTICE_SELECTORS) {
    const el = ensureEl(sel);
    parts.push(el.textContent || "");
    parts.push(el.innerHTML || "");
  }
  return parts.join(" | ");
}
const hasCapNotice = () => /额度|上限|暂停/.test(noticeText());

/** 夹具：直接构造主记录，但通过真实钩子写入，随后由真实 startSession 建组。 */
function saveFixtures(targetCap) {
  const probe = targetCap === 1000 ? 999 : targetCap + 1;
  T.setReviewCap(probe);
  T.setReviewCap(targetCap);
}
function prepare({ cap: targetCap = 100, due = 2, used = 0, quotaFull = true, newWords = false } = {}) {
  if (T.drillMode) T.exitDrill();
  T.switchBook("kaoyan");
  const s = S();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {
    dailyNew: newWords ? 20 : 1, order: "freq",
    fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], posMode: "primary",
    singleCharKeys: true, dailyReviewCap: targetCap
  });
  const indices = [];
  for (let i = 0; i < due; i++) {
    indices.push(i);
    s.progress[i] = [1, now - (due - i) * 1000, 1, 0, now - 86400000];
  }
  const d = dayStr();
  s.days = quotaFull ? { [d]: { n: s.settings.dailyNew, r: s.settings.dailyNew, ok: s.settings.dailyNew, no: 0 } } : {};
  s.reviewDay = { d, used };
  saveFixtures(targetCap);
  T.startSession();
  T.show("study");
  return { indices, d, targetCap, used };
}
/** 消费一次“已学词复习”所需的最小夹具：1 个到期词、队列只有它。 */
function prepareOneReview({ cap: targetCap = 10, used = 0, quotaFull = true } = {}) {
  const p = prepare({ cap: targetCap, due: 1, used, quotaFull });
  ck(T.cur === p.indices[0], `夹具：当前卡为到期复习词 #${p.indices[0]}`, String(T.cur));
  return p;
}

/* ---------------- 0. 钩子、全新默认值 ---------------- */
console.log("== 0. 契约钩子与全新记录默认值 ==");
{
  const required = ["getReviewCap", "setReviewCap", "getReviewLedger", "getCapLeft", "getCapStats", "isCapPaused"];
  const missing = [];
  for (const name of required) {
    const ok = typeof T[name] === "function";
    ck(ok, `导出契约钩子 ${name}`);
    if (!ok) missing.push(name);
  }
  for (const name of ["getCapStats", "getCapLeft", "isCapPaused", "getReviewLedger"]) {
    if (missing.includes(name) || missing.includes("getReviewCap")) {
      ck(false, `钩子缺失，无法继续验证 ${name}`);
    }
  }
  if (missing.length) {
    console.error(`\n缺少契约钩子：${missing.join(", ")}；等待实现落地后重跑。`);
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(1);
  }

  ck(cap() === 100, "全新记录 getReviewCap()===100", String(cap()));
  ck(settings().dailyReviewCap === 100, "全新记录 settings.dailyReviewCap===100", String(settings().dailyReviewCap));
  ck(ledger().used === 0, "全新记录 reviewDay.used===0", JSON.stringify(ledger()));
  ck(ledger().d === dayStr(), "全新记录 reviewDay.d 为本地今日", JSON.stringify(ledger()));
  ck(left() === 100, "全新记录 getCapLeft()===100", String(left()));
  ck(paused() === false, "全新记录 isCapPaused()===false", String(paused()));
  const rcl = reviewCapLeftValue();
  ck(rcl === left(), "reviewCapLeft 与 getCapLeft 一致", `${String(rcl)} vs ${String(left())}`);
  const st = stats();
  ck(st.cap === 100 && st.used === 0 && st.left === 100 && st.dueTotal === 0 && st.paused === false,
    "全新记录 getCapStats() 五字段一致", JSON.stringify(st));
  const lcopy = T.getReviewLedger();
  if (lcopy && typeof lcopy === "object") {
    lcopy.used = 999;
    ck(ledger().used === 0, "getReviewLedger 返回副本，改外部对象不影响内部台账", String(ledger().used));
  }
}

/* ---------------- 1. 旧记录迁移 / 非法值 / 四书独立 ---------------- */
console.log("== 1. 默认值迁移、非法值与四书独立 ==");
{
  const normBase = (settingsValue) => {
    const o = { progress: {}, days: {} };
    if (settingsValue !== undefined) o.settings = settingsValue;
    return T.normalizeState(o, "kaoyan");
  };
  ck(normBase({ dailyNew: 33 }).settings.dailyReviewCap === 0,
    "旧记录 settings 缺 dailyReviewCap → 0（不限）", String(normBase({ dailyNew: 33 }).settings.dailyReviewCap));
  ck(normBase({ dailyNew: 33 }).settings.dailyNew === 33, "旧记录其他字段保留（dailyNew=33）");
  ck(normBase(undefined).settings.dailyReviewCap === 0, "旧记录连 settings 都没有 → cap=0");
  const oldMissing = normBase({ dailyNew: 20 });
  ck(oldMissing.reviewDay && oldMissing.reviewDay.used === 0,
    "旧记录缺 reviewDay → 今日 used=0", JSON.stringify(oldMissing.reviewDay));
  ck(oldMissing.reviewDay && oldMissing.reviewDay.d === dayStr(),
    "旧记录缺 reviewDay → 日期为今日", JSON.stringify(oldMissing.reviewDay));

  for (const bad of [-1, 1001, "50", null, 5.5, NaN]) {
    const got = normBase({ dailyReviewCap: bad }).settings.dailyReviewCap;
    ck(got === 0, `旧记录非法 dailyReviewCap=${String(bad)} → 0`, String(got));
  }
  for (const good of [0, 1, 1000]) {
    const got = normBase({ dailyReviewCap: good }).settings.dailyReviewCap;
    ck(got === good, `旧记录合法 dailyReviewCap=${good} 保留`, String(got));
  }

  const todayLedger = T.normalizeState({
    settings: { dailyReviewCap: 10 }, progress: {}, days: {},
    reviewDay: { d: dayStr(), used: 5 }
  }, "kaoyan").reviewDay;
  ck(todayLedger.used === 5 && todayLedger.d === dayStr(),
    "旧记录今日合法 reviewDay {d,used:5} 原样保留（刷新不重置）", JSON.stringify(todayLedger));
  const staleLedger = T.normalizeState({
    settings: { dailyReviewCap: 10 }, progress: {}, days: {},
    reviewDay: { d: dayStr(now - 86400000), used: 5 }
  }, "kaoyan").reviewDay;
  ck(staleLedger.used === 0 && staleLedger.d === dayStr(),
    "旧记录 reviewDay 为昨天 → 归今日 0", JSON.stringify(staleLedger));
  for (const bad of [-1, "5", null]) {
    const got = T.normalizeState({
      settings: { dailyReviewCap: 10 }, progress: {}, days: {},
      reviewDay: { d: dayStr(), used: bad }
    }, "kaoyan").reviewDay;
    ck(got.used === 0 && got.d === dayStr(), `旧记录 reviewDay.used=${String(bad)} → 今日 0`, JSON.stringify(got));
  }
  const badDate = T.normalizeState({
    settings: { dailyReviewCap: 10 }, progress: {}, days: {},
    reviewDay: { d: "2026-13-40", used: 5 }
  }, "kaoyan").reviewDay;
  ck(badDate.used === 0 && badDate.d === dayStr(), "旧记录 reviewDay 非法日期 → 今日 0", JSON.stringify(badDate));

  // 四书独立：默认值、上限与台账互不影响。
  const caps = { kaoyan: 37, cet4: 12, cet6: 46, combined: 88 };
  const useds = { kaoyan: 3, cet4: 1, cet6: 0, combined: 2 };
  T.switchBook("cet4");
  ck(T.getReviewCap() === 100, "未写过的四级书全新默认 cap=100", String(T.getReviewCap()));
  ck(ledger().used === 0, "未写过的四级书台账 used=0", JSON.stringify(ledger()));
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    T.switchBook(id);
    const s = S();
    s.settings.dailyReviewCap = caps[id];
    s.reviewDay = { d: dayStr(), used: useds[id] };
    saveFixtures(caps[id]);
    ck(T.getBook() === id && T.getReviewCap() === caps[id],
      `${id} 设置 cap=${caps[id]} 后钩子一致`, `${T.getBook()} / ${T.getReviewCap()}`);
    ck(ledger().used === useds[id] && ledger().d === dayStr(),
      `${id} 台账 used=${useds[id]} 保持`, JSON.stringify(ledger()));
  }
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    T.switchBook(id);
    ck(T.getReviewCap() === caps[id], `${id} 切回后 cap 仍为 ${caps[id]}（四书独立）`, String(T.getReviewCap()));
    ck(ledger().used === useds[id], `${id} 切回后台账 used 仍为 ${useds[id]}（四书独立）`, JSON.stringify(ledger()));
  }
  T.switchBook("kaoyan");
  ck(T.getReviewCap() === 37, "最终回到考研书 cap=37", String(T.getReviewCap()));
}

/* ---------------- 2. 备份 v3 与旧备份兼容 ---------------- */
console.log("== 2. 备份 v3 导出/导入与旧备份缺字段 ==");
{
  prepare({ cap: 37, due: 1, used: 3, quotaFull: true });
  const beforeState = stateProbe();
  const backup = T.buildExport();
  ck(backup && backup.version === 3, "buildExport 返回 v3", backup && backup.version);
  ck(backup && backup.books && backup.books.kaoyan, "备份包含 kaoyan 书");
  ck(backup.books.kaoyan.settings.dailyReviewCap === 37,
    "备份 v3 的 settings 含 dailyReviewCap=37", JSON.stringify(backup.books.kaoyan.settings && backup.books.kaoyan.settings.dailyReviewCap));
  ck(backup.books.kaoyan.reviewDay && backup.books.kaoyan.reviewDay.used === 3,
    "备份 v3 含 reviewDay={d,used:3}", JSON.stringify(backup.books.kaoyan.reviewDay));
  ck(eq(stateProbe(), beforeState), "buildExport 只读，不修改内存状态");

  const dvBefore = S().dv;
  const backupCap = backup.books.kaoyan.settings.dailyReviewCap;
  const backupUsed = backup.books.kaoyan.reviewDay.used;

  S().settings.dailyReviewCap = 55;
  S().reviewDay = { d: dayStr(), used: 9 };
  saveFixtures(55);
  T.importState(backup);
  ck(T.getReviewCap() === backupCap, "导入备份往返保留 cap=37", String(T.getReviewCap()));
  ck(ledger().used === backupUsed, "导入备份往返保留 reviewDay.used=3", JSON.stringify(ledger()));
  ck(S().dv === dvBefore, "导入备份往返 dv 不变", `${String(S().dv)} vs ${String(dvBefore)}`);

  // 旧备份：v3 结构，但 state 缺 dailyReviewCap / reviewDay。
  const oldBackup = clone(backup);
  delete oldBackup.books.kaoyan.settings.dailyReviewCap;
  delete oldBackup.books.kaoyan.reviewDay;
  oldBackup.books.kaoyan.settings.dailyNew = 33;
  oldBackup.activeBook = "kaoyan";
  const dvOldBefore = S().dv;
  let oldErr = null;
  try { T.importState(oldBackup); } catch (e) { oldErr = e; }
  ck(!oldErr, "旧备份缺 cap/reviewDay 导入不报错", oldErr && oldErr.message);
  ck(T.getReviewCap() === 0, "旧备份缺 dailyReviewCap 导入后 cap=0（不限）", String(T.getReviewCap()));
  ck(settings().dailyNew === 33, "旧备份其他设置保留（dailyNew=33）", String(settings().dailyNew));
  ck(ledger().used === 0 && ledger().d === dayStr(),
    "旧备份缺 reviewDay 导入后为今日 0", JSON.stringify(ledger()));
  ck(S().dv === dvOldBefore, "旧备份导入后 dv 不变", `${String(S().dv)} vs ${String(dvOldBefore)}`);
  ck(!paused(), "旧备份升级为不限后不会因历史用量暂停", String(paused()));
}

/* ---------------- 3. 台账逐条计数 ---------------- */
console.log("== 3. 台账逐条计数 ==");
{
  // 3.1 新词首次判定不计入。
  prepare({ cap: 100, due: 0, used: 0, quotaFull: false, newWords: true });
  const newIdx = T.cur;
  ck(newIdx != null && !T.hasMainProgress(S().progress[newIdx]), "夹具：当前卡为未学新词", String(newIdx));
  const usedNew0 = ledger().used;
  T.setVerdict(null);
  T.judge(true);
  ck(ledger().used === usedNew0, "新词首次「会」判定不增加 used", JSON.stringify(ledger()));
  ck(T.hasMainProgress(S().progress[newIdx]), "新词首次判定写入主进度");
  ck(S().days[dayStr()].n === 1, "新词首次判定仍计入 day().n=1", String(S().days[dayStr()] && S().days[dayStr()].n));
  T.undo();
  ck(ledger().used === 0, "撤销新词首次判定后 used 仍为 0（不低于 0）", JSON.stringify(ledger()));
  T.setVerdict(null);
  T.judge(false);
  ck(ledger().used === 0, "新词首次「不会」判定不增加 used", JSON.stringify(ledger()));

  // 3.2 已学词到期复习 +1。
  prepareOneReview({ cap: 10, used: 2 });
  ck(ledger().used === 2, "复习夹具 used=2", JSON.stringify(ledger()));
  T.judge(true);
  ck(ledger().used === 3, "已学词到期复习判定 → used +1", JSON.stringify(ledger()));
  ck(T.getCapLeft() === 7, "复习一次后 getCapLeft=7", String(T.getCapLeft()));

  // 3.3 改判不重复计入。
  T.judge(false);
  ck(ledger().used === 3, "已揭示卡改判 → used 不变", JSON.stringify(ledger()));
  T.undo();
  ck(ledger().used === 3, "撤销改判 → used 不变（改判本就没计）", JSON.stringify(ledger()));
  T.undo();
  ck(ledger().used === 2, "撤销已计数的复习判定 → used -1", JSON.stringify(ledger()));

  // 3.4 组内重考 +1（「不会」后本组队尾重考，仍算主流程复习）。
  prepareOneReview({ cap: 10, used: 2 });
  const recheckIdx = T.cur;
  T.judge(false);
  ck(ledger().used === 3, "已学词答「不会」→ 计入一次", JSON.stringify(ledger()));
  T.tryNext();
  ck(T.cur === recheckIdx, "组内重考：同一词回到当前卡", `${String(T.cur)} vs ${String(recheckIdx)}`);
  ck(T.phase === "recall", "组内重考卡处于未判定状态", String(T.phase));
  T.judge(true);
  ck(ledger().used === 4, "组内重考判定 → used 再 +1", JSON.stringify(ledger()));

  // 3.5 错词特训独立：不占复习额度，暂停态也可进入。
  prepare({ cap: 1, due: 1, used: 1, quotaFull: true });
  S().progress[1] = [0, 0, 0, 3, 0];
  S().progress[2] = [0, 0, 0, 1, 0];
  ck(paused() === true, "特训夹具：主流程复习额度已用尽", String(paused()));
  const usedBeforeDrill = ledger().used;
  const drillStarted = T.startDrill();
  ck(drillStarted === true, "暂停态仍可开始错词特训");
  ck(T.drillMode === true, "已进入错词特训");
  const drillWord = T.cur;
  T.judge(true);
  ck(ledger().used === usedBeforeDrill, "错词特训判定不增加 used", JSON.stringify(ledger()));
  ck(T.hasMainProgress(S().progress[drillWord]) === false, "特训判定不伪造主学习进度");
  T.undo();
  ck(ledger().used === usedBeforeDrill, "撤销特训判定不影响 used", JSON.stringify(ledger()));
  T.exitDrill();

  // 3.6 熟练 / 收藏 / 详情 不计入。
  prepare({ cap: 10, due: 0, used: 2, quotaFull: false, newWords: true });
  const nonJudgeIdx = T.cur;
  T.setProficient(nonJudgeIdx, true);
  ck(ledger().used === 2, "标为熟练不增加 used", JSON.stringify(ledger()));
  ck(T.isProficient(nonJudgeIdx) === true, "熟练标记已生效");
  T.setProficient(nonJudgeIdx, false);

  prepare({ cap: 10, due: 0, used: 2, quotaFull: false, newWords: true });
  const starIdx = T.cur;
  const starBtn = ensureEl("#star");
  ck(typeof starBtn.onclick === "function", "夹具：收藏按钮已绑定");
  if (typeof starBtn.onclick === "function") starBtn.onclick({ stopPropagation() {} });
  ck(S().stars && S().stars[starIdx] === 1, "收藏动作已写入 stars");
  ck(ledger().used === 2, "收藏不增加 used", JSON.stringify(ledger()));

  prepare({ cap: 10, due: 0, used: 2, quotaFull: false, newWords: true });
  const detailIdx = T.cur;
  let detailErr = null;
  try { T.openWord(detailIdx); T.closeSheet(); } catch (e) { detailErr = e; }
  ck(!detailErr, "详情入口可正常打开/关闭", detailErr && detailErr.message);
  ck(ledger().used === 2, "查看词详情不增加 used", JSON.stringify(ledger()));
}

/* ---------------- 4. 边界、暂停态与恢复 ---------------- */
console.log("== 4. 0/1/99/100/101 边界与暂停本组 ==");
{
  // 4.1 cap=1：第一次复习可行，第二次进入暂停。
  prepare({ cap: 1, due: 2, used: 0, quotaFull: true });
  ck(cap() === 1 && left() === 1 && paused() === false, "cap=1 初始 left=1、未暂停", `${cap()}/${left()}/${paused()}`);
  T.judge(true);
  ck(ledger().used === 1 && left() === 0, "cap=1 第一次复习成功消费 1 次", `${ledger().used}/${left()}`);
  ck(T.cur != null && T.phase === "revealed", "第一次复习后当前卡仍为已揭示态", `${String(T.cur)}/${String(T.phase)}`);

  // 已揭示卡仍可改判 / 撤销，撤销后额度回滚并自动解除暂停。
  T.judge(false);
  ck(ledger().used === 1, "暂停态已揭示卡仍可改判，used 不变", JSON.stringify(ledger()));
  ck(T.verdict === false, "暂停态改判结果已生效", String(T.verdict));
  T.undo();
  ck(ledger().used === 1 && T.verdict === true, "撤销暂停态改判，used 不变", JSON.stringify(ledger()));
  T.undo();
  ck(ledger().used === 0 && left() === 1, "撤销计过数的判定 → used-1、left>0", `${ledger().used}/${left()}`);
  ck(paused() === false, "撤销后 left>0 自动解除暂停", String(paused()));

  // 重新耗尽额度并进入下一张卡：第二次复习进入暂停。
  T.judge(true);
  ck(ledger().used === 1 && left() === 0, "重新耗尽额度后 used=1、left=0", `${ledger().used}/${left()}`);
  T.tryNext();
  ck(paused() === true, "cap=1 推进到第二张复习卡后 isCapPaused()===true", String(paused()));
  const pausedCur = T.cur;
  ck(pausedCur != null && pausedCur === T.Q[1], "翻到第二张未答复习卡", String(pausedCur));
  const pausedQ = T.Q.slice();
  const pausedProgress = clone(S().progress);
  const pausedP1 = p1Snapshot();
  const pausedAnswered = T.answered;
  const pausedPending = T.pendingReinforce();
  const pausedPhase = T.phase;
  const pausedProgText = ensureEl("#s-prog").textContent;
  const pausedUsed = ledger().used;

  T.judge(true);
  T.judge(false);
  const keyEv = pressKey("f");
  ck(ledger().used === pausedUsed, "暂停态直接 judge 与键盘判定均不增加 used", JSON.stringify(ledger()));
  ck(T.answered === pausedAnswered, "暂停态未答卡不被标完成（answered 不变）", `${T.answered} vs ${pausedAnswered}`);
  ck(T.cur === pausedCur && T.phase === pausedPhase, "暂停态当前位置不变", `${String(T.cur)}/${String(T.phase)}`);
  ck(eq(T.Q.slice(), pausedQ), "暂停态 Q 不被截断", `${T.Q.length} vs ${pausedQ.length}`);
  ck(eq(p1Snapshot(), pausedP1), "暂停态不批量改期 p[1]", JSON.stringify(p1Snapshot()));
  ck(eq(clone(S().progress), pausedProgress), "暂停态当前卡 progress 不被改写");
  ck(T.pendingReinforce() === pausedPending, "暂停态待巩固数保留", `${T.pendingReinforce()} vs ${pausedPending}`);
  ck(ensureEl("#s-prog").textContent === pausedProgText, "暂停态组进度文本不前进", ensureEl("#s-prog").textContent);
  ck(keyEv.defaultPrevented || hasCapNotice(), "键盘判定被门控（preventDefault 或额度提示）", JSON.stringify(keyEv.defaultPrevented));
  ck(hasCapNotice(), "暂停态存在「额度/上限/暂停」提示", noticeText().slice(0, 200));

  // 提高上限自动恢复。
  T.setReviewCap(2);
  ck(paused() === false && left() === 1, "提高上限到 2 后自动恢复、left=1", `${paused()}/${left()}`);
  T.judge(true);
  ck(ledger().used === 2 && paused() === false, "恢复后第二张可判定，且用尽后无剩余到期不再暂停",
    `${ledger().used}/${paused()}`);

  // 4.2 cap=0 不限：永不暂停。
  prepare({ cap: 0, due: 3, used: 0, quotaFull: true });
  ck(left() === Infinity, "cap=0 时 getCapLeft()===Infinity", String(left()));
  ck(reviewCapLeftValue() === Infinity, "cap=0 时 reviewCapLeft===Infinity", String(reviewCapLeftValue()));
  const st0 = stats();
  ck(st0.cap === 0 && st0.left === Infinity && st0.paused === false, "cap=0 的 stats 为不限且未暂停", JSON.stringify(st0));
  T.judge(true);
  T.tryNext();
  T.judge(true);
  ck(ledger().used === 2, "cap=0 时仍如实累计 used=2", JSON.stringify(ledger()));
  ck(paused() === false && left() === Infinity, "cap=0 消费后仍不暂停", `${paused()}/${left()}`);
  S().reviewDay.used = 10000;
  ck(paused() === false, "cap=0 时 used 很大也永不暂停", String(paused()));
  ck(left() === Infinity, "cap=0 时 used 很大 left 仍为 Infinity", String(left()));

  // 4.3 99/100/101 边界。
  for (const boundary of [99, 100, 101]) {
    prepare({ cap: boundary, due: 3, used: boundary - 1, quotaFull: true });
    ck(ledger().used === boundary - 1, `cap=${boundary} used=${boundary - 1} 夹具`, JSON.stringify(ledger()));
    ck(left() === 1 && paused() === false, `cap=${boundary} 最后一次预算内可行`, `${left()}/${paused()}`);
    T.judge(true);
    ck(ledger().used === boundary, `cap=${boundary} 消费到上限 used=${boundary}`, JSON.stringify(ledger()));
    T.tryNext();
    ck(left() === 0 && paused() === true, `cap=${boundary} 用尽且下一张仍到期 → 暂停`, `${left()}/${paused()}`);
  }

  // 4.4 上限调低到已用量以下：只把剩余预算置零，不回滚已学。
  prepare({ cap: 5, due: 3, used: 2, quotaFull: true });
  const beforeLower = clone(S().progress);
  T.setReviewCap(1);
  ck(cap() === 1, "上限可调低到 1", String(cap()));
  ck(left() === 0, "cap 降到已用量以下 → getCapLeft()===0", String(left()));
  ck(ledger().used === 2, "cap 调低不回滚已用 used=2", JSON.stringify(ledger()));
  ck(eq(S().progress, beforeLower), "cap 调低不改变已学进度");
  ck(paused() === true, "cap 低于已用量且有到期 → 暂停", String(paused()));
  T.setReviewCap(3);
  ck(left() === 1 && paused() === false, "上限提高回 3 后恢复、left=1", `${left()}/${paused()}`);
  T.judge(true);
  ck(ledger().used === 3 && left() === 0, "恢复后消费一次再次到达上限", `${ledger().used}/${left()}`);
  T.tryNext();
  ck(paused() === true, "恢复后消费到上限、下一张仍到期 → 暂停", String(paused()));
}

/* ---------------- 5. 跨天与同日刷新 ---------------- */
console.log("== 5. 跨天归零、同日重开组/刷新不重置 ==");
{
  prepare({ cap: 2, due: 3, used: 2, quotaFull: true });
  ck(paused() === true, "跨天夹具：今日额度已用尽", String(paused()));
  const beforeSameDay = { cur: T.cur, Q: T.Q.slice(), used: ledger().used };
  const sameDayEntry = resume();
  ck(ledger().used === 2, `同日 refresh（${sameDayEntry}）不重置 used`, JSON.stringify(ledger()));
  ck(paused() === true && cap() === 2, "同日 refresh 不解除暂停、cap 不变", `${paused()}/${cap()}`);
  ck(T.cur === beforeSameDay.cur && eq(T.Q.slice(), beforeSameDay.Q),
    "同日 refresh 不重建当前卡与队列");

  T.startSession();
  ck(ledger().used === 2, "同日重开组不重置 used", JSON.stringify(ledger()));
  ck(cap() === 2, "同日重开组 cap 不变", String(cap()));
  ck(paused() === true, "同日重开组仍暂停", String(paused()));
  const crossCur = T.cur;
  const crossQ = T.Q.slice();

  advanceDay();
  const nextDay = dayStr();
  const resumeEntry = resume();
  ck(ledger().used === 0, `跨天 refreshForResume（${resumeEntry}）→ used 归 0`, JSON.stringify(ledger()));
  ck(ledger().d === nextDay, "跨天台账日期更新为次日", `${ledger().d} vs ${nextDay}`);
  ck(cap() === 2, "跨天 cap 保持不变", String(cap()));
  ck(left() === 2, "跨天 left 恢复为 cap", String(left()));
  ck(paused() === false, "跨天自动解除暂停", String(paused()));
  ck(T.cur === crossCur && eq(T.Q.slice(), crossQ), "跨天 refresh 不重建当前卡与队列");
  T.judge(true);
  ck(ledger().used === 1 && left() === 1, "跨天后可继续判定并消费新一天额度", `${ledger().used}/${left()}`);
}

/* ---------------- 6. stats 与 TXT 不被额度截断 ---------------- */
console.log("== 6. getCapStats 字段与 TXT 导出不被额度截断 ==");
{
  prepare({ cap: 5, due: 3, used: 2, quotaFull: true });
  let st = stats();
  ck(st.cap === 5, "capStats.cap===getReviewCap", String(st.cap));
  ck(st.used === 2, "capStats.used===reviewDay.used", String(st.used));
  ck(st.left === 3, "capStats.left===cap-used", String(st.left));
  ck(st.dueTotal === T.countDue(), "capStats.dueTotal===countDue()", `${st.dueTotal} vs ${T.countDue()}`);
  ck(st.paused === false, "capStats.paused 与实际一致", JSON.stringify(st));
  T.judge(true);
  st = stats();
  ck(st.used === 3, "消费后 capStats.used 更新为 3", String(st.used));
  ck(st.left === 2, "消费后 capStats.left 更新为 2", String(st.left));
  ck(st.dueTotal === T.countDue(), "消费后 capStats.dueTotal 重新等于 countDue()", `${st.dueTotal} vs ${T.countDue()}`);
  ck(st.paused === paused(), "消费后 capStats.paused 仍与实际一致", `${st.paused}/${paused()}`);
  st.cap = 999;
  ck(stats().cap === 5, "getCapStats 返回副本，改外部对象不影响实际上限", String(stats().cap));

  const scoped = T.inScopeCount();
  const txtBefore = T.wordBookTxt();
  ck(lines(txtBefore) === scoped, "TXT 条目数=当前范围非熟练词数", `${lines(txtBefore)} vs ${scoped}`);
  const usedBeforeTxt = ledger().used;
  S().reviewDay.used = cap();
  const txtAtCap = T.wordBookTxt();
  ck(lines(txtAtCap) === scoped, "used 达到上限时 TXT 条目数不变（不被额度截断）", `${lines(txtAtCap)} vs ${scoped}`);
  S().reviewDay.used = usedBeforeTxt;
  S().settings.dailyReviewCap = 1;
  S().reviewDay.used = 1;
  const txtPaused = T.wordBookTxt();
  ck(lines(txtPaused) === scoped, "暂停态 TXT 仍导出完整范围", `${lines(txtPaused)} vs ${scoped}`);
  ck(lines(txtPaused) > 1, "暂停态 TXT 不会被截成 1 条", String(lines(txtPaused)));
}

/* ---------------- 7. 默认 cap=100 不回归 ---------------- */
console.log("== 7. 默认 cap=100 的新词学习流程不被误暂停 ==");
{
  prepare({ cap: 100, due: 0, used: 0, quotaFull: false, newWords: true });
  ck(cap() === 100 && settings().dailyReviewCap === 100, "默认流程 cap=100", String(cap()));
  ck(T.Q.length === 20, "默认流程队列有 20 张新词", String(T.Q.length));
  let allNewOk = true, usedStayedZero = true, neverPaused = true;
  for (let k = 0; k < 20; k++) {
    if (T.cur == null) { allNewOk = false; break; }
    if (T.hasMainProgress(S().progress[T.cur])) allNewOk = false;
    if (ledger().used !== 0) usedStayedZero = false;
    if (paused()) neverPaused = false;
    T.judge(true);
    if (ledger().used !== 0 || paused()) usedStayedZero = false;
    T.tryNext();
  }
  ck(allNewOk, "20 张默认新词均为主学习首次判定");
  ck(usedStayedZero, "20 张新词判定期间 used 始终为 0");
  ck(neverPaused, "20 张新词流程从未被误暂停");
  ck(paused() === false && left() === 100, "默认流程结束仍不暂停、left=100", `${paused()}/${left()}`);
  const savedState = stored();
  ck(savedState && savedState.settings.dailyReviewCap === 100,
    "默认 cap=100 已落盘", JSON.stringify(savedState && savedState.settings && savedState.settings.dailyReviewCap));
  ck(savedState && savedState.reviewDay && savedState.reviewDay.used === 0,
    "新词流程落盘 reviewDay.used=0", JSON.stringify(savedState && savedState.reviewDay));
}

/* ---------------- 8. 多标签对齐与写失败（放在最后，避免污染存储夹具） ---------------- */
console.log("== 8. 多标签先采纳更大 used、写失败不清零 ==");

{
  prepare({ cap: 10, due: 4, used: 2, quotaFull: true });
  ck(ledger().used === 2, "多标签夹具：内存 used=2", JSON.stringify(ledger()));
  const raw = stored();
  ck(raw && raw.reviewDay && raw.reviewDay.used === 2, "多标签夹具：存储 used=2", JSON.stringify(raw && raw.reviewDay));
  raw.reviewDay.used = 7;
  store.set(KEY, JSON.stringify(raw));   // 模拟另一标签已消费到 7，本页内存仍是 2

  const adoptIdx = T.cur;
  const adoptP = clone(S().progress[adoptIdx]);
  T.judge(true);
  ck(ledger().used === 8, "消费前先采纳存储中的 used=7，再 +1 → 8", JSON.stringify(ledger()));
  ck(S().progress[adoptIdx] && S().progress[adoptIdx][2] === adoptP[2] + 1,
    "采纳存储计数后本次复习判定仍写入 progress（不被整份 reload 丢弃）",
    JSON.stringify(S().progress[adoptIdx]));
  ck(left() === 2, "采纳后 left=10-8=2", String(left()));

  // 写失败：不清零内存值，也不回滚已判定。先翻到下一张未答复习卡。
  T.tryNext();
  const beforeFailProgress = clone(S().progress);
  const failCur = T.cur;
  ck(failCur != null, "多标签夹具：已翻到下一张未答卡", String(failCur));
  failKeys.add(KEY);
  let threw = null;
  try { T.judge(true); } catch (e) { threw = e; }
  failKeys.delete(KEY);
  ck(!threw, "存储写入失败时判定不抛异常", threw && threw.message);
  ck(ledger().used === 9, "写失败后内存 used 仍为 9（不清零）", JSON.stringify(ledger()));
  ck(S().reviewDay.used === 9, "写失败后 state.reviewDay.used 仍为 9", JSON.stringify(S().reviewDay));
  ck(left() === 1, "写失败后 left 仍按内存值计算为 1", String(left()));
  ck(!eq(S().progress, beforeFailProgress) && T.hasMainProgress(S().progress[failCur]),
    "写失败不清除本次判定写入的进度");
  const storedAfterFail = stored();
  ck(storedAfterFail && storedAfterFail.reviewDay.used === 8,
    "写失败时存储仍停留在旧值 8（稍后重试）", JSON.stringify(storedAfterFail && storedAfterFail.reviewDay));

  // 恢复写入后保留内存值，下一次落盘可重试。
  const retry = T.setReviewCap(11);
  ck(!retry || retry.ok !== false, "恢复存储后调整上限成功", JSON.stringify(retry));
  T.setReviewCap(10);
  ck(ledger().used === 9, "恢复写入后 used 不回退", JSON.stringify(ledger()));
  const storedAfterRetry = stored();
  ck(storedAfterRetry && storedAfterRetry.reviewDay && storedAfterRetry.reviewDay.used === 9,
    "恢复写入后 used=9 成功落盘", JSON.stringify(storedAfterRetry && storedAfterRetry.reviewDay));
}

console.log("== 8b. 跨日撤销旧主组不能退还今日子组的复习额度 ==");
{
  prepare({ cap: 1, due: 2, used: 0, quotaFull: true });
  settings().groupSize = 1;
  saveFixtures(1);
  T.startSession();
  const originalIdx = T.cur;
  const originalProgress = clone(S().progress[originalIdx]);
  const originalDay = dayStr();
  T.judge(true);
  T.tryNext();
  ck(T.cur === null && ledger().used === 1, "昨日主组完成并消费1次复习额度");
  advanceDay();
  resume();
  ck(ledger().used === 0 && ledger().d !== originalDay, "跨日先恢复今日独立额度");
  ck(T.startNewOnlySubgroup() === true, "积压下进入今日计划内新词子组");
  T.judge(false);
  T.tryNext();
  T.judge(true);
  ck(ledger().used === 1, "今日子组的新词重考消费今日1次复习额度");
  const todayRecord = clone(S().days[dayStr()]);
  T.endNewOnlySubgroup();
  T.undo();   // 撤销昨日翻页
  T.undo();   // 撤销昨日首次复习判定
  ck(ledger().used === 1 && left() === 0, "撤销昨日复习判定不退还今日子组额度", JSON.stringify(ledger()));
  ck(eq(S().progress[originalIdx], originalProgress), "昨日主词进度仍正常恢复判定前基线");
  ck(eq(S().days[dayStr()], todayRecord), "今日子组新词与重考统计完整保留");
  ck(stored().reviewDay.used === 1 && eq(stored().days[dayStr()], todayRecord),
    "跨日撤销后的今日额度与子组统计正确落盘");
}
console.log("== 8c. storage事件延迟时仍严格限制最后一次额度 ==");
{
  prepareOneReview({ cap: 100, used: 99 });
  const before = stateProbe();
  const beforeGroup = {cur: T.cur, qi: T.qi, answered: T.answered, Q: T.Q.slice(), total: T.getGroupTotal()};
  const incoming = stored();
  incoming.reviewDay.used = 100;
  store.set(KEY, JSON.stringify(incoming));   // storage 事件尚未送达，另一标签已用完最后一次额度
  T.judge(true);
  ck(ledger().used === 100 && left() === 0, "判定门控先对齐最新台账：99→100，不能消费成101", JSON.stringify(ledger()));
  ck(T.verdict === null && T.phase === "recall" && paused(), "延迟storage事件下预算已满：仍未判定并进入暂停态");
  ck(eq(S().progress, before.progress) && eq(S().days, before.days), "预算门控拒绝后进度/每日作答记录不变");
  ck(T.cur === beforeGroup.cur && T.qi === beforeGroup.qi && T.answered === beforeGroup.answered
      && T.getGroupTotal() === beforeGroup.total && eq(T.Q.slice(), beforeGroup.Q),
    "预算门控拒绝后当前卡/队列/本组计数不变");
  ck(stored().reviewDay.used === 100 && eq(stored().progress, before.progress),
    "拒绝作答不把超额台账或新判定写回存储");
  T.judge(false);
  ck(ledger().used === 100 && T.verdict === null, "暂停后重复尝试不会继续增加额度或错次");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
