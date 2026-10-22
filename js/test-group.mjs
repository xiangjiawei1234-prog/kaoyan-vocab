/**
 * 07 到期池分组 / 积压保护 / 纯新词子组（回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据 + 受控时钟），不复制业务逻辑。
 *
 * 覆盖：
 *  - groupSize/backlogGuard 全新默认 30/true、旧记录迁移、非法值回退、四书独立；
 *  - 备份 v3 含两字段、往返保留、旧备份缺字段默认 30/true、dv 不变；
 *  - 0/1/30/31/500 个到期词的组切片，未入组到期词仍到期，本组分母=实际张数；
 *  - 重考不扩大分母、本组未判定到期卡不计入 remainingDue、走出本组继续下一组；
 *  - 到期不足按剩余 dailyNew（含临时加量）补位、额度用满不补新词、groupSize 截断总数；
 *  - 积压保护条件（cap>0 且到期>剩余预算）、边界、cap=0、开关关闭/重开；
 *  - 纯新词子组：只含未学、按剩余额度、排除原主组未答词、不嵌套、结束回原现场、
 *    子组新词「不会」重考仍受当日复习上限；
 *  - 跨天/refreshForResume 不重建当前卡、切书独立、buildQueue 既有 due/fresh 语义不变。
 *
 * 运行：node --max-old-space-size=512 js/test-group.mjs
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
/* ---------------- 07 断言适配层（只调用契约钩子，不复制业务逻辑） ---------------- */
const S = () => T.getS();
const settings = () => S().settings;
const info = () => {
  const v = T.getGroupInfo();
  return v && typeof v === "object" ? v : {};
};
const plan = () => {
  const v = T.getPlan();
  return v && typeof v === "object" ? v : {};
};
const duePool = () => {
  const v = T.getDuePool();
  return Array.isArray(v) ? v : [];
};
const freshPool = () => {
  const v = T.getFreshPool();
  return Array.isArray(v) ? v : [];
};
const guardOn = () => T.getBacklogGuard() === true;
const guarded = () => T.isBacklogGuarded() === true;
const inNewOnly = () => T.isNewOnlySubgroup() === true;
const dayN = () => {
  const d = S().days[dayStr()];
  return d && Number.isInteger(d.n) ? d.n : 0;
};
const hasProg = i => T.hasMainProgress(S().progress[i]);
const unlearned = i => !hasProg(i) && !T.isProficient(i);
const stored = (key = KEY) => {
  const raw = store.get(key);
  return raw ? JSON.parse(raw) : null;
};
const stateProbe = () => clone({
  settings: S().settings, progress: S().progress, days: S().days,
  stars: S().stars, proficient: S().proficient,
  reviewDay: S().reviewDay, extraDay: S().extraDay
});
const progSig = i => JSON.stringify(S().progress[i]);

/** 通过真实写入口落盘（切换 cap 再切回，促使 save() 写入内存中的夹具状态）。 */
function saveNow() {
  const cap = settings().dailyReviewCap;
  const probe = cap === 1000 ? 999 : cap + 1;
  T.setReviewCap(probe);
  T.setReviewCap(cap);
}

/** 通用夹具：清空当前书记录并写入范围/计划/额度；不伪造 session。 */
function setup(o = {}) {
  if (T.drillMode) T.exitDrill();
  if (typeof T.isNewOnlySubgroup === "function" && T.isNewOnlySubgroup()) T.endNewOnlySubgroup();
  if (typeof T.isExtraSubgroup === "function" && T.isExtraSubgroup()) T.endExtraSubgroup();
  T.switchBook(o.book || "kaoyan");
  if (typeof T.resetProficient === "function") T.resetProficient();
  const s = S();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {
    dailyNew: o.dailyNew === undefined ? 1 : o.dailyNew,
    order: o.order || "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: "primary", singleCharKeys: true,
    dailyReviewCap: o.cap === undefined ? 0 : o.cap,
    groupSize: o.groupSize === undefined ? 30 : o.groupSize,
    backlogGuard: o.backlogGuard === undefined ? true : o.backlogGuard
  });
  const n = o.dayN === undefined ? 0 : o.dayN;
  s.days[dayStr()] = { n, r: n, ok: n, no: 0 };
  s.reviewDay = { d: dayStr(), used: o.used || 0 };
  s.extraDay = { d: dayStr(), extra: o.extra || 0 };
  saveNow();
  return s;
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
  saveNow();
  return picked;
}
/** 本组所有主卡判「会」并翻页；仅用于 cap=0 的推进夹具。 */
function answerAllKnown() {
  let guard = 0;
  while (T.cur != null && guard++ < 2000) {
    T.judge(true);
    T.tryNext();
  }
  return guard;
}

