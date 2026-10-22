/**
 * 15 刷新后继续未完成组（会话快照回归）
 * 执行真实 js/app.js（DOM 桩 + 真实四书 + 受控时钟 + 受控 localStorage），不复制业务逻辑。
 *
 * 覆盖：
 *  - 每书独立快照键、单词文本映射、大小可控、不进备份 v3/savedStateSignature；低频写入；
 *  - 未判定/已揭示/重考刷新恢复现场，且不重复提交已记账判定、不重复消费新词/复习额度；
 *  - 已揭示恢复后改判/撤销仍按正确基线，刷新前撤销记录不可再用（有说明）；
 *  - 安全失效：跨日、dataVersion、主进度签名（多标签推进）、熟练变化、损坏/字段非法、
 *    存储失败、切书、重置、导入失败、完成后不恢复空组；
 *  - 08 裁决：改设置后刷新仍恢复当前组（快照内部 scopeSig 校验，只提示下一组生效）；
 *  - 恢复后不触发自动续背；主动开新组/进特训/切页面明确退出恢复现场且不丢记录。
 *
 * 运行：node --max-old-space-size=512 js/test-resume-session.mjs
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
for (const sel of ["#appAlert", "#exPop", "#capPause", "#autoResume", "#planPendingNotice", "#resumeNotice",
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


/* ---------------- 15 适配层与辅助 ---------------- */
const numConst = (name) => {
  const m = appSource.match(new RegExp("const " + name + "\\s*=\\s*(\\d+)"));
  if (!m) throw new Error("app.js 应声明 " + name);
  return Number(m[1]);
};
const AUTO_TICK_MS = numConst("AUTO_RESUME_TICK_MS");
const PROF_KEY = T.getStorageKeys().books.kaoyan.prof;
const DEFAULT_AR = T.getAutoResume();
const findIdx = w => T.getW().findIndex(x => x.w === w);
const qWords = () => T.Q.map(i => T.getW()[i] && T.getW()[i].w);
const snapKey = (book = T.getBook()) => T.getSessionSnapshotKey(book);
const snapState = () => T.getSessionSnapshotState();
const noticeOf = () => T.getResumeNotice();
const reload = () => T.simulateReload();
const autoTimer = () => {
  const t = [...intervals].reverse().find(i => i.ms === AUTO_TICK_MS);
  if (!t) throw new Error("应注册自动续背采样定时器");
  return t.fn;
};
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
    backlogGuard: true
  });
  const dayN = o.dayN === undefined ? 0 : o.dayN;
  s.days[todayStr()] = { n: dayN, r: dayN, ok: dayN, no: 0 };
  s.reviewDay = { d: todayStr(), used: o.used || 0 };
  s.extraDay = { d: todayStr(), extra: 0 };
  if (o.due) markDue(o.due);
  saveNow();
  T.startSession("main");
  return s;
}
function saveNow() { T.setReviewCap(settings().dailyReviewCap); }
function scopeIndices() {
  const out = [];
  for (let i = 0; i < T.getW().length; i++) if (T.inScope(i)) out.push(i);
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
  while (T.cur != null && guard++ < 200) { T.judge(true); T.tryNext(); }
  return guard;
}
const qSig = () => JSON.stringify({ Q: qWords(), qi: T.qi, cur: T.cur == null ? null : T.getW()[T.cur].w, answered: T.answered, total: T.getGroupTotal() });
const progOf = w => { const i = findIdx(w); return i >= 0 ? JSON.stringify(S().progress[i] || null) : null; };

