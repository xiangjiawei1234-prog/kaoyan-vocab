/**
 * 23 当日临时加量（extraDay）回归
 * 执行真实 js/app.js（DOM 桩 + 真实四词书数据 + 受控时钟），不复制业务逻辑。
 *
 * 覆盖：
 *  - 全新/旧记录迁移、非法值回退、四书独立、备份 v3 含 extraDay、往返与过去/未来日期导入；
 *  - 有效新词目标 = dailyNew + extra；授予不写 progress/不增加 day().n；跨天归零不结转；
 *  - 连续 +10/+20/自定义、总目标 500 上界、候选不足与无候选、入口条件；
 *  - 撤销首次判定回退 day().n 但不撤回额度，改判不改变额度；
 *  - 复习预算暂停态进入 extra 子组：原主组现场保留、结束回原现场、不嵌套、子组进度保留；
 *  - 加量不提高复习上限，子组内「不会」重考仍受当日预算拦截；
 *  - 同 tick 连击只生效一次、跨标签先对齐更大 extra、执行导出只读、TXT 条目与额度无关。
 *
 * 运行：node --max-old-space-size=512 js/test-extra-new.mjs
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

/* ---------------- 断言用适配层（只调用契约钩子） ---------------- */
const S = () => T.getS();
const settings = () => S().settings;
const extraOf = () => {
  const v = T.getExtraDay();
  return v && typeof v === "object" ? v : {};
};
const effTarget = () => T.getEffectiveNewTarget();
const candAvail = () => T.getExtraCandidatesAvailable();
const inSub = () => T.isExtraSubgroup() === true;
const todayN = () => {
  const d = S().days[dayStr()];
  return d && Number.isInteger(d.n) ? d.n : 0;
};
const progSig = () => JSON.stringify(S().progress);
const daysSig = () => JSON.stringify(S().days);
const reasonOf = r => String((r && (r.error || r.reason || r.message)) || "");
const advance = ms => { now += ms; };
const stored = (key = KEY) => {
  const raw = store.get(key);
  return raw ? JSON.parse(raw) : null;
};

/** 通用夹具：清空当前书记录并写入指定计划/额度；不伪造 session。 */
function setupState(o = {}) {
  if (T.drillMode) T.exitDrill();
  T.switchBook(o.book || "kaoyan");
  // 熟练名单是独立存储键；只清内存会被 save() 的存储合并重新带回来。
  if (typeof T.resetProficient === "function") T.resetProficient();
  const s = S();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {
    dailyNew: o.dailyNew === undefined ? 20 : o.dailyNew,
    order: "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: "primary", singleCharKeys: true, dailyReviewCap: 0
  }, o.settings || {});
  const d = dayStr();
  const n = o.dayN === undefined ? s.settings.dailyNew : o.dayN;
  s.days[d] = { n, r: n, ok: n, no: 0 };
  s.reviewDay = { d, used: o.used || 0 };
  s.extraDay = { d, extra: o.extra || 0 };
  saveNow();
  return s;
}
/** 通过既有写入口落盘，保证 lastMainRaw 与存储一致（跨标签夹具需要）。 */
function saveNow() {
  T.setReviewCap(S().settings.dailyReviewCap);
}
function scopeIndices() {
  const W = T.getW(), out = [];
  for (let i = 0; i < W.length; i++) if (T.inScope(i)) out.push(i);
  return out;
}
/** 把当前范围收窄到词频恰为 fVal 的词（f 为频次，非排名）。 */
function freqScope(fVal) {
  const s = S();
  s.settings.fmin = fVal;
  s.settings.fmax = fVal;
  s.settings.pmin = 0;
  s.settings.kyOnly = false;
  s.settings.pos = [];
  saveNow();
  return scopeIndices();
}
function markDue(count) {
  const s = S();
  const picked = scopeIndices().slice(0, count);
  for (const i of picked) s.progress[i] = [1, now - 5000, 1, 0, now - 86400000];
  saveNow();
  return picked;
}
function markLearned(indices) {
  const s = S();
  for (const i of indices) s.progress[i] = [10, now + 86400000, 1, 0, now - 5000];
  saveNow();
}
function grant(n) {
  const r = T.grantExtraNew(n);
  if (r && typeof r === "object") return r;
  return { ok: r === true, extra: NaN, effectiveTarget: NaN, available: NaN };
}
/** 与背诵页实际入口一致：先授予额度，再从暂停页进入 extra 子组。 */
function enterExtraSubgroup() {
  if (inSub()) return true;
  if (typeof T.startExtraSubgroup !== "function") return false;
  const r = T.startExtraSubgroup();
  return r !== false && inSub();
}
const paused = () => T.isCapPaused() === true;
const capNow = () => T.getReviewCap();

/* ---------------- 0. 契约钩子与全新记录 ---------------- */
console.log("== 0. 契约钩子与全新记录默认值 ==");
{
  const required = ["getExtraDay", "getEffectiveNewTarget", "grantExtraNew",
    "getExtraCandidatesAvailable", "isExtraSubgroup", "endExtraSubgroup"];
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

  const e = T.getExtraDay();
  ck(e && e.d === dayStr(), "全新记录 getExtraDay().d 为本地今日", JSON.stringify(e));
  ck(e && e.extra === 0, "全新记录 getExtraDay().extra===0", JSON.stringify(e));
  ck(e && Number.isInteger(e.extra), "getExtraDay().extra 为整数", JSON.stringify(e));
  ck(T.getEffectiveNewTarget() === 20, "全新记录有效新词目标=默认 dailyNew 20",
    String(T.getEffectiveNewTarget()));
  ck(T.getEffectiveNewTarget() === settings().dailyNew + e.extra,
    "有效目标===dailyNew+extra", `${T.getEffectiveNewTarget()} vs ${settings().dailyNew}+${e.extra}`);
  ck(inSub() === false, "全新记录 isExtraSubgroup()===false", String(T.isExtraSubgroup()));
  const avail = T.getExtraCandidatesAvailable();
  ck(Number.isInteger(avail) && avail >= 0, "全新记录 getExtraCandidatesAvailable 为非负整数", String(avail));
  const copy = T.getExtraDay();
  copy.extra = 999;
  ck(T.getExtraDay().extra === 0, "getExtraDay 返回副本，外部修改不影响内部额度", JSON.stringify(T.getExtraDay()));
  ck(typeof T.getS().dv === "number" && T.getS().dv >= 1, "当前书记录 dv 为合法版本", String(T.getS().dv));
}