/* ---------------- 0. 契约钩子与全新默认值 ---------------- */
console.log("== 0. 契约钩子与全新记录默认值 ==");
{
  const required = ["getGroupSize", "setGroupSize", "getGroupInfo", "getDuePool", "getFreshPool",
    "getBacklogGuard", "setBacklogGuard", "isBacklogGuarded",
    "startNewOnlySubgroup", "isNewOnlySubgroup", "endNewOnlySubgroup"];
  const missing = [];
  for (const name of required) {
    const ok = typeof T[name] === "function";
    ck(ok, `导出契约钩子 ${name}`);
    if (!ok) missing.push(name);
  }
  if (missing.length) {
    console.error(`\n缺少契约钩子：${missing.join(", ")}；等待实现落地后重跑。`);
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(1);
  }

  ck(T.getGroupSize() === 30, "全新记录 getGroupSize()===30", String(T.getGroupSize()));
  ck(guardOn() === true, "全新记录 getBacklogGuard()===true", String(T.getBacklogGuard()));
  ck(guarded() === false, "全新记录无到期、积压保护未生效", String(T.isBacklogGuarded()));
  ck(inNewOnly() === false, "全新记录 isNewOnlySubgroup()===false", String(T.isNewOnlySubgroup()));
  const gi = T.getGroupInfo();
  ck(gi && typeof gi === "object" && "groupSize" in gi && "groupTotal" in gi
    && "done" in gi && "remainingDue" in gi && "hasMore" in gi,
    "getGroupInfo() 含 groupSize/groupTotal/done/remainingDue/hasMore",
    JSON.stringify(gi));

  const r = T.setGroupSize(7);
  ck(r && r.ok === true && r.groupSize === 7, "setGroupSize(7) 返回 {ok:true,groupSize:7}", JSON.stringify(r));
  ck(T.getGroupSize() === 7 && settings().groupSize === 7, "setGroupSize(7) 生效", String(T.getGroupSize()));
  const badSize = T.setGroupSize(0);
  ck(badSize && badSize.ok === false && badSize.groupSize === 7 && typeof badSize.error === "string",
    "setGroupSize(0) 拒绝并保留原值", JSON.stringify(badSize));
  ck(stored(KEY) && stored(KEY).settings.groupSize === 7, "setGroupSize 落盘", JSON.stringify(stored(KEY) && stored(KEY).settings.groupSize));
  const b = T.setBacklogGuard(false);
  ck(T.getBacklogGuard() === false && settings().backlogGuard === false,
    "setBacklogGuard(false) 生效", `${String(T.getBacklogGuard())}/${String(settings().backlogGuard)}`);
  ck(stored(KEY) && stored(KEY).settings.backlogGuard === false,
    "setBacklogGuard 落盘", JSON.stringify(stored(KEY) && stored(KEY).settings.backlogGuard));
  T.setGroupSize(30);
  T.setBacklogGuard(true);
}

/* ---------------- 1. 默认值、旧记录迁移、非法值与四书独立 ---------------- */
console.log("== 1. 默认值迁移、非法值与四书独立 ==");
{
  const norm = settingsValue => {
    const o = { progress: {}, days: {} };
    if (settingsValue !== undefined) o.settings = settingsValue;
    return T.normalizeState(o, "kaoyan").settings;
  };
  const missing = norm({ dailyNew: 33 });
  ck(missing.groupSize === 30 && missing.backlogGuard === true,
    "旧记录缺 groupSize/backlogGuard → 30/true",
    `${String(missing.groupSize)}/${String(missing.backlogGuard)}`);
  ck(norm(undefined).groupSize === 30 && norm(undefined).backlogGuard === true,
    "旧记录连 settings 都没有 → 30/true",
    `${String(norm(undefined).groupSize)}/${String(norm(undefined).backlogGuard)}`);

  for (const bad of [0, 101, -1, "30", null, 1.5, NaN]) {
    const got = norm({ groupSize: bad }).groupSize;
    ck(got === 30, `旧记录非法 groupSize=${String(bad)} → 30`, String(got));
  }
  const goodSizes = [1, 30, 100].map(v => norm({ groupSize: v }).groupSize);
  ck(eq(goodSizes, [1, 30, 100]), "旧记录合法 groupSize=1/30/100 保留", goodSizes.join(","));
  const badBools = ["true", 1, 0, null, {}, []].map(v => norm({ backlogGuard: v }).backlogGuard);
  ck(badBools.every(v => v === true),
    "旧记录非布尔 backlogGuard 一律 → true", badBools.join(","));
  ck(norm({ backlogGuard: false }).backlogGuard === false, "旧记录 backlogGuard=false 保留");
  const legacy = norm({ dailyNew: 44, dailyReviewCap: 7, groupSize: 12, backlogGuard: false });
  ck(legacy.dailyNew === 44 && legacy.dailyReviewCap === 7
    && legacy.groupSize === 12 && legacy.backlogGuard === false,
    "旧记录合法新字段与其他设置一起保留", JSON.stringify(legacy));

  // 四书独立：新书默认值与已写设置都按书保存，切换不得携带。
  T.switchBook("cet4");
  ck(T.getGroupSize() === 30 && guardOn(),
    "未写过的四级书默认 30/true", `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}`);
  const cfg = {
    kaoyan: { n: 5, g: true },
    cet4: { n: 7, g: false },
    cet6: { n: 9, g: true },
    combined: { n: 100, g: false }
  };
  for (const id of Object.keys(cfg)) {
    T.switchBook(id);
    T.setGroupSize(cfg[id].n);
    T.setBacklogGuard(cfg[id].g);
    ck(T.getGroupSize() === cfg[id].n && guardOn() === cfg[id].g,
      `${id} 设置 groupSize=${cfg[id].n}/guard=${cfg[id].g} 立即生效`,
      `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}`);
  }
  for (const id of Object.keys(cfg)) {
    T.switchBook(id);
    ck(T.getGroupSize() === cfg[id].n,
      `${id} 切回后 groupSize 仍为 ${cfg[id].n}（四书独立）`, String(T.getGroupSize()));
    ck(guardOn() === cfg[id].g,
      `${id} 切回后 backlogGuard 仍为 ${String(cfg[id].g)}（四书独立）`, String(T.getBacklogGuard()));
  }
}