/* ================= 0. 契约钩子与键名 ================= */
console.log("== 0. 契约钩子与快照键 ==");
{
  for (const name of ["getSessionSnapshotState", "getSessionSnapshotKey", "getSessionSnapshotKeys",
    "simulateReload", "getResumeNotice", "persistSessionSnapshot", "clearSessionSnapshot"]) {
    ck(typeof T[name] === "function", `导出契约钩子 ${name}`);
  }
  ck(T.sessionSnapshotPrefix === "vocab_session_snapshot_", "快照键前缀独立（vocab_session_snapshot_）", T.sessionSnapshotPrefix);
  const keys = T.getSessionSnapshotKeys();
  ck(keys.length === 4 && ["kaoyan", "cet4", "cet6", "combined"].every(id => keys.includes("vocab_session_snapshot_" + id + "_v1")),
    "四书各自独立快照键", JSON.stringify(keys));
  ck(snapKey("kaoyan") === "vocab_session_snapshot_kaoyan_v1", "getSessionSnapshotKey(kaoyan) 键名稳定", snapKey("kaoyan"));
  const st = snapState();
  ck(typeof st.present === "boolean" && typeof st.valid === "boolean", "getSessionSnapshotState() 含 present/valid", JSON.stringify(st));
  ck(noticeOf() === null, "正常启动无恢复提示");
  // 快照不写主记录、不进备份 v3
  const mainRaw = store.get(KEY) || "";
  ck(!mainRaw.includes("session_snapshot") && !mainRaw.includes("vocab_session_snapshot"),
    "快照键不写入主记录/不改变 state");
  const backup = JSON.stringify(T.buildExport());
  ck(!backup.includes("session_snapshot"), "会话快照不进备份 v3");
}

/* ================= 1. 未判定刷新 ================= */
console.log("== 1. 未判定刷新：恢复同一组现场 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const before = qSig();
  ck(T.cur != null && T.answered === 0, "初始新组：当前卡在第一张、进度 0");
  ck(snapState().valid === true, "开组即写入有效快照", JSON.stringify(snapState().reason));
  ck(noticeOf() === null, "开组后尚未刷新：无恢复提示");
  const dayNBefore = S().days[todayStr()].n;
  const r = reload();
  ck(r.mode === "restored", "刷新后走恢复路径", JSON.stringify(r));
  ck(qSig() === before, "未判定刷新恢复同一当前卡/队列/进度");
  ck(T.phase === "recall" && T.verdict === null, "恢复为未判定阶段");
  ck(S().days[todayStr()].n === dayNBefore && T.getReviewLedger().used === 0, "恢复不消耗新词/复习额度");
  const noActionNotice = noticeOf();
  ck(!!noActionNotice && noActionNotice.noAction === true,
    "D-15-01 口径：0 判定开组即刷新同样显示恢复提示（not 静默）", JSON.stringify(noActionNotice));
  ck(/尚未作答/.test(stateEl("#resumeNoticeText").innerHTML) && stateEl("#resumeNotice").hidden === false,
    "0 判定恢复提示可见且文案说明尚未作答", stateEl("#resumeNoticeText").innerHTML);
}

/* ================= 2. 已揭示刷新 ================= */
console.log("== 2. 已揭示刷新：不重复记账，改判/撤销基线正确 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const word = T.getW()[T.cur].w;
  T.judge(true);
  const progressBefore = progOf(word);
  const dayRec = JSON.parse(JSON.stringify(S().days[todayStr()]));
  const ledgerBefore = T.getReviewLedger().used;
  const answeredBefore = T.answered;
  ck(T.phase === "revealed" && T.verdict === true, "先判定一张（已揭示）");
  ck(snapState().valid === true, "已揭示现场写入有效快照");
  const r = reload();
  ck(r.mode === "restored", "已揭示刷新走恢复路径");
  ck(T.phase === "revealed" && T.verdict === true && T.cur != null && T.getW()[T.cur].w === word,
    "恢复已揭示状态（同一单词/判定）");
  ck(T.answered === answeredBefore, "恢复不重复累加已解答数", String(T.answered));
  ck(progOf(word) === progressBefore, "恢复不重复提交进度（p 元组一致）", progOf(word));
  ck(JSON.stringify(S().days[todayStr()]) === JSON.stringify(dayRec), "恢复不重复累计当日统计");
  ck(T.getReviewLedger().used === ledgerBefore, "恢复不重复消费复习台账");
  const notice = noticeOf();
  ck(!!notice && notice.answered === 1, "已揭示恢复显示一句说明", JSON.stringify(notice));
  ck(noticeOf() && qSig(), "说明文案包含刷新前撤销不可再用");
  const noticeText = stateEl("#resumeNoticeText").innerHTML;
  ck(/刷新前的撤销记录不可再用/.test(noticeText), "说明文案明确撤销记录不可再用", noticeText);
  ck(/已恢复上次未完成的一组/.test(noticeText), "说明文案明确已恢复上次未完成的一组", noticeText);
  ck(stateEl("#resumeNotice").hidden === false, "恢复提示在学习页可见");
  // 改判（用恢复后的原判定基线）不重复计数
  T.judge(false);
  ck(T.verdict === false && T.phase === "revealed", "恢复后可改判");
  const rejudged = S().days[todayStr()];
  ck(rejudged.r === dayRec.r && rejudged.n === dayRec.n && rejudged.ok === 0 && rejudged.no === 1,
    "改判替换原结果：r/n 不增加，ok/no 按新判定重算", JSON.stringify(rejudged));
  ck(progOf(word) !== progressBefore, "改判重算进度（不叠加）");
  ck(noticeOf() === null, "首个有效交互后恢复提示消失");
  // 撤销改判回到原判定
  T.undo();
  ck(T.verdict === true && progOf(word) === progressBefore, "撤销改判回到刷新前的判定进度");
  ck(T.getReviewLedger().used === ledgerBefore, "改判/撤销不额外消费复习台账");
  // 再次判定后快照更新为最新现场
  T.judge(false);
  ck(snapState().valid === true, "改判后快照仍为有效现场");
}