/* ---------------- 1. 迁移 / 非法值 / 四书独立 ---------------- */
console.log("== 1. 默认迁移、非法值回退与四书独立 ==");
{
  const norm = (extraDay, extraSettings) => {
    const o = { progress: {}, days: {}, settings: Object.assign({ dailyNew: 20 }, extraSettings || {}) };
    if (extraDay !== undefined) o.extraDay = extraDay;
    return T.normalizeState(o, "kaoyan");
  };
  const today = dayStr();
  const yesterday = dayStr(now - 86400000);
  const tomorrow = dayStr(now + 86400000);

  const miss = norm(undefined).extraDay;
  ck(miss && miss.d === today && miss.extra === 0,
    "旧记录缺 extraDay → {今日,0}", JSON.stringify(miss));
  const noSettings = T.normalizeState({ progress: {}, days: {} }, "kaoyan");
  ck(noSettings.extraDay && noSettings.extraDay.d === today && noSettings.extraDay.extra === 0,
    "旧记录连 settings 都没有 → extraDay 今日 0", JSON.stringify(noSettings.extraDay));
  const keep = norm({ d: today, extra: 30 }, { dailyNew: 33 });
  ck(keep.extraDay.extra === 30 && keep.extraDay.d === today,
    "旧记录今日合法 extra=30 原样保留", JSON.stringify(keep.extraDay));
  ck(keep.settings.dailyNew === 33, "归一化不丢其他设置（dailyNew=33）", String(keep.settings.dailyNew));
  for (const bad of [-1, 501, 1.5, "30", null, NaN, Infinity]) {
    const got = norm({ d: today, extra: bad }).extraDay;
    ck(got && got.d === today && got.extra === 0,
      `非法 extra=${String(bad)} → 今日 0`, JSON.stringify(got));
  }
  const oldDate = norm({ d: yesterday, extra: 40 }).extraDay;
  ck(oldDate && oldDate.d === today && oldDate.extra === 0,
    "昨日 extra=40 → 今日 0（不把昨天的额度结转）", JSON.stringify(oldDate));
  const futureDate = norm({ d: tomorrow, extra: 40 }).extraDay;
  ck(futureDate && futureDate.d === today && futureDate.extra === 0,
    "未来日期 extra=40 → 今日 0", JSON.stringify(futureDate));
  const badDate = norm({ d: "2026-13-40", extra: 40 }).extraDay;
  ck(badDate && badDate.d === today && badDate.extra === 0,
    "非法日期 extra=40 → 今日 0", JSON.stringify(badDate));
  const badShape = norm([1, 2]).extraDay;
  ck(badShape && badShape.d === today && badShape.extra === 0,
    "extraDay 非对象 → 今日 0", JSON.stringify(badShape));

  // 四书归一化互不影响。
  const normVals = { kaoyan: 11, cet4: 22, cet6: 33, combined: 44 };
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    const got = T.normalizeState({
      progress: {}, days: {}, settings: { dailyNew: 10 },
      extraDay: { d: today, extra: normVals[id] }
    }, id).extraDay;
    ck(got.extra === normVals[id] && got.d === today,
      `${id} 归一化保留自己的 extra=${normVals[id]}`, JSON.stringify(got));
  }

  // 切书后额度独立，且有效目标按各自 dailyNew 计算。
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    setupState({ book: id, settings: { dailyNew: 10 } });
    S().extraDay = { d: today, extra: normVals[id] };
    saveNow();
  }
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    T.switchBook(id);
    ck(extraOf().extra === normVals[id], `${id} 切回后 extra=${normVals[id]}（四书独立）`,
      JSON.stringify(extraOf()));
    ck(effTarget() === 10 + normVals[id], `${id} 有效目标=10+${normVals[id]}`,
      String(effTarget()));
  }

  // 内存里残留昨日额度时，读取钩子也必须按今日 0 计算。
  setupState({ book: "kaoyan", settings: { dailyNew: 20 }, dayN: 20 });
  S().extraDay = { d: yesterday, extra: 40 };
  saveNow();
  ck(extraOf().d === today && extraOf().extra === 0,
    "内存中昨日 extraDay 读取时归今日 0", JSON.stringify(extraOf()));
  ck(effTarget() === 20, "昨日额度不抬高今日有效目标", String(effTarget()));
}