/* ---------------- 2. 备份 v3 往返与旧备份缺字段 ---------------- */
console.log("== 2. 备份 v3 含新字段、往返保留与旧备份兼容 ==");
{
  setup({ groupSize: 37, backlogGuard: false, dailyNew: 1, dayN: 1 });
  const dvBefore = S().dv;
  const before = stateProbe();
  const backup = T.buildExport();
  ck(backup && backup.version === 3, "buildExport 返回 v3", backup && backup.version);
  ck(eq(stateProbe(), before), "buildExport 只读，不修改内存状态");
  {
    const booksOk = ["kaoyan", "cet4", "cet6", "combined"].every(id => {
      const bs = backup.books && backup.books[id] && backup.books[id].settings;
      return bs && typeof bs.groupSize === "number" && typeof bs.backlogGuard === "boolean";
    });
    ck(booksOk, "四书备份 settings 均含 groupSize/backlogGuard");
  }
  ck(backup.books.kaoyan.settings.groupSize === 37
    && backup.books.kaoyan.settings.backlogGuard === false,
    "kaoyan 备份保留 groupSize=37 / guard=false",
    JSON.stringify(backup.books.kaoyan.settings));

  T.setGroupSize(55);
  T.setBacklogGuard(true);
  T.importState(backup);
  ck(T.getGroupSize() === 37 && guardOn() === false,
    "导入备份往返保留 groupSize=37 / guard=false", `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}`);
  ck(S().dv === dvBefore, "导入备份往返 dv 不变", `${String(S().dv)} vs ${String(dvBefore)}`);

  // 旧备份：v3 结构但 settings 缺 groupSize/backlogGuard。
  const oldBackup = clone(backup);
  delete oldBackup.books.kaoyan.settings.groupSize;
  delete oldBackup.books.kaoyan.settings.backlogGuard;
  oldBackup.books.kaoyan.settings.dailyNew = 33;
  oldBackup.activeBook = "kaoyan";
  let oldErr = null;
  try { T.importState(oldBackup); } catch (e) { oldErr = e; }
  ck(!oldErr, "旧备份缺新字段导入不报错", oldErr && oldErr.message);
  ck(T.getGroupSize() === 30 && guardOn() === true,
    "旧备份缺字段导入后为 30/true", `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}`);
  ck(settings().dailyNew === 33, "旧备份其他设置保留（dailyNew=33）", String(settings().dailyNew));
  ck(S().dv === dvBefore, "旧备份导入后 dv 不变", `${String(S().dv)} vs ${String(dvBefore)}`);
}

/* ---------------- 3. 分组切片：0/1/30/31/500 ---------------- */
console.log("== 3. 分组切片 0/1/30/31/500 ==");
{
  const run = due => {
    setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
    const picked = markDue(due);
    T.startSession("main");
    return picked;
  };

  run(0);
  ck(T.Q.length === 0 && T.cur === null, "0 个到期词 → 空组", `Q=${T.Q.length} cur=${String(T.cur)}`);
  ck(info().groupSize === 30 && info().groupTotal === 0 && info().done === 0
    && info().remainingDue === 0 && info().hasMore === false,
    "0 个到期词 → getGroupInfo 全零、hasMore=false", JSON.stringify(info()));
  ck(plan().kind === "main" && plan().groupSize === 30 && typeof plan().startedAt === "number",
    "sessionPlan 含 kind=main/groupSize=30/startedAt", JSON.stringify(plan()));

  let picked = run(1);
  ck(T.Q.length === 1 && T.Q[0] === picked[0], "1 个到期词 → 组张数 1 且为该词",
    `Q=${T.Q.join(",")} / ${picked[0]}`);
  ck(T.getGroupTotal() === 1, "1 个到期词组 → 分母 1", String(T.getGroupTotal()));
  ck(info().remainingDue === 0 && info().hasMore === false,
    "1 个到期词全部入组 → remainingDue 0/hasMore false", JSON.stringify(info()));
  picked = run(30);
  ck(T.Q.length === 30, "30 个到期词 → 组张数 30", String(T.Q.length));
  ck(T.getGroupTotal() === 30 && info().groupTotal === 30, "30 个到期词组 → 分母 30",
    `${String(T.getGroupTotal())}/${String(info().groupTotal)}`);
  ck(info().remainingDue === 0 && info().hasMore === false,
    "30 个到期词全部入组 → remainingDue 0/hasMore false", JSON.stringify(info()));
  ck(picked.every(i => T.Q.includes(i)), "30 个到期词全部在组内且无重复",
    `${new Set(T.Q).size} 个不重复`);
  picked = run(31);
  ck(T.Q.length === 30, "31 个到期词 → 组张数 30（默认每组 30）", String(T.Q.length));
  ck(T.getGroupTotal() === 30 && info().groupTotal === 30, "31 个到期词组 → 分母 30");
  ck(T.countDue() === 31, "31 个到期词中未入组的第 31 个仍计到期", String(T.countDue()));
  ck(!T.Q.includes(picked[30]), "第 31 个到期词不在本组 Q", String(picked[30]));
  ck(info().remainingDue === 1 && info().hasMore === true,
    "31 个到期词 → remainingDue=1、hasMore=true（未入组的不算完成）", JSON.stringify(info()));
  ck(duePool().length === 31, "完整到期池仍为 31", String(duePool().length));
  ck(picked.every(i => duePool().includes(i)), "完整到期池含第 31 个");

  // 走出本组：答完 30 张后继续下一组拿到剩余到期词。
  answerAllKnown();
  ck(T.countDue() === 1, "答完本组 30 张后仍有 1 张到期", String(T.countDue()));
  ck(info().done === 30 && info().groupTotal === 30,
    "本组 30 张全部判定 → done=30/groupTotal=30", JSON.stringify(info()));
  ck(info().remainingDue === 1 && info().hasMore === true,
    "本组答完后 remainingDue=1、hasMore=true", JSON.stringify(info()));
  T.startSession("main");
  ck(T.Q.length === 1 && T.Q[0] === picked[30],
    "继续下一组拿到剩余第 31 个到期词", `Q=${T.Q.join(",")} / ${picked[30]}`);
  ck(info().groupTotal === 1 && info().remainingDue === 0 && info().hasMore === false,
    "下一组 only 1 张、remainingDue 归零", JSON.stringify(info()));

  picked = run(500);
  ck(T.Q.length === 30, "500 个到期词 → 组张数 30", String(T.Q.length));
  ck(T.countDue() === 500, "500 个到期词全部仍计到期", String(T.countDue()));
  ck(info().remainingDue === 470 && info().hasMore === true,
    "500 个到期词 → remainingDue=470、hasMore=true", JSON.stringify(info()));
  ck(T.Q.every(i => picked.includes(i)), "500 个到期词的首组均来自到期池");


  // 重考不放大分母：31 个到期词，首卡判「不会」后队尾追加重考。
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  picked = markDue(31);
  T.startSession("main");
  const retryWord = T.cur;
  T.judge(false);
  T.tryNext();
  ck(T.Q.length === 31 && T.Q[30] === retryWord,
    "判「不会」后队尾追加重考", `Q=${T.Q.length} tail=${String(T.Q[30])}`);
  ck(T.getGroupTotal() === 30 && info().groupTotal === 30,
    "重考不扩大本组分母（仍 30）", `${String(T.getGroupTotal())}/${String(info().groupTotal)}`);
  ck(T.pendingReinforce() === 1, "重考待巩固数 1", String(T.pendingReinforce()));
  ck(T.countDue() === 30, "已判的到期词离开到期池（31→30）", String(T.countDue()));
  ck(info().remainingDue === 1,
    "本组未判到期卡不计入 remainingDue（仍为组外 1）", JSON.stringify(info()));
  ck(!T.Q.slice(0, 30).includes(picked[30]) && T.countDue() > 0,
    "第 31 个到期词不在本组且保持到期");
}