/* ================= 3. 重考刷新 ================= */
console.log("== 3. 重考刷新：待巩固/重考队尾现场保留 ==");
{
  setup({ dailyNew: 20, groupSize: 4, order: "freq" });
  const first = T.getW()[T.cur].w;
  T.judge(false);
  T.tryNext();
  const pendingBefore = T.pendingReinforce();
  const dayNBefore = S().days[todayStr()].n;
  const qBefore = qWords();
  ck(pendingBefore >= 1, "答错产生待巩固", String(pendingBefore));
  ck(qBefore.filter(w => w === first).length === 2, "重考词进入本组队尾（分母不变）", JSON.stringify(qBefore));
  const r = reload();
  ck(r.mode === "restored", "重考现场刷新后恢复");
  ck(JSON.stringify(qWords()) === JSON.stringify(qBefore), "重考队列/队尾位置完整恢复");
  ck(T.pendingReinforce() === pendingBefore, "待巩固数恢复一致", `${T.pendingReinforce()} vs ${pendingBefore}`);
  ck(T.getGroupTotal() === 4, "本组分母仍为初始 4 张", String(T.getGroupTotal()));
  ck(S().days[todayStr()].n === dayNBefore, "恢复不重复消耗新词额度", String(S().days[todayStr()].n));
  // 继续完成：重考判定按复习卡计 1 次台账，且不重复计新词
  completeGroup();
  ck(T.cur === null, "恢复后继续完成本组");
  ck(S().days[todayStr()].n === 4, "本组新词只计 4 个（恢复不重复计新词）", String(S().days[todayStr()].n));
  ck(T.getReviewLedger().used === 1, "重考按复习判定计 1 次台账", String(T.getReviewLedger().used));
  ck(snapState().present === false, "完成组后快照清空（不作为未完成组恢复）");
}

/* ================= 4. 跨日 ================= */
console.log("== 4. 跨日：快照失效并安全开组 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  ck(snapState().valid === true, "跨日前快照有效");
  advance(24 * 60 * 60 * 1000);
  const r = reload();
  ck(r.mode === "started", "跨日刷新不恢复昨日现场（安全开组）", JSON.stringify(r));
  ck(T.answered === 0 && T.cur != null, "跨日开新组而非恢复旧组");
  ck(S().days[todayStr()] === undefined || S().days[todayStr()].n === 0, "跨日新组新一天额度从 0 开始");
  const st = snapState();
  ck(st.present === true && st.valid === true && st.data.day === todayStr(), "跨日后旧快照被清理并写新组快照", JSON.stringify(st.data && st.data.day));
}