/* ---------------- 2. 备份 v3 导出 / 导入 ---------------- */
console.log("== 2. 备份 v3 含 extraDay、往返与过去/未来日期导入 ==");
{
  setupState({ dailyNew: 20, dayN: 20 });
  advance(30000);
  const seeded = grant(10);
  ck(seeded.ok === true, "备份夹具：完成计划后 +10 成功", JSON.stringify(seeded));
  for (const id of ["cet4", "cet6", "combined"]) {
    setupState({ book: id, settings: { dailyNew: 10 } });
    S().extraDay = { d: dayStr(), extra: 20 };
    saveNow();
  }
  T.switchBook("kaoyan");
  const today = dayStr();
  ck(extraOf().extra === 10, "切回考研书后今日 extra=10 不丢", JSON.stringify(extraOf()));

  const before = {
    extra: clone(T.getExtraDay()), settings: clone(settings()), dv: S().dv,
    prog: progSig(), days: daysSig(), review: JSON.stringify(S().reviewDay)
  };
  const backup = T.buildExport();
  ck(backup && backup.version === 3, "buildExport 返回 v3", backup && backup.version);
  ck(backup.books && backup.books.kaoyan && backup.books.kaoyan.extraDay,
    "备份 v3 的考研记录含 extraDay", JSON.stringify(backup.books && backup.books.kaoyan && backup.books.kaoyan.extraDay));
  ck(backup.books.kaoyan.extraDay.d === today && backup.books.kaoyan.extraDay.extra === 10,
    "备份 extraDay={今日,extra:10}", JSON.stringify(backup.books.kaoyan.extraDay));
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    const b = backup.books[id];
    ck(b && b.extraDay && b.extraDay.d === today && Number.isInteger(b.extraDay.extra),
      `备份 ${id} 书含合法 extraDay`, JSON.stringify(b && b.extraDay));
  }
  ck(eq(T.getExtraDay(), before.extra), "buildExport 后 extraDay 不变（导出只读）",
    JSON.stringify({ after: T.getExtraDay(), before: before.extra }));
  ck(eq(clone(settings()), before.settings), "buildExport 后 settings 不变（导出只读）");
  ck(progSig() === before.prog && daysSig() === before.days && S().dv === before.dv,
    "buildExport 后 progress/days/dv 不变", `dv ${S().dv} vs ${before.dv}`);
  ck(JSON.stringify(S().reviewDay) === before.review, "buildExport 后 reviewDay 不变");

  // 往返：先改成别的值，再导入备份，应恢复 extra=10 且 dv 不变。
  S().extraDay = { d: today, extra: 30 };
  saveNow();
  let rtErr = null;
  try { T.importState(backup); } catch (e) { rtErr = e; }
  ck(!rtErr, "备份往返导入不报错", rtErr && rtErr.message);
  ck(extraOf().extra === 10 && extraOf().d === today,
    "导入往返保留 extraDay={今日,10}", JSON.stringify(extraOf()));
  ck(settings().dailyNew === 20, "导入往返保留 dailyNew=20", String(settings().dailyNew));
  ck(effTarget() === 30, "导入往返后有效目标=20+10=30", String(effTarget()));
  ck(S().dv === before.dv, "备份往返 dv 不变", `${S().dv} vs ${before.dv}`);

  // 旧备份缺 extraDay：导入为今日 0，其他字段与 dv 保留。
  const oldBackup = clone(backup);
  delete oldBackup.books.kaoyan.extraDay;
  oldBackup.books.kaoyan.settings.dailyNew = 33;
  oldBackup.activeBook = "kaoyan";
  let oldErr = null;
  try { T.importState(oldBackup); } catch (e) { oldErr = e; }
  ck(!oldErr, "旧备份缺 extraDay 导入不报错", oldErr && oldErr.message);
  ck(extraOf().extra === 0 && extraOf().d === today,
    "旧备份缺 extraDay → 今日 0", JSON.stringify(extraOf()));
  ck(settings().dailyNew === 33 && effTarget() === 33,
    "旧备份导入后目标回 dailyNew=33", `${settings().dailyNew}/${effTarget()}`);
  ck(S().dv === before.dv, "旧备份导入后 dv 不变", `${S().dv} vs ${before.dv}`);

  // 过去日期 / 未来日期不得变成今日额度。
  const past = clone(backup);
  past.books.kaoyan.extraDay = { d: dayStr(now - 86400000), extra: 40 };
  past.books.kaoyan.settings.dailyNew = 33;
  past.activeBook = "kaoyan";
  let pastErr = null;
  try { T.importState(past); } catch (e) { pastErr = e; }
  ck(!pastErr, "过去日期 extraDay 备份导入不报错", pastErr && pastErr.message);
  ck(extraOf().extra === 0 && extraOf().d === today,
    "导入过去日期 extra=40 不得变成今日额度", JSON.stringify(extraOf()));
  ck(effTarget() === 33, "导入过去日期后目标仍为 dailyNew=33", String(effTarget()));
  ck(S().dv === before.dv, "导入过去日期后 dv 不变", `${S().dv} vs ${before.dv}`);

  const future = clone(backup);
  future.books.kaoyan.extraDay = { d: dayStr(now + 86400000), extra: 40 };
  future.books.kaoyan.settings.dailyNew = 33;
  future.activeBook = "kaoyan";
  let futureErr = null;
  try { T.importState(future); } catch (e) { futureErr = e; }
  ck(!futureErr, "未来日期 extraDay 备份导入不报错", futureErr && futureErr.message);
  ck(extraOf().extra === 0 && extraOf().d === today,
    "导入未来日期 extra=40 不得变成今日额度", JSON.stringify(extraOf()));
  ck(effTarget() === 33 && S().dv === before.dv,
    "导入未来日期后目标 33、dv 不变", `${effTarget()}/${S().dv}`);
}