/* ---------------- 3b. 重考两轮 / 撤销 / 熟练后余下到期词仍存在 ---------------- */
console.log("== 3b. 重考两轮、撤销、熟练后剩余到期词 ==");
{
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  markDue(1);
  T.startSession("main");
  const w = T.cur;
  T.judge(false);
  T.tryNext();
  ck(T.cur === w && T.Q.length === 2, "第 1 轮重考回到当前卡", `Q=${T.Q.length}`);
  T.judge(false);
  T.tryNext();
  ck(T.cur === w && T.Q.length === 3, "第 2 轮重考回到当前卡", `Q=${T.Q.length}`);
  ck(T.getGroupTotal() === 1 && info().groupTotal === 1,
    "两轮重考仍不扩大本组分母", `${String(T.getGroupTotal())}/${String(info().groupTotal)}`);
  T.judge(false);
  T.tryNext();
  ck(T.cur === null && T.Q.length === 3, "两轮后不再入队", `Q=${T.Q.length}`);

  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  const picked = markDue(31);
  T.startSession("main");
  const first = T.cur;
  T.judge(true);
  T.tryNext();
  ck(T.countDue() === 30, "判定后该到期词离开到期池", String(T.countDue()));
  T.undo();                                            // 撤销翻页
  ck(T.cur === first && T.phase === "revealed", "撤销翻页回到已揭示的同一张卡",
    `${String(T.cur)} / ${T.phase}`);
  T.undo();                                            // 撤销判定
  ck(T.cur === first && T.verdict === null && T.phase === "recall",
    "再撤销判定回到未判卡", `${String(T.verdict)} / ${T.phase}`);
  ck(T.countDue() === 31, "撤销判定后到期词恢复到期", String(T.countDue()));
  ck(T.getGroupTotal() === 30 && info().remainingDue === 1,
    "撤销不改变本组分母与组外剩余", `${String(T.getGroupTotal())}/${String(info().remainingDue)}`);

  const target = T.Q.find(i => i !== T.cur);
  T.setProficient(target, true);
  ck(!T.buildQueue().duePool.includes(target) && T.countDue() === 30,
    "标熟练后该到期词移出到期池", String(T.countDue()));
  T.setProficient(target, false);
}

/* ---------------- 4. 新词补位 ---------------- */
console.log("== 4. 到期不足按剩余新词额度补位 ==");
{
  setup({ dailyNew: 5, dayN: 0, cap: 0, groupSize: 30 });
  let picked = markDue(3);
  T.startSession("main");
  ck(T.Q.length === 8 && T.getGroupTotal() === 8,
    "3 到期 + 5 新词额度 → 8 张", `Q=${T.Q.length}`);
  ck(picked.every(i => T.Q.includes(i)), "3 个到期词全部入组");
  const freshInQ = T.Q.filter(i => !picked.includes(i));
  ck(freshInQ.length === 5, "补入 5 张新词", String(freshInQ.length));
  ck(freshInQ.every(i => unlearned(i)), "补入的新词均未学且非熟练");

  setup({ dailyNew: 5, dayN: 3, cap: 0, groupSize: 30 });
  picked = markDue(2);
  T.startSession("main");
  ck(T.Q.length === 4, "2 到期 + 剩余新词额度 2 → 4 张", String(T.Q.length));

  setup({ dailyNew: 2, dayN: 2, cap: 0, groupSize: 30 });
  picked = markDue(2);
  T.startSession("main");
  ck(T.Q.length === 2 && T.Q.every(i => picked.includes(i)),
    "day().n 已用满 → 组内无新词", `Q=${T.Q.join(",")}`);

  setup({ dailyNew: 20, dayN: 0, cap: 0, groupSize: 30 });
  T.startSession("main");
  ck(T.Q.length === 20, "0 到期、20 新词额度 → 20 张", String(T.Q.length));

  setup({ dailyNew: 40, dayN: 0, cap: 0, groupSize: 30 });
  T.startSession("main");
  ck(T.Q.length === 30, "0 到期、40 新词额度 → 仍只组 30 张", String(T.Q.length));

  setup({ dailyNew: 2, extra: 3, dayN: 0, cap: 0, groupSize: 30 });
  T.startSession("main");
  ck(T.Q.length === 5, "有效目标 2+3=5 → 5 张新词", String(T.Q.length));

  setup({ dailyNew: 5, dayN: 0, cap: 0, groupSize: 5 });
  picked = markDue(2);
  T.startSession("main");
  ck(T.Q.length === 5, "每组 5 词 → 2 到期 + 3 新词 = 5", String(T.Q.length));
  ck(T.Q.filter(i => !picked.includes(i)).length === 3, "剩余 3 个槽位补新词");
}