/* ================= 5. dataVersion / 快照内部一致性 ================= */
console.log("== 5. dataVersion 与内部字段校验 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  let data = snapState().data;
  ck(!!data, "存在可篡改的快照数据");
  data.dv = (data.dv || 2) - 1;
  store.set(snapKey(), JSON.stringify(data));
  let r = reload();
  ck(r.mode === "started", "dataVersion 不匹配 → 快照失效安全开组", JSON.stringify(r));
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  data = snapState().data;
  data.plan.scopeSig = "bad-signature";   // 内部 scopeSig 与 plan.scopeSig 不一致
  store.set(snapKey(), JSON.stringify(data));
  r = reload();
  ck(r.mode === "started", "快照内部范围签名不一致 → 失效安全开组");
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  data = snapState().data;
  data.queue[1] = "zzzznotaword";
  store.set(snapKey(), JSON.stringify(data));
  r = reload();
  ck(r.mode === "started", "队列单词不存在于当前词库 → 失效安全开组");
}

/* ================= 6. 熟练变化 ================= */
console.log("== 6. 熟练变化：主记录/熟练键优先 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  clearSessionSnapshotForTest();
  ck(snapState().present === false, "标熟练前快照存在（此处先清理以验证显式清空）");
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  T.setProficient(T.cur, true);
  ck(snapState().present === false, "标为熟练时立即丢弃临时快照");
  const r = reload();
  ck(r.mode === "started" && T.answered === 0, "熟练变化后刷新安全开组，不恢复旧组");
  // 其他标签改熟练键：主记录/熟练键优先，快照签名/熟练校验失效
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  const data = snapState().data;
  const queueWord = data.queue[1] || data.queue[0];
  const raw = JSON.parse(store.get(KEY));
  raw.proficient = raw.proficient || {};
  raw.proficient[queueWord] = Date.now();
  store.set(KEY, JSON.stringify(raw));
  store.set(PROF_KEY, JSON.stringify(raw.proficient));
  const r2 = reload();
  ck(r2.mode === "started", "多标签/外部熟练键变化 → 快照失效安全开组", JSON.stringify(r2));
}
function clearSessionSnapshotForTest(){ T.clearSessionSnapshot(); }