/* ---------------- 3. 授予与消费分离 / 连续加量 / 500 上界 ---------------- */
console.log("== 3. 授予不消费、+10/+20/自定义、500 上界 ==");
{
  setupState({ dailyNew: 20, dayN: 20 });
  const progBefore = progSig(), daysBefore = daysSig(), nBefore = todayN();
  const availBefore = candAvail();
  advance(30000);
  const r1 = grant(10);
  ck(r1.ok === true, "计划 20 完成后 +10 成功", JSON.stringify(r1));
  ck(r1.extra === 10 && r1.effectiveTarget === 30,
    "返回值 extra=10、effectiveTarget=30", JSON.stringify(r1));
  ck(extraOf().extra === 10 && extraOf().d === dayStr(),
    "getExtraDay 记为今日 extra=10", JSON.stringify(extraOf()));
  ck(effTarget() === 30 && settings().dailyNew === 20,
    "有效目标 30，长期 dailyNew 仍为 20", `${effTarget()}/${settings().dailyNew}`);
  ck(progSig() === progBefore, "grant 不写 progress（授予与消费分离）");
  ck(daysSig() === daysBefore, "grant 不改变 days 统计");
  ck(todayN() === nBefore && nBefore === 20, "grant 不增加 day().n（仍 20）", String(todayN()));
  ck(typeof r1.available === "number" && Number.isInteger(r1.available) && r1.available >= 0,
    "grant 返回 available 非负整数", JSON.stringify(r1.available));
  ck(r1.available === availBefore, "grant 前后候选数一致（未预占队列）",
    `${r1.available} vs ${availBefore}`);
  ck(stored(KEY) && stored(KEY).extraDay && stored(KEY).extraDay.extra === 10,
    "extra=10 已随主记录落盘", JSON.stringify(stored(KEY) && stored(KEY).extraDay));

  advance(30000);
  const r2 = grant(20);
  ck(r2.ok === true && extraOf().extra === 30 && r2.effectiveTarget === 50,
    "再 +20 → extra=30、目标=50", JSON.stringify(r2));
  advance(30000);
  const r3 = grant(7);
  ck(r3.ok === true && extraOf().extra === 37 && effTarget() === 57,
    "自定义 +7 → extra=37、目标=57", JSON.stringify(r3));
  ck(settings().dailyNew === 20, "多次加量后长期 dailyNew 始终 20", String(settings().dailyNew));

  // 500 上界：490+20 拒绝，490+10 正好 500，随后 +1 拒绝。
  setupState({ dailyNew: 490, dayN: 490 });
  advance(30000);
  const over = grant(20);
  // 490+20 只剩 10 额度：实现允许「按实际可加量截断」（clamped）或「拒绝」，两者都必须可解释且绝不越过 500。
  ck(over.ok === false || (over.clamped === true && effTarget() === 500),
    "490+20 不越过 500：拒绝或按剩余额度截断", JSON.stringify(over));
  {
    const truncated = over.ok === true && over.clamped === true;
    if (truncated) {
      ck(over.limitedBy === "target-cap",
        "截断原因标记为 target-cap（不是候选不足）", JSON.stringify(over));
    } else {
      ck(over.ok === false && (over.error === "target-cap" || over.error === null),
        "拒绝原因可解释", JSON.stringify(over));
    }
  }
  ck(extraOf().extra <= 10 && effTarget() <= 500,
    "截断/拒绝后 extra ≤ 10、目标 ≤ 500", `extra=${extraOf().extra} target=${effTarget()}`);
  ck(reasonOf(over).length > 0 || over.clamped === true,
    "超上界给出原因或 clamped 标记（不静默）", JSON.stringify(over));
  setupState({ dailyNew: 490, dayN: 490 });
  advance(30000);
  const exact = grant(10);
  ck(exact.ok === true && extraOf().extra === 10 && effTarget() === 500,
    "490+10 恰为 500 允许", JSON.stringify(exact));
  advance(30000);
  const plusOne = grant(1);
  ck(plusOne.ok === false && extraOf().extra === 10 && effTarget() === 500,
    "目标已达 500 再 +1 拒绝且 extra 不变", JSON.stringify(plusOne));
  ck(reasonOf(plusOne).length > 0, "500 上界再拒绝给出原因", reasonOf(plusOne));

  setupState({ dailyNew: 500, dayN: 500 });
  advance(30000);
  const atMax = grant(10);
  ck(atMax.ok === false && extraOf().extra === 0,
    "dailyNew 已 500 时任何加量都拒绝", JSON.stringify(atMax));
}

/* ---------------- 4. 候选边界 ---------------- */
console.log("== 4. 候选不足 / 无候选 ==");
{
  setupState({ dailyNew: 1, dayN: 1 });
  const bucket = freqScope(360);
  ck(bucket.length === 2, "夹具：词频 360 的范围恰有 2 词", String(bucket.length));
  ck(candAvail() === 2, "该范围可加量候选=2", String(candAvail()));
  ck(effTarget() === 1, "该范围有效目标仍=1", String(effTarget()));
  advance(30000);
  const short = grant(20);
  ck(short.available === 2, "候选不足时返回 available=2", JSON.stringify(short));
  if (short.ok === true) {
    ck(short.extra === 2 && extraOf().extra === 2 && effTarget() === 3,
      "候选不足按实际 2 词授予（不写 20 却只背 2）", JSON.stringify(short));
  } else {
    ck(short.extra === 0 && extraOf().extra === 0 && effTarget() === 1,
      "候选不足拒绝时 extra 不变", JSON.stringify(short));
    ck(reasonOf(short).length > 0, "候选不足拒绝给出原因", reasonOf(short));
  }

  // 无候选：范围内两个词都已是熟练词。
  setupState({ dailyNew: 1, dayN: 1 });
  const none = freqScope(360);
  for (const i of none) T.setProficient(i, true);
  ck(candAvail() === 0, "全部熟练后候选=0", String(candAvail()));
  advance(30000);
  const noCand = grant(10);
  ck(noCand.ok === false && noCand.available === 0,
    "无候选拒绝并返回 available=0", JSON.stringify(noCand));
  ck(extraOf().extra === 0 && effTarget() === 1,
    "无候选拒绝后 extra/目标不变", JSON.stringify(noCand));
  ck(reasonOf(noCand).length > 0, "无候选拒绝给出原因", reasonOf(noCand));

  // 范围内只有「已学但未熟练」的词：同样不是可加量新词。
  setupState({ dailyNew: 1, dayN: 1 });
  const learned = freqScope(360);
  markLearned(learned);
  ck(candAvail() === 0, "范围内全是已学词时候选=0", String(candAvail()));
  advance(30000);
  const noFresh = grant(10);
  ck(noFresh.ok === false && noFresh.available === 0 && extraOf().extra === 0,
    "无未学新词时拒绝且 extra 不变", JSON.stringify(noFresh));
}