/* ---------------- 5. 500 个到期词分多组推进 ---------------- */
console.log("== 5. 500 个到期词分多组推进，总量不减 ==");
{
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  const picked = markDue(500);
  T.startSession("main");
  let entered = 0, groups = 0;
  const groupSizes = [];
  let invariantOK = true;
  while (T.countDue() > 0 && groups < 40) {
    if (T.cur == null) T.startSession("main");
    if (T.cur == null) break;
    const gi = info();
    const len = T.Q.length;
    groups++;
    groupSizes.push(len);
    entered += len;
    if (entered + gi.remainingDue !== 500) invariantOK = false;
    answerAllKnown();
  }
  ck(groups === 17, "500 个到期词按每组 30 分成 17 组", String(groups));
  ck(entered === 500, "逐组入组张数累加正好 500", String(entered));
  ck(invariantOK, "每组「已入组累加 + remainingDue = 500」成立");
  ck(groupSizes[0] === 30 && groupSizes[groupSizes.length - 1] === 20,
    "首组 30 张、末组 20 张", groupSizes.join(","));
  ck(T.countDue() === 0, "全部推进后到期池清空", String(T.countDue()));
  ck(info().remainingDue === 0 && info().hasMore === false,
    "全部完成后 remainingDue=0/hasMore=false", JSON.stringify(info()));
  ck(picked.every(i => T.hasMainProgress(S().progress[i])),
    "500 个到期词都获得了真实判定进度（未被切片丢弃）");
}

/* ---------------- 6. 积压保护 ---------------- */
console.log("== 6. 积压保护条件与边界 ==");
{
  setup({ dailyNew: 5, dayN: 0, cap: 2, used: 0, groupSize: 30, backlogGuard: true });
  let picked = markDue(10);
  let bq = T.buildQueue();
  ck(bq.backlogGuarded === true, "cap=2、10 到期、剩余预算 2 → backlogGuarded=true");
  ck(bq.fresh.length === 0, "积压保护生效时 buildQueue().fresh 为空");
  ck(bq.freshPool.length > 0, "完整未学池不受积压保护截断", String(bq.freshPool.length));
  ck(guarded() === true && guardOn() === true, "isBacklogGuarded()===true 且开关为开");
  T.startSession("main");
  ck(T.Q.length === 10 && T.Q.every(i => picked.includes(i)),
    "积压保护下本组只含到期词（10 张）", `Q=${T.Q.length}`);
  ck(T.getGroupTotal() === 10 && info().remainingDue === 0,
    "积压保护下组内无新词、remainingDue=0", JSON.stringify(info()));

  // 边界：到期量 == 剩余预算 → 不触发。
  setup({ dailyNew: 5, dayN: 0, cap: 2, used: 0, groupSize: 30, backlogGuard: true });
  picked = markDue(2);
  bq = T.buildQueue();
  ck(bq.backlogGuarded === false, "到期 2 == 剩余预算 2 → 不触发积压保护");
  ck(bq.fresh.length === 5, "未触发时 fresh 仍按新词额度补 5", String(bq.fresh.length));
  T.startSession("main");
  ck(T.Q.length === 7, "未触发积压保护 → 2 到期 + 5 新词 = 7 张", String(T.Q.length));

  // 预算用完：到期 2 > 剩余 1 → 触发。
  setup({ dailyNew: 5, dayN: 0, cap: 2, used: 1, groupSize: 30, backlogGuard: true });
  markDue(2);
  bq = T.buildQueue();
  ck(bq.backlogGuarded === true, "到期 2 > 剩余预算 1 → 触发积压保护");
  ck(bq.fresh.length === 0, "该边界下不补新词");

  // cap=0（不限）永不触发。
  setup({ dailyNew: 5, dayN: 0, cap: 0, used: 0, groupSize: 30, backlogGuard: true });
  picked = markDue(10);
  bq = T.buildQueue();
  ck(bq.backlogGuarded === false, "cap=0（不限）→ 不触发积压保护");
  ck(bq.fresh.length === 5, "cap=0 时新词照常补 5");

  // 用户关闭积压保护。
  setup({ dailyNew: 5, dayN: 0, cap: 2, used: 0, groupSize: 30, backlogGuard: true });
  picked = markDue(10);
  T.setBacklogGuard(false);
  ck(guarded() === false && guardOn() === false, "setBacklogGuard(false) 后 isBacklogGuarded=false");
  bq = T.buildQueue();
  ck(bq.backlogGuarded === false && bq.fresh.length === 5,
    "关闭积压保护后不再限制新词（fresh=5）", String(bq.fresh.length));
  T.startSession("main");
  ck(T.Q.length === 15, "关闭后本组 10 到期 + 5 新词 = 15 张", String(T.Q.length));
  T.setBacklogGuard(true);
  ck(guarded() === true, "重新开启积压保护立即生效");
  bq = T.buildQueue();
  ck(bq.fresh.length === 0, "重新开启后 fresh 再次为空");
}