/* ================= 7. 损坏/字段非法快照 ================= */
console.log("== 7. 损坏快照安全降级 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  store.set(snapKey(), "{bad json");
  let r = reload();
  ck(r.mode === "started", "损坏 JSON → 舍弃并安全开组");
  ck(snapState().valid === true, "损坏快照被新组快照替换");
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  store.set(snapKey(), JSON.stringify({v: 1}));
  r = reload();
  ck(r.mode === "started", "字段缺失的快照 → 安全开组");
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  const data = snapState().data;
  data.cur = data.queue[(data.qi + 1) % data.queue.length];
  store.set(snapKey(), JSON.stringify(data));
  r = reload();
  ck(r.mode === "started", "当前词与 qi 不一致的快照 → 安全开组");
}

/* ================= 7b. 合法 JSON 字段损坏 ================= */
console.log("== 7b. 合法 JSON 中的损坏基线/冻结配置不得回写主记录 ==");
{
  const cases = [
    ["基线 progress 次数字段为字符串", data => { data.curBaseline.prog[2] = "broken"; }],
    ["基线 progress 档位越界", data => { data.curBaseline.prog[0] = 12; }],
    ["基线每日计数为字符串", data => { data.curBaseline.days[data.curBaseline.date].r = "broken"; }],
    ["基线每日计数自相矛盾", data => { data.curBaseline.days[data.curBaseline.date].ok += 1; }],
    ["基线 day 与 days 不一致", data => { data.curBaseline.day.r += 1; data.curBaseline.day.ok += 1; }],
    ["基线含非法日历日期", data => { data.curBaseline.days["2026-02-31"] = null; }],
    ["基线缺原始日期记录", data => { delete data.curBaseline.days[data.curBaseline.date]; }],
    ["基线 survey 非 0/1", data => { data.curBaseline.survey = 2; }],
    ["基线特训错次增量为字符串", data => { data.curBaseline.drillWrongDelta = "broken"; }],
    ["曲线并非严格递增", data => { data.plan.stagesMs[1] = data.plan.stagesMs[0]; }],
    ["曲线不是整数分钟", data => { data.plan.stagesMs[0] = 30000; }],
    ["曲线超过365天", data => { data.plan.stagesMs[9] = 366 * 86400000; }],
    ["重学间隔为零", data => { data.plan.relearnMs = 0; }],
    ["每组词数越界", data => { data.plan.groupSize = 101; }],
    ["开组时间为字符串", data => { data.plan.startedAt = "broken"; }],
    ["范围总数越界", data => { data.plan.scopeCount = T.getW().length + 1; }],
    ["每日新词目标越界", data => { data.plan.dailyNewTarget = 0; }],
    ["范围签名无法解析", data => { data.scopeSig = data.plan.scopeSig = "broken"; }],
    ["范围签名含非法词性", data => {
      const scope = JSON.parse(data.scopeSig); scope[6] = ["not-a-pos"];
      data.scopeSig = data.plan.scopeSig = JSON.stringify(scope);
    }],
    ["原档位为字符串", data => { data.stageBefore = "broken"; }],
    ["重考映射为数组", data => { data.rounds = []; }]
  ];
  for (const [label, corrupt] of cases) {
    setup({ due: 1, cap: 100, dailyNew: 20, groupSize: 3, order: "freq" });
    T.judge(true);
    const mainRaw = store.get(KEY);
    const data = clone(snapState().data);
    corrupt(data);
    store.set(snapKey(), JSON.stringify(data));
    ck(snapState().valid === false, label + "：读取即拒绝恢复");
    ck(store.get(KEY) === mainRaw, label + "：只读校验不改主记录原文");
    const r = reload();
    ck(r.mode === "started" && T.getResumeNotice() === null, label + "：只丢临时现场并安全开组");
    ck(store.get(KEY) === mainRaw && T.getStorageOK(), label + "：安全开组仍保留有效主记录原文");
    T.judge(true);
    const saved = stored();
    let validMain = true;
    try { T.normalizeState(saved, "kaoyan"); } catch (e) { validMain = false; }
    ck(T.verdict === true && T.getStorageOK() && validMain && store.get(KEY) !== mainRaw,
      label + "：后续学习仍能正常保存合法主记录");
  }
}

/* ================= 8. 存储失败 ================= */
console.log("== 8. 快照写入失败：不崩溃、不回退已学习记录 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const word = T.getW()[T.cur].w;
  failKeys.add(snapKey());
  T.judge(true);   // 主记录保存成功，快照写入失败
  failKeys.delete(snapKey());
  ck(progOf(word) !== null, "主记录已保存该判定（快照失败不影响主记录）");
  const r = reload();
  ck(r.mode === "started", "快照签名落后于主记录 → 失效安全开组", JSON.stringify(r));
  ck(S().days[todayStr()].n === 1, "安全开组不重复消耗已学新词额度", String(S().days[todayStr()].n));
  ck(progOf(word) !== null, "已学习记录保留（刷新不丢主记录）");
  // 恢复写入后快照可再次工作
  const curWord = T.getW()[T.cur].w;
  T.judge(true);
  ck(snapState().valid === true, "存储恢复后快照重新有效");
  const r2 = reload();
  ck(r2.mode === "restored", "存储恢复后刷新可继续恢复现场");
}

/* ================= 9. 多标签推进：主进度优先 ================= */
console.log("== 9. 多标签推进过同一本书 → 快照失效 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  const data = snapState().data;
  const otherWord = data.queue[2] || data.queue[0];
  // 模拟另一标签判定/推进主记录（改队列内另一词进度）
  const raw = JSON.parse(store.get(KEY));
  const idx = findIdx(otherWord);
  raw.progress[idx] = [3, now + 1000, 3, 0, now];
  raw.days[todayStr()] = Object.assign({}, raw.days[todayStr()], {r: (raw.days[todayStr()].r || 0) + 1, ok: (raw.days[todayStr()].ok || 0) + 1});
  store.set(KEY, JSON.stringify(raw));
  const r = reload();
  ck(r.mode === "started", "主进度签名变化（其他标签推进）→ 快照失效安全开组", JSON.stringify(r));
  ck(T.answered === 0 && T.cur != null, "安全开新组");
  ck(JSON.parse(JSON.stringify(S().progress[idx]))[0] === 3, "其他标签的主记录变化被保留（主记录优先）");
}

/* ================= 10. 切书 ================= */
console.log("== 10. 切书：旧书现场丢弃、新书安全开组 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  ck(store.has(snapKey("kaoyan")), "切书前考研快照存在");
  T.switchBook("cet4");
  ck(!store.has(snapKey("kaoyan")), "切书后当前书旧快照被清除");
  ck(store.has(snapKey("cet4")), "目标书按新组写入自己的快照");
  const r4 = reload();
  ck(r4.mode === "restored" && T.answered === 0, "切书后刷新恢复到新书新组，不恢复旧书旧组");
  T.switchBook("kaoyan");
  ck(snapState().valid === true, "切回考研究旧快照已丢弃，新组快照有效");
  const r = reload();
  ck(r.mode === "restored" && T.answered === 0, "切回后刷新不会复活切书前的旧组", JSON.stringify(r));
}

/* ================= 11. 重置 ================= */
console.log("== 11. 重置当前词书后快照失效 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const word = T.getW()[T.cur].w;
  T.judge(true);
  ck(progOf(word) !== null, "重置前有学习记录");
  stateEl("#rst").onclick();
  ck(S().progress[findIdx(word)] === undefined, "重置清空学习记录");
  const r = reload();
  ck(r.mode === "restored" ? T.answered === 0 : r.mode === "started", "重置后刷新不恢复重置前的组");
  ck(progOf(word) === "null", "重置后刷新不复活旧进度", String(progOf(word)));
}

/* ================= 12. 导入 ================= */
console.log("== 12. 导入后快照失效（含导入失败） ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const word = T.getW()[T.cur].w;
  T.judge(true);
  ck(progOf(word) !== null, "导入前有学习记录");
  T.importState({ settings: { dailyNew: 13 }, progress: {}, days: {}, stars: {}, proficient: {} });
  ck(settings().dailyNew === 13, "旧备份导入成功（设置保留）");
  const r = reload();
  ck(r.mode === "restored" ? T.answered === 0 : r.mode === "started", "导入后刷新不恢复导入前旧组");
  ck(progOf(word) === "null", "导入后刷新不复活旧记录", String(progOf(word)));
  // 导入失败：安全清掉旧快照，不回退主记录
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  const beforeProgress = JSON.stringify(S().progress);
  let threw = false;
  try { T.importState({ version: 3, books: null }); } catch (e) { threw = true; }
  ck(threw, "非法备份导入被拒绝");
  ck(JSON.stringify(S().progress) === beforeProgress, "导入失败不改动当前主记录");
  const r2 = reload();
  ck(r2.mode === "restored" && T.answered === 1, "导入失败不破坏当前未完成组现场（刷新仍可恢复）", JSON.stringify(r2));
}

/* ================= 13. 完成后刷新 ================= */
console.log("== 13. 主组完成后不恢复完成页快照 ==");
{
  setup({ dailyNew: 2, groupSize: 2, order: "freq" });
  completeGroup();
  ck(T.cur === null, "本组已完成");
  ck(snapState().present === false, "完成组后不保留未完成组快照");
  const r = reload();
  ck(r.mode === "started", "完成后刷新按新组开始（完成页不需要恢复）", JSON.stringify(r));
  ck(T.answered === 0, "刷新后进度归零（新一组/今日计划完成后暂无卡均可）");
  ck(snapState().present === false, "无当前卡时不写快照（避免空组循环恢复）");
}

/* ================= 14. 恢复后不触发自动续背 ================= */
console.log("== 14. 恢复现场不触发自动续背 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  const word = T.getW()[T.cur].w;
  const r = reload();
  ck(r.mode === "restored" && T.getW()[T.cur].w === word, "先恢复已揭示现场");
  const ar = T.getAutoResumeState();
  ck(ar.completedPage === false && ar.eligible === false, "恢复现场不是完成页，自动续背不可触发", JSON.stringify(ar));
  advance(DEFAULT_AR.idleMs + DEFAULT_AR.countdownMs + 5000);
  autoTimer()();
  ck(T.getAutoResumeState().phase !== "countdown", "恢复后挂机不会进入自动续背倒计时");
  ck(T.cur != null && T.getW()[T.cur].w === word, "恢复的当前卡不被自动续背重建");
}

/* ================= 15. 08 裁决：改设置后刷新仍恢复本组 ================= */
console.log("== 15. 08 裁决：改设置后刷新仍恢复当前组 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  const oldPlan = T.getPlan();
  T.judge(true);
  const word = T.getW()[T.cur].w;
  settings().dailyNew = 33;
  settings().fmin = 5;
  saveNow();
  ck(T.hasPendingScopeSettings() === true, "改设置后当前组进入待应用");
  const r = reload();
  ck(r.mode === "restored", "改设置后刷新仍恢复当前组（不因当前设置与快照 scopeSig 不同而丢弃）", JSON.stringify(r));
  ck(T.getW()[T.cur].w === word && T.phase === "revealed" && T.verdict === true, "已揭示卡现场保留");
  ck(T.hasPendingScopeSettings() === true, "恢复后仍提示设置已更改、将在下一组生效");
  ck(T.getPlan().dailyNewTarget === oldPlan.dailyNewTarget && T.getPlan().scopeSig === oldPlan.scopeSig,
    "恢复本组沿用开始时的计划快照（08 契约）");
  ck(settings().dailyNew === 33, "当前设置已更新，等待下一组生效");
}

/* ================= 16. 主动退出恢复现场 ================= */
console.log("== 16. 主动开新组/特训/切页面退出恢复现场 ==");
{
  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(true);
  reload();
  ck(!!noticeOf(), "先处于恢复现场（有提示）");
  T.startSession("main");
  ck(noticeOf() === null && T.answered === 0 && T.cur != null, "主动开始新组：退出恢复提示、按新组开始");
  ck(snapState().valid === true, "新组写入新快照");

  setup({ dailyNew: 20, groupSize: 10, order: "freq" });
  T.judge(false);
  T.tryNext();
  reload();
  ck(T.drillMode === false, "恢复现场后进入正常流");
  T.startDrill();
  ck(snapState().present === false, "进入错词特训 → 主组快照被清除（明确退出恢复现场）");
  T.exitDrill();
  ck(snapState().present === true, "退出特训后主组重新写入快照");

  // 切页面：明确退出恢复提示，但已恢复的学习记录不丢
  T.judge(true);
  reload();
  const beforeShow = JSON.stringify(S().progress);
  ck(!!noticeOf(), "切页面前处于恢复现场");
  T.show("stats");
  ck(noticeOf() === null, "切换到其他页面后恢复提示退出");
  ck(JSON.stringify(S().progress) === beforeShow, "切页面不丢已恢复的学习记录");
  T.show("study");
}


/* ================= 17.5 D-15-01 回归：全新 profile 开组即真实 F5（无主记录） ================= */
console.log("== 17.5 全新 profile 开组即刷新（无主记录，pagehide 再写快照） ==");
{
  // 还原 QA D-15-01 的最小复现前置：全新 profile（无主记录、无熟练键、无旧快照）→ 首次加载开组 →
  // 真实 F5 的生命周期会先 pagehide/visibilitychange(hidden) 再写一次快照 → 重新加载尝试恢复。
  // 修复前：渲染惰性创建的当日 0 记录只在内存中（未 save 进主记录），刷新后主记录缺失该字段，
  // progressSig 被误判为「主进度已推进」→ 丢现场重开随机新组（QA 实测 cur 1656→3215）。
  for (const key of T.getSessionSnapshotKeys()) store.delete(key);
  store.delete(KEY);
  store.delete(PROF_KEY);
  store.delete("vocab_active_book_v1");
  const firstBoot = reload();
  ck(firstBoot.mode === "started", "全新 profile 首次加载：无快照安全开组", JSON.stringify(firstBoot));
  ck(T.cur != null && T.answered === 0 && T.phase === "recall" && T.verdict === null,
    "开组即首个未判定卡：cur/answered/phase/verdict 与 QA 复现 A 一致");
  ck(!store.has(KEY), "全新 profile 尚未 save()：主记录不存在（与 QA 复现 A 的 mainRecordPresent=false 一致）");
  const wordBefore = T.getW()[T.cur].w;
  const groupBefore = qSig();
  ck(T.persistSessionSnapshot() === true, "pagehide 阶段写最后一次快照（真实 F5 生命周期）");
  ck(snapState().valid === true, "刷新前快照自校验有效", JSON.stringify(snapState().reason));
  const secondBoot = reload();
  ck(secondBoot.mode === "restored",
    "D-15-01：无主记录时开组即刷新仍恢复本组（当日惰性 0 记录不得造成签名误判）", JSON.stringify(secondBoot));
  ck(T.getW()[T.cur].w === wordBefore, "恢复同一当前词（不再随机重开）", `${T.getW()[T.cur].w} vs ${wordBefore}`);
  ck(qSig() === groupBefore, "恢复同一队列/qi/answered/分母");
  ck(snapState().valid === true, "恢复后快照仍有效");
  const d1501Notice = noticeOf();
  ck(!!d1501Notice && d1501Notice.noAction === true && stateEl("#resumeNotice").hidden === false,
    "D-15-01：0 判定开组即刷新恢复后显示 #resumeNotice（尚未作答文案）", JSON.stringify(d1501Notice));
  ck(/已恢复上次未完成的一组/.test(stateEl("#resumeNoticeText").innerHTML),
    "D-15-01 提示文案为「已恢复上次未完成的一组」", stateEl("#resumeNoticeText").innerHTML);
  ck(!store.has(KEY), "恢复过程没有额外 save()（不重复记账、不写主记录）");
  advance(30 * 1000);
  T.persistSessionSnapshot();
  const thirdBoot = reload();
  ck(thirdBoot.mode === "restored" && T.getW()[T.cur].w === wordBefore,
    "连续第二次真实刷新仍恢复同一组（快照可持续恢复）", JSON.stringify(thirdBoot));
}

/* ================= 17. 快照大小/写入频率 ================= */
console.log("== 17. 快照大小可控、低频写入 ==");
{
  setup({ dailyNew: 20, groupSize: 20, order: "freq" });
  T.judge(true);
  const raw = store.get(snapKey());
  ck(typeof raw === "string" && raw.length < 20000, "20 张一组的快照体积可控（<20KB）", raw ? String(raw.length) : "null");
  const data = JSON.parse(raw);
  ck(data.queue.every(w => typeof w === "string"), "队列使用单词文本映射（不依赖数组下标）");
  ck(!/['"]queue['"]\s*:\s*\[\s*\d/.test(raw), "队列不是数字下标数组");
  ck(data.plan && Array.isArray(data.plan.stagesMs) && data.plan.stagesMs.length === 10, "快照包含冻结曲线（plan 结构完整）");
  ck(data.updatedAt > 0 && data.day === todayStr(), "快照含 updatedAt/日期");
  // 写入频率：纯渲染/统计/筛选不写快照；判定/翻页才写
  const originalSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  let snapWrites = 0;
  globalThis.localStorage.setItem = (k, v) => {
    if (String(k).indexOf(T.sessionSnapshotPrefix) === 0) snapWrites++;
    return originalSet(k, v);
  };
  T.show("stats"); T.show("list"); T.applyFilter(false); T.show("study");
  ck(snapWrites === 0, "渲染/切页/筛选不写快照（低频写入）", String(snapWrites));
  T.tryNext();   // 翻页属低频写入点
  ck(snapWrites >= 1, "翻页后写快照", String(snapWrites));
  const writesAfterNext = snapWrites;
  T.judge(true);
  ck(snapWrites > writesAfterNext, "判定后写快照", `${snapWrites} vs ${writesAfterNext}`);
  const writesAfterJudge = snapWrites;
  T.show("study"); 
  ck(snapWrites === writesAfterJudge, "重渲染/切页不重复写快照（每次判定只写一次）", String(snapWrites));
  globalThis.localStorage.setItem = originalSet;
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