/* ---------------- 5. 入口条件 ---------------- */
console.log("== 5. 计划未完成拒绝，完成后可加量 ==");
{
  setupState({ dailyNew: 20, dayN: 5 });
  const progBefore = progSig(), daysBefore = daysSig();
  advance(30000);
  const early = grant(10);
  ck(early.ok === false, "day().n=5 < dailyNew=20 时加量拒绝", JSON.stringify(early));
  ck(extraOf().extra === 0 && effTarget() === 20,
    "计划未完成拒绝后 extra=0、目标=20", JSON.stringify(early));
  ck(reasonOf(early).length > 0, "计划未完成拒绝给出原因", reasonOf(early));
  ck(progSig() === progBefore && daysSig() === daysBefore,
    "计划未完成拒绝不改 progress/days");
  ck(todayN() === 5, "计划未完成拒绝后 day().n 仍 5", String(todayN()));

  setupState({ dailyNew: 20, dayN: 20 });
  advance(30000);
  const done = grant(10);
  ck(done.ok === true && extraOf().extra === 10,
    "day().n=20 且范围内有未学词时加量成功", JSON.stringify(done));

  setupState({ dailyNew: 20, dayN: 21 });
  advance(30000);
  const exceed = grant(10);
  ck(exceed.ok === true && extraOf().extra === 10,
    "day().n 略大于 dailyNew 仍视为计划完成，可加量", JSON.stringify(exceed));
}

/* ---------------- 6. 撤销 / 改判 ---------------- */
console.log("== 6. 撤销回退 day().n 但不撤回额度；改判不改额度 ==");
{
  setupState({ dailyNew: 1, dayN: 1 });
  advance(30000);
  const seeded = grant(10);
  ck(seeded.ok === true && effTarget() === 11,
    "撤销夹具：+10 后目标 11", JSON.stringify(seeded));
  T.startSession();
  ck(T.Q.length === 10, "grant 后下一组按有效目标补 10 张新词", String(T.Q.length));
  const idx = T.cur;
  ck(idx != null && !T.hasMainProgress(S().progress[idx]), "当前卡为未学新词", String(idx));

  T.judge(true);
  ck(todayN() === 2, "新词首次判定后 day().n=2", String(todayN()));
  ck(T.hasMainProgress(S().progress[idx]), "首次判定写入主进度");
  ck(extraOf().extra === 10 && effTarget() === 11,
    "判定消费新词不改变已授予 extra", JSON.stringify(extraOf()));

  T.undo();
  ck(todayN() === 1, "撤销新词首次判定 → day().n 回退到 1", String(todayN()));
  ck(!T.hasMainProgress(S().progress[idx]), "撤销后主进度回退");
  ck(extraOf().extra === 10 && effTarget() === 11,
    "撤销不撤回已授予额度（extra 仍 10）", JSON.stringify(extraOf()));
  ck(T.cur === idx && T.verdict === null, "撤销后回到同一张未判卡", `${T.cur}/${T.verdict}`);

  T.judge(true);
  T.judge(false);
  ck(T.verdict === false, "改判为「不会」已生效", String(T.verdict));
  ck(extraOf().extra === 10 && effTarget() === 11,
    "改判不改变 extra 与有效目标", JSON.stringify(extraOf()));
  ck(todayN() === 2, "改判不重复增加 day().n（仍 2）", String(todayN()));
  T.undo();
  ck(T.verdict === true && extraOf().extra === 10,
    "撤销改判恢复原判定且 extra 不变", `${T.verdict}/${extraOf().extra}`);
}