/* ---------------- 7. 纯新词子组 newOnly ---------------- */
console.log("== 7. 积压/暂停下纯新词子组、现场恢复与不嵌套 ==");
{
  // 主组：10 个到期词、cap=2 且已用 2 → 首卡即额度暂停；积压保护生效。
  setup({ dailyNew: 5, dayN: 0, cap: 2, used: 2, groupSize: 30, backlogGuard: true });
  const mainDue = markDue(10);
  T.startSession("main");
  ck(T.isCapPaused() === true && T.cur === mainDue[0],
    "夹具：主组首卡为到期词且额度已用完（暂停）", `${String(T.cur)} / ${String(T.isCapPaused())}`);
  ck(guarded() === true, "夹具：积压保护已触发");
  const mainSnap = {
    Q: T.Q.slice(), qi: T.qi, cur: T.cur, answered: T.answered,
    groupTotal: T.getGroupTotal(), phase: T.phase, verdict: T.verdict,
    plan: T.getPlan(), dayN: dayN()
  };

  const entered = T.startNewOnlySubgroup();
  ck(entered !== false && inNewOnly(), "暂停/积压下 startNewOnlySubgroup 进入子组",
    `${String(entered)} / ${String(T.isNewOnlySubgroup())}`);
  ck(plan().kind === "newOnly", "子组 sessionPlan.kind=newOnly", JSON.stringify(plan().kind));
  ck(T.Q.length === 5, "子组只取剩余 dailyNew 额度 5 张", String(T.Q.length));
  ck(T.Q.every(i => unlearned(i)), "子组只含未学非熟练词");
  ck(T.Q.every(i => !mainSnap.Q.slice(mainSnap.qi).includes(i)),
    "子组不含原主组未答队列词");
  ck(T.countDue() === 10, "进入子组不改变主组到期池（仍 10）", String(T.countDue()));
  ck(T.startNewOnlySubgroup() !== true && inNewOnly(),
    "子组内再次进入被拒绝（不嵌套）", String(T.isNewOnlySubgroup()));

  const subWord = T.cur;
  const nBefore = dayN();
  T.judge(true);
  ck(hasProg(subWord), "子组新词判定写入主进度");

  const ended = T.endNewOnlySubgroup();
  ck(ended !== false && inNewOnly() === false, "endNewOnlySubgroup 结束子组", String(ended));
  ck(eq(T.Q.slice(), mainSnap.Q), "结束后主组 Q 完整恢复", `${T.Q.length} vs ${mainSnap.Q.length}`);
  ck(T.qi === mainSnap.qi && T.cur === mainSnap.cur && T.answered === mainSnap.answered,
    "结束后回到原暂停现场（qi/cur/answered 一致）",
    `${T.qi}/${String(T.cur)}/${T.answered} vs ${mainSnap.qi}/${String(mainSnap.cur)}/${mainSnap.answered}`);
  ck(T.getGroupTotal() === mainSnap.groupTotal, "结束后主组分母不变",
    `${String(T.getGroupTotal())} vs ${String(mainSnap.groupTotal)}`);
  ck(plan().kind === "main" && plan().groupSize === mainSnap.plan.groupSize,
    "结束后恢复主组 sessionPlan", `${String(plan().kind)}/${String(plan().groupSize)}`);
  ck(hasProg(subWord) && dayN() === nBefore + 1,
    "子组产生的进度/日统计在结束后保留");
  ck(T.isCapPaused() === true, "结束后原组仍为额度暂停（未伪装完成）");
  ck(T.endNewOnlySubgroup() === false, "不在子组时 endNewOnlySubgroup 返回 false");

  // 再次进入按剩余额度取词。
  T.startNewOnlySubgroup();
  ck(T.Q.length === 4, "再次进入按剩余 dailyNew（5-1=4）取词", String(T.Q.length));
  T.endNewOnlySubgroup();

  // 子组新词「不会」重考仍受当日复习上限：cap 已用尽时被拦截。
  setup({ dailyNew: 1, dayN: 0, cap: 1, used: 1, groupSize: 30, backlogGuard: true });
  markDue(10);
  T.startSession("main");
  ck(T.isCapPaused() === true && guarded() === true, "夹具：预算用尽 + 积压保护");
  const pausedSnap = {
    Q: T.Q.slice(), qi: T.qi, cur: T.cur, answered: T.answered,
    groupTotal: T.getGroupTotal(), phase: T.phase, verdict: T.verdict
  };
  T.startNewOnlySubgroup();
  ck(inNewOnly() === true, "cap 用尽时仍可进入纯新词子组", String(T.isNewOnlySubgroup()));
  ck(T.Q.length === 1, "剩余新词额度 1 → 子组 1 张", String(T.Q.length));
  const w = T.cur;
  T.judge(false);
  ck(T.verdict === false && hasProg(w), "子组新词首次「不会」正常判定");
  ck(T.getReviewLedger().used === 1, "新词首次「不会」不消费复习额度",
    JSON.stringify(T.getReviewLedger()));
  T.tryNext();
  ck(T.cur === w && T.phase === "recall", "「不会」后同一词队尾重考回到当前卡",
    `${String(T.cur)} / ${T.phase}`);
  ck(T.isCapPaused() === true, "重考卡因预算用尽进入暂停", String(T.isCapPaused()));
  const progBefore = clone(S().progress[w]);
  const usedBefore = T.getReviewLedger().used;
  const answeredBefore = T.answered;
  T.judge(true);
  ck(T.verdict === null, "预算用尽时子组重考判定被拦截（verdict 仍为 null）", String(T.verdict));
  ck(T.getReviewLedger().used === usedBefore, "被拦截的重考不消费额度",
    `${String(T.getReviewLedger().used)} vs ${String(usedBefore)}`);
  ck(T.answered === answeredBefore, "被拦截的重考不增加已答数",
    `${String(T.answered)} vs ${String(answeredBefore)}`);
  ck(progSig(w) === JSON.stringify(progBefore), "被拦截的重考不写 progress");
  T.endNewOnlySubgroup();
  ck(inNewOnly() === false, "子组结束后回到暂停主组");

  ck(T.answered === pausedSnap.answered && T.getGroupTotal() === pausedSnap.groupTotal,
    "返回后原主组已答数/分母一致",
    `${T.answered}/${T.getGroupTotal()} vs ${pausedSnap.answered}/${pausedSnap.groupTotal}`);
  ck(T.isCapPaused() === true, "返回后原主组仍暂停");

  // 无剩余计划新词额度：拒绝进入。
  setup({ dailyNew: 2, dayN: 2, cap: 2, used: 0, groupSize: 30, backlogGuard: true });
  markDue(10);
  T.startSession("main");
  ck(guarded() === true, "夹具：到期 10 > 剩余预算 2");
  const noQuotaR = T.startNewOnlySubgroup();
  ck(noQuotaR !== true && inNewOnly() === false,
    "剩余 dailyNew=0 时拒绝进入纯新词子组", `${String(noQuotaR)} / ${String(T.isNewOnlySubgroup())}`);
}