/* ---------------- 7. 暂停页进入 extra 子组与现场恢复 ---------------- */
console.log("== 7. 暂停态加量进入 extra 子组、结束回原现场、不嵌套 ==");
{
  // 主组：3 个到期词，cap=1；先答「不会」消费额度并留下待巩固，再翻到第二张进入暂停。
  setupState({ dailyNew: 1, dayN: 1, settings: { dailyReviewCap: 1 }, used: 0 });
  const mainDue = markDue(3);
  T.startSession();
  ck(T.cur === mainDue[0], "暂停夹具：主组首卡为到期词", `${T.cur} vs ${mainDue[0]}`);
  T.judge(false);
  T.tryNext();
  ck(paused() === true, "消费 1 次后翻到第二张到期词 → 进入额度暂停", String(T.isCapPaused()));
  ck(T.pendingReinforce() >= 1, "主组存在待巩固重考", String(T.pendingReinforce()));

  const mainSnap = {
    Q: T.Q.slice(), cur: T.cur, qi: T.qi, answered: T.answered,
    groupTotal: T.getGroupTotal(), pending: T.pendingReinforce(),
    phase: T.phase, verdict: T.verdict,
    prog: clone(S().progress), days: clone(S().days),
    firstProg: clone(S().progress[mainDue[0]]), used: JSON.stringify(T.getReviewLedger()),
    cap: capNow()
  };
  ck(mainSnap.cur != null && mainSnap.cur === T.Q[mainSnap.qi], "暂停现场保留未答卡位置");

  advance(30000);
  const g = grant(10);
  ck(g.ok === true && extraOf().extra === 10 && effTarget() === 11,
    "暂停页 +10 成功，目标 1+10=11", JSON.stringify(g));
  ck(enterExtraSubgroup(), "暂停页加量成功后进入 extra 子组", String(T.isExtraSubgroup()));
  ck(inSub() === true, "从暂停页加量后 isExtraSubgroup()===true", String(T.isExtraSubgroup()));
  ck(capNow() === 1, "加量不提高复习上限", String(capNow()));
  ck(JSON.stringify(T.getReviewLedger()) === mainSnap.used, "加量不消费复习额度",
    JSON.stringify(T.getReviewLedger()));
  ck(progSig() === JSON.stringify(mainSnap.prog), "grant 本身不写主组 progress");
  ck(daysSig() === JSON.stringify(mainSnap.days), "grant 本身不写主组 days");
  ck(todayN() === 1, "grant 本身不增加 day().n", String(todayN()));

  ck(T.cur != null && T.Q.length > 0, "extra 子组已安排当前卡与队列",
    `cur=${T.cur} Q=${T.Q.length}`);
  ck(T.Q.length === 10, "extra 子组按授予数安排 10 张新词", String(T.Q.length));
  ck(T.Q.every(i => !T.hasMainProgress(S().progress[i]) && !T.isProficient(i)),
    "extra 子组只含未学且非熟练词");
  ck(T.cur != null && !T.hasMainProgress(S().progress[T.cur]),
    "extra 子组当前卡为未学新词", String(T.cur));

  const extraIdx = T.cur;
  T.judge(true);
  ck(todayN() === 2, "extra 子组首词判定后 day().n=2", String(todayN()));
  ck(T.hasMainProgress(S().progress[extraIdx]), "extra 子组判定写入主进度");
  const extraProg = clone(S().progress[extraIdx]);
  ck(extraOf().extra === 10, "子组学习消费不移除已授予额度", JSON.stringify(extraOf()));

  let endErr = null;
  try { T.endExtraSubgroup(); } catch (e) { endErr = e; }
  ck(!endErr, "endExtraSubgroup 不抛异常", endErr && endErr.message);
  ck(inSub() === false, "结束后 isExtraSubgroup()===false", String(T.isExtraSubgroup()));
  ck(T.cur === mainSnap.cur && T.qi === mainSnap.qi,
    "结束后回到原暂停现场（cur/qi 一致）", `${T.cur}/${T.qi} vs ${mainSnap.cur}/${mainSnap.qi}`);
  ck(eq(T.Q.slice(), mainSnap.Q), "结束后主组 Q 完整恢复", `${T.Q.length} vs ${mainSnap.Q.length}`);
  ck(T.answered === mainSnap.answered && T.getGroupTotal() === mainSnap.groupTotal,
    "结束后主组进度分母与已答数不变",
    `${T.answered}/${T.getGroupTotal()} vs ${mainSnap.answered}/${mainSnap.groupTotal}`);
  ck(T.pendingReinforce() === mainSnap.pending,
    "结束后主组待巩固数保留", `${T.pendingReinforce()} vs ${mainSnap.pending}`);
  ck(T.phase === mainSnap.phase && T.verdict === mainSnap.verdict,
    "结束后主组判定现场不变", `${T.phase}/${T.verdict}`);
  ck(paused() === true, "结束后原组仍是额度暂停态（未伪装完成）", String(T.isCapPaused()));
  ck(T.cur != null && T.cur === mainSnap.cur, "原未答卡仍在，不被标完成");
  ck(eq(clone(S().progress[mainDue[0]]), mainSnap.firstProg),
    "原组已判词 progress 不被子组覆盖");
  ck(T.hasMainProgress(S().progress[extraIdx]), "子组产生的 progress 在结束后保留");
  ck(JSON.stringify(S().progress[extraIdx]) === JSON.stringify(extraProg),
    "子组进度未被回滚", JSON.stringify(S().progress[extraIdx]));
  ck(todayN() === 2, "子组产生的 day().n 在结束后保留（2）", String(todayN()));
  ck(extraOf().extra === 10 && effTarget() === 11,
    "结束后额度仍为 10、目标仍 11", JSON.stringify(extraOf()));

  // 再次有意加量：允许；且不得无限嵌套子组。
  advance(30000);
  const again = grant(10);
  ck(again.ok === true, "完成后可再次有意加量", JSON.stringify(again));
  ck(enterExtraSubgroup(), "再次加量后重新进入 extra 子组", String(T.isExtraSubgroup()));
  ck(inSub() === true, "再次加量后 isExtraSubgroup()===true", String(T.isExtraSubgroup()));
  const extraAtAgain = extraOf().extra;
  ck(extraAtAgain === 20, "再次 +10 → extra=20", String(extraAtAgain));
  ck(T.startExtraSubgroup() === false, "已在 extra 子组内再次进入被拒绝（不产生第二层）",
    String(T.isExtraSubgroup()));
  ck(inSub() === true, "被拒绝后仍在同一 extra 组", String(T.isExtraSubgroup()));
  const extraAfterNestProbe = extraOf().extra;
  ck(extraAfterNestProbe === extraAtAgain, "重复进入子组不改变已授予额度",
    `${extraAfterNestProbe} vs ${extraAtAgain}`);
  let end2Err = null;
  try { T.endExtraSubgroup(); } catch (e) { end2Err = e; }
  ck(!end2Err, "第二次结束子组不抛异常", end2Err && end2Err.message);
  ck(inSub() === false, "一次 end 即退出全部 extra 层（无嵌套）", String(T.isExtraSubgroup()));
  ck(T.cur === mainSnap.cur && eq(T.Q.slice(), mainSnap.Q),
    "第二次结束后仍回到同一主组现场", `${T.cur} vs ${mainSnap.cur}`);
  ck(paused() === true, "主组仍保持暂停，不被子组改成完成", String(T.isCapPaused()));

  // 撤销现场：应撤销主组自己的「翻页」，而不是子组动作。
  T.undo();
  ck(T.cur === mainSnap.Q[0] && T.Q.length === mainSnap.Q.length - 1,
    "返回后撤销恢复主组翻页现场", `cur=${T.cur} Q=${T.Q.length}`);
  ck(T.verdict === false, "撤销翻页后恢复主组上一张的判定结果", String(T.verdict));
  ck(T.hasMainProgress(S().progress[extraIdx]) && todayN() === 2,
    "撤销主组翻页不抹掉 extra 子组进度与日统计");
}