/* ---------------- 8. 跨天 / 刷新 / 切书 ---------------- */
console.log("== 8. 跨天、刷新与切书 ==");
{
  // 刷新不重建当前卡。
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  markDue(3);
  T.startSession("main");
  T.judge(true);
  T.tryNext();
  const snapQ = T.Q.slice(), snapCur = T.cur, snapQi = T.qi, snapPlan = T.getPlan();
  T.refreshForResume();
  ck(eq(T.Q.slice(), snapQ), "refreshForResume 不重建当前组 Q", `${T.Q.length} vs ${snapQ.length}`);
  ck(T.cur === snapCur && T.qi === snapQi, "refreshForResume 不重建当前卡",
    `${String(T.cur)}/${T.qi} vs ${String(snapCur)}/${snapQi}`);
  ck(T.getPlan().startedAt === snapPlan.startedAt && T.getPlan().groupSize === snapPlan.groupSize,
    "refreshForResume 保留本组冻结 sessionPlan");

  // 跨天：额度刷新，下一组按新一天额度补词。
  setup({ dailyNew: 2, dayN: 2, cap: 0, groupSize: 30 });
  T.startSession("main");
  const oldDay = dayStr();
  advanceDay();
  T.refreshForResume();
  ck(S().reviewDay.d === dayStr() && S().reviewDay.used === 0,
    "跨天后复习台账归今日 0", JSON.stringify(S().reviewDay));
  T.startSession("main");
  ck(T.Q.length === 2, "跨天后下一组按新一天额度补 2 张", String(T.Q.length));
  ck(T.getGroupTotal() === 2 && dayN() === 0, "跨天新组分母 2、当日已学从 0 起算",
    `${String(T.getGroupTotal())}/${String(dayN())}`);

  // 跨天后余下到期词仍存在。
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  const picked = markDue(31);
  T.startSession("main");
  answerAllKnown();
  advanceDay();
  T.refreshForResume();
  ck(T.countDue() === 1, "跨天后剩余到期词仍到期", String(T.countDue()));
  T.startSession("main");
  ck(T.Q.includes(picked[30]), "跨天后下一组仍能拿到剩余到期词",
    `Q=${T.Q.join(",")} / ${picked[30]}`);
  // 跨天后新一天有 1 个新词额度：剩余到期词占首张，再补 1 张新词。
  ck(T.Q.length === 2 && T.Q[0] === picked[30] && unlearned(T.Q[1]),
    "跨天新组=1 剩余到期 + 1 新一天新词，到期优先", `Q=${T.Q.join(",")}`);

  // 切书后各自 groupSize / 积压状态独立。
  setup({ book: "kaoyan", dailyNew: 5, dayN: 0, cap: 2, used: 0, groupSize: 6, backlogGuard: false });
  markDue(10);
  T.startSession("main");
  ck(T.getGroupSize() === 6 && guardOn() === false && guarded() === false,
    "考研书 groupSize=6、积压保护关闭", `${String(T.getGroupSize())}/${String(T.isBacklogGuarded())}`);
  setup({ book: "cet4", dailyNew: 5, dayN: 0, cap: 2, used: 0, groupSize: 7, backlogGuard: true });
  markDue(10);
  T.startSession("main");
  ck(T.getGroupSize() === 7 && guardOn() === true && guarded() === true,
    "四级书 groupSize=7、积压保护生效", `${String(T.getGroupSize())}/${String(T.isBacklogGuarded())}`);
  ck(T.Q.length === 7, "四级书按每组 7 张组队", String(T.Q.length));
  T.switchBook("kaoyan");
  ck(T.getGroupSize() === 6 && guardOn() === false && guarded() === false,
    "切回考研书后 groupSize/积压状态独立保持",
    `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}/${String(T.isBacklogGuarded())}`);
  T.switchBook("cet4");
  ck(T.getGroupSize() === 7 && guardOn() === true && guarded() === true,
    "切回四级书后 groupSize/积压状态独立保持",
    `${String(T.getGroupSize())}/${String(T.getBacklogGuard())}/${String(T.isBacklogGuarded())}`);
}