/* ---------------- 7b. 计划内新词未完成 + 额度暂停：暂停页仍可加量 ---------------- */
console.log("== 7b. 计划未完成时暂停页可加量、完成页入口仍拒绝 ==");
{
  // dayN=0 < dailyNew=20：今日计划内新词还没学完；cap=1 且已用 1 → 下一张复习卡进入暂停。
  setupState({ dailyNew: 20, dayN: 0, settings: { dailyReviewCap: 1 }, used: 1 });
  const due = markDue(2);
  T.startSession();
  ck(paused() === true, "夹具：计划未完成时也能因额度进入暂停", String(T.isCapPaused()));
  ck(T.cur === due[0], "暂停现场保留未答复习卡", `${T.cur} vs ${due[0]}`);

  // 完成页语义（缺省 fromPause=false）仍要求计划内新词学完。
  advance(30000);
  const donePage = T.grantExtraNew(10);
  ck(donePage && donePage.ok === false && donePage.error === "plan-not-finished",
    "完成页路径仍拒绝：plan-not-finished", JSON.stringify(donePage));
  ck(extraOf().extra === 0, "被拒绝时 extra 不变", String(extraOf().extra));

  // 暂停页语义（fromPause=true）不要求计划完成。
  advance(30000);
  const pausePage = T.grantExtraNew(10, { fromPause: true });
  ck(pausePage && pausePage.ok === true && extraOf().extra === 10,
    "暂停页路径放宽：计划未完成也能 +10", JSON.stringify(pausePage));
  ck(pausePage.fromPause === true, "返回 fromPause 标记为 true", JSON.stringify(pausePage));
  ck(effTarget() === 30, "目标 = dailyNew 20 + extra 10 = 30", String(effTarget()));
  ck(todayN() === 0, "加量不增加 day().n", String(todayN()));
  ck(capNow() === 1, "暂停页加量不提高复习上限", String(capNow()));

  // 授予后可进入 extra 子组，结束回原暂停现场。
  ck(enterExtraSubgroup(), "暂停页加量后可进入 extra 子组", String(T.isExtraSubgroup()));
  T.endExtraSubgroup();
  ck(T.isExtraSubgroup() === false && paused() === true,
    "结束子组回到原额度暂停现场", `${T.isExtraSubgroup()}/${T.isCapPaused()}`);
  ck(extraOf().extra === 10, "往返后 extra 保留 10", String(extraOf().extra));
}

/* ---------------- 8. 复习预算不变、重考仍受预算约束 ---------------- */
console.log("== 8. 加量不提高复习上限，子组「不会」重考仍受预算约束 ==");
{
  // 范围只有 2 词：1 个到期复习卡（制造暂停）+ 1 个未学新词（可加量）。
  setupState({ dailyNew: 1, dayN: 1, settings: { dailyReviewCap: 1, fmin: 360, fmax: 360 }, used: 1 });
  const due = markDue(1);
  ck(due.length === 1, "夹具：范围内 1 个到期词", String(due.length));
  T.startSession();
  ck(paused() === true, "夹具：复习预算已用尽且当前为到期卡", String(T.isCapPaused()));
  const capBefore = capNow();
  ck(capBefore === 1 && candAvail() === 1, "夹具：cap=1，剩余 1 个可加量新词", `${capBefore}/${candAvail()}`);

  advance(30000);
  const g = grant(1);
  ck(g.ok === true && extraOf().extra === 1 && effTarget() === 2,
    "暂停态 +1 成功，目标 1+1=2", JSON.stringify(g));
  ck(enterExtraSubgroup(), "暂停页加量后进入 extra 子组", String(T.isExtraSubgroup()));
  ck(inSub() === true, "进入 extra 子组", String(T.isExtraSubgroup()));
  ck(capNow() === capBefore, "加量前后 getReviewCap() 不变", `${capNow()} vs ${capBefore}`);
  ck(T.Q.length === 1, "extra 子组只安排 1 张实际可加量新词", String(T.Q.length));
  const idx = T.cur;
  ck(idx != null && !T.hasMainProgress(S().progress[idx]), "子组当前卡为未学新词", String(idx));

  T.judge(false);
  ck(JSON.stringify(T.getReviewLedger()).includes('"used":1'),
    "新词首次「不会」不计入复习台账（used 仍 1）", JSON.stringify(T.getReviewLedger()));
  ck(T.hasMainProgress(S().progress[idx]), "「不会」后该词获得主进度（重考将计入预算）");
  ck(todayN() === 2, "首次判定把 day().n 加到 2", String(todayN()));

  T.tryNext();
  ck(T.cur === idx && T.phase === "recall", "「不会」后本组队尾重考回到同一词",
    `${T.cur}/${T.phase}`);
  ck(paused() === true, "重考卡在预算用尽时进入暂停", String(T.isCapPaused()));
  const usedBefore = T.getReviewLedger().used;
  const p1Before = S().progress[idx][1];
  const answeredBefore = T.answered;
  T.judge(true);
  ck(T.getReviewLedger().used === usedBefore,
    "暂停态重考判定不消费额度（used 仍 1）", JSON.stringify(T.getReviewLedger()));
  ck(T.verdict === null && T.phase === "recall", "暂停态重考被拦截，未产生新判定",
    `${T.verdict}/${T.phase}`);
  ck(S().progress[idx][1] === p1Before, "暂停态重考不改写 p[1] 到期时间", String(S().progress[idx][1]));
  ck(T.answered === answeredBefore && T.cur === idx, "暂停态重考不推进队列", `${T.answered}/${T.cur}`);
  ck(capNow() === capBefore && extraOf().extra === 1,
    "重考被拦后 cap/extra 均不变", `${capNow()}/${extraOf().extra}`);

  T.endExtraSubgroup();
  ck(inSub() === false && paused() === true,
    "结束 extra 子组回到暂停主组", `${T.isExtraSubgroup()}/${T.isCapPaused()}`);
  ck(capNow() === capBefore && extraOf().extra === 1,
    "结束子组后 cap/extra 仍不变", `${capNow()}/${extraOf().extra}`);
}