/* ---------------- 9. 兼容：buildQueue 既有字段语义 ---------------- */
console.log("== 9. buildQueue 既有 due/fresh 语义兼容 ==");
{
  setup({ dailyNew: 5, dayN: 0, cap: 0, groupSize: 30 });
  const picked = markDue(3);
  const before = stateProbe();
  const bq = T.buildQueue();
  ck(Array.isArray(bq.due) && Array.isArray(bq.fresh), "buildQueue 返回 due/fresh 数组");
  ck(bq.due.length === 3 && bq.due.length === T.countDue(),
    "dued 仍为全部到期词", `${String(bq.due.length)} vs ${String(T.countDue())}`);
  ck(bq.fresh.length === 5, "fresh 仍按新词额度截断为 5", String(bq.fresh.length));
  ck(bq.duePool.length === 3 && bq.freshPool.length > 5,
    "duePool 完整 3、freshPool 完整未截断", `${String(bq.duePool.length)}/${String(bq.freshPool.length)}`);
  ck(bq.fresh.every(i => bq.freshPool.includes(i)), "fresh 是 freshPool 的按额度子集");
  ck(bq.fresh.every(i => !bq.due.includes(i)), "due 与 fresh 不重叠");
  ck(eq(stateProbe(), before), "buildQueue 只读，不修改状态");
  const bq2 = T.buildQueue();
  ck(JSON.stringify(bq) === JSON.stringify(bq2), "同会话 buildQueue 结果可复现");
  T.startSession();
  ck(T.Q.length === 8 && T.getGroupTotal() === 8,
    "无参 startSession 等价 main：3 到期 + 5 新词 = 8", `Q=${T.Q.length}`);
  ck(T.getPlan().kind === "main", "无参 startSession 的 plan.kind===main");
  ck(picked.every(i => T.Q.includes(i)), "既有调用方仍拿到全部到期词（未超组大小时）");
}

/* ---------------- 10. 本组 groupSize 冻结（下一组才生效） ---------------- */
console.log("== 10. 每组词数冻结：设置只影响下一组 ==");
{
  setup({ dailyNew: 1, dayN: 1, cap: 0, groupSize: 30 });
  markDue(2);
  T.startSession("main");
  ck(info().groupSize === 30 && plan().groupSize === 30,
    "本组开始时 groupSize=30", `${String(info().groupSize)}/${String(plan().groupSize)}`);
  const r = T.setGroupSize(5);
  ck(r && r.ok === true && T.getGroupSize() === 5, "组内改 groupSize=5 立即保存", JSON.stringify(r));
  ck(info().groupSize === 30 && plan().groupSize === 30,
    "本组 groupSize 冻结为 30（不追溯）", `${String(info().groupSize)}/${String(plan().groupSize)}`);
  T.startSession("main");
  ck(info().groupSize === 5 && plan().groupSize === 5,
    "下一组按新 groupSize=5 建组", `${String(info().groupSize)}/${String(plan().groupSize)}`);
}

/* ---------------- 11. 额度暂停态主动结束本组：组尾剩余到期不得少算 ---------------- */
console.log("== 11. cap 暂停结束本组后：remainingDue = 实际到期数（不重复扣本组未判卡） ==");
{
  // cap=2 + 11 张到期 + groupSize=10：判 2 张后进入暂停，用户主动「结束本组」。
  setup({ dailyNew: 0, dayN: 0, cap: 2, groupSize: 10 });
  markDue(11);
  T.startSession("main");
  ck(T.Q.length === 10, "首组入 10 张（剩余 1 张本组外）", String(T.Q.length));
  T.judge(true); T.tryNext(true);
  T.judge(true); T.tryNext(true);
  ck(T.isCapPaused() === true, "判 2 张后进入额度暂停", String(T.isCapPaused()));
  const endBtn = document.querySelector("#capPauseEnd");
  ck(!!(endBtn && typeof endBtn.onclick === "function"), "暂停面板提供「结束本组」按钮", String(!!endBtn));
  endBtn.onclick();
  ck(T.cur == null, "结束本组后进入收尾页", String(T.cur));
  const dueNow = T.countDue();
  ck(dueNow === 9, "结束本组后仍到期 9 张（2 张已判 → 到期时间后移）", String(dueNow));
  const gi = info();
  ck(gi.remainingDue === 9,
    "组尾剩余到期 = 9（不得把已结束组内未判的 8 张重复扣掉）", JSON.stringify(gi));
  ck(gi.hasMore === true, "仍有到期 → hasMore=true", JSON.stringify(gi));
  const footerText = String(document.querySelector("#groupFooterText").innerHTML || "");
  ck(/剩余到期\s*<b>9<\/b>/.test(footerText), "组尾文案显示剩余到期 9 个", footerText);
  ck(/本组已暂停|额度已用完/.test(footerText), "组尾明确写「本组已暂停/额度已用完」，不伪装完成", footerText);
  // 继续下一组应把剩余 9 张到期词拿回来。
  T.startSession("main");
  ck(T.countDue() === 9 || T.Q.length === 9,
    "继续下一组带回剩余到期词", `due=${T.countDue()} Q=${T.Q.length}`);
  ck(T.Q.every(i => { const p = S().progress[i]; return p && p[0] < 11; }), "下一组队列均为主学习过且未掌握的卡");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