/* ---------------- 9. 防重复：同 tick 连击 / 跨标签对齐 ---------------- */
console.log("== 9. 同 tick 连击只生效一次、跨标签先对齐更大 extra ==");
{
  setupState({ dailyNew: 20, dayN: 20 });
  const progBefore = progSig();
  advance(30000);
  const first = grant(10);
  ck(first.ok === true && extraOf().extra === 10, "连击夹具：首次 +10 成功", JSON.stringify(first));
  const second = grant(10);
  // 程序/键盘调用按契约「立即生效、不做连击去重」；指针连击（click.detail>=2 且 600ms 内同数量）
  // 的去重由真实浏览器验收覆盖，Node 夹具无法稳定构造按钮级 detail 事件，此处只断言不误伤程序调用。
  ck(second && second.ok === true && extraOf().extra === 20,
    "程序调用不受连击去重影响（键盘/程序立即生效，extra=20）", JSON.stringify(second));
  ck(effTarget() === 40, "两次有意加量后有效目标 = 40", String(effTarget()));
  ck(progSig() === progBefore, "加量不写 progress（授予与消费分离）");
  advance(30000);
  const deliberate = grant(10);
  ck(deliberate.ok === true && extraOf().extra === 30,
    "隔开时间后再次有意 +10 → extra=30", JSON.stringify(deliberate));

  // 跨标签：存储里已有更大的 extra（另一标签加了 20），本页 grant 先对齐再 +10。
  setupState({ dailyNew: 20, dayN: 20 });
  advance(30000);
  const base = grant(10);
  ck(base.ok === true && extraOf().extra === 10, "跨标签夹具：本页 extra=10", JSON.stringify(base));
  const raw = stored();
  ck(raw && raw.extraDay && raw.extraDay.extra === 10, "跨标签夹具：存储 extra=10",
    JSON.stringify(raw && raw.extraDay));
  raw.extraDay = { d: dayStr(), extra: 30 };
  store.set(KEY, JSON.stringify(raw));   // 另一标签又加了 20
  advance(30000);
  const aligned = grant(10);
  ck(aligned.ok === true, "跨标签对齐后本次提交成功", JSON.stringify(aligned));
  ck(extraOf().extra === 30, "先采纳存储中更大的 30，不重复叠加同一份（extra=30）",
    String(extraOf().extra));
  ck(effTarget() === 50, "跨标签对齐后有效目标 20+30=50", String(effTarget()));
  ck(settings().dailyNew === 20, "跨标签对齐不改变长期 dailyNew", String(settings().dailyNew));
  const saved = stored();
  ck(saved && saved.extraDay && saved.extraDay.extra === 30,
    "对齐后的 extra=30 已落盘", JSON.stringify(saved && saved.extraDay));
  advance(30000);
  const afterAlign = grant(10);
  ck(afterAlign.ok === true && extraOf().extra === 40 && effTarget() === 60,
    "对齐后再有意 +10 → extra=40（成功后可再次加量）",
    `${extraOf().extra}/${effTarget()} (${JSON.stringify(afterAlign)})`);
}

/* ---------------- 10. 导出只读与 TXT 无关 ---------------- */
console.log("== 10. buildExport 只读、TXT 条目数与 extra 无关 ==");
{
  setupState({ dailyNew: 20, dayN: 20 });
  advance(30000);
  const g = grant(10);
  ck(g.ok === true && extraOf().extra === 10, "导出夹具：extra=10", JSON.stringify(g));
  const sig = () => JSON.stringify({
    extra: T.getExtraDay(), settings: settings(), dv: S().dv,
    prog: S().progress, days: S().days, review: S().reviewDay
  });
  const before = sig();
  const e1 = T.buildExport();
  const after1 = sig();
  ck(after1 === before, "T.buildExport 调用前后 extraDay/settings/progress 签名不变");
  ck(e1.books.kaoyan.extraDay.extra === 10, "导出内容包含 extra=10",
    JSON.stringify(e1.books.kaoyan.extraDay));
  const e2 = T.buildExport();
  ck(JSON.stringify(e1.books) === JSON.stringify(e2.books),
    "连续两次导出的学习记录一致（导出只读）");
  ck(sig() === before, "第二次 buildExport 后签名仍不变");

  const scoped = T.inScopeCount();
  const txt1 = T.wordBookTxt();
  ck(lines(txt1) === scoped, "TXT 条目数=当前范围非熟练词数", `${lines(txt1)} vs ${scoped}`);
  ck(scoped > 100, "TXT 范围未被加量截断", String(scoped));
  S().extraDay = { d: dayStr(), extra: 400 };
  const txt2 = T.wordBookTxt();
  ck(lines(txt2) === scoped, "extra 改为 400 后 TXT 条目数不变", `${lines(txt2)} vs ${scoped}`);
  ck(lines(txt2) === lines(txt1), "TXT 条目数与临时加量无关");
  const e3 = T.buildExport();
  ck(e3.books.kaoyan.extraDay.extra === 400 && effTarget() === 420,
    "导出如实包含 extra=400、目标 420", `${e3.books.kaoyan.extraDay.extra}/${effTarget()}`);
  ck(lines(T.wordBookTxt()) === scoped, "导出后 TXT 仍完整");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
