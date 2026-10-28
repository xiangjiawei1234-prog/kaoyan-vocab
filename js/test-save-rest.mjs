/**
 * R03「保存现场，先休息」Node 回归。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱）；DOM 桩只模拟浏览器（解析 innerHTML、支持
 * querySelector/click/focus），受控时钟 + 可注入写失败的 localStorage，不复制业务逻辑。
 *
 * 覆盖：
 *  - 入口可见性：学习中有卡 / 本页等待时显示；完成页、普通空页、休息态隐藏。
 *  - 成功保存：主记录与内存一致、会话快照有效、休息页文案（已保存/本组进度，不写「本组完成」）、
 *    #restResume / #goStats、点继续回到同一卡同一阶段、撤销栈可用；
 *  - 0 判定 / 已揭示 / 额度暂停 / recall 未答四种现场都能休息；休息不消费复习额度、不标记完成、
 *    不增加学习时长、不改 settings/进度/台账。
 *  - 休息后 simulateReload() 恢复同一张卡（plan.main、同 phase/verdict），休息页本身不持久化。
 *  - 休息态下判定/翻页/撤销被统一守卫拒绝（error==="resting"）且记录不变。
 *  - 保存失败：ok=false、不进入休息页、不 toast「已保存」、显示 #appAlert 与「重试保存并休息」，
 *    恢复可写后重试成功进入休息页。
 *  - 会话快照写入失败但主记录成功：仍休息，但文案明确「本页现场未能写入浏览器」且不声称现场已保存。
 *  - 特训 / 受控加量子组：先按既有父现场协议返回，再保存主组现场（不把专项写成主组快照）。
 *  - 原快捷键一次改判保护在休息→继续后保持。
 *  - 批次A复核修复：有卡休息→继续后 autoResumeRestHeld 不泄漏（走完本组后自动续背资格恢复）；
 *    空页等待保存退出后可再次进入等待且不被旧「先休息」抑制；休息页隐藏待应用/恢复提示；
 *    保存失败重试按原动作回到停靠目标收尾（完成页「今天先到这里」写今日暂停键）。
 *
 * 运行：node --max-old-space-size=512 js/test-save-rest.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");
const cetSource = fs.readFileSync(path.join(ROOT, "js/cet-words-data.js"), "utf8");
const combinedSource = fs.readFileSync(path.join(ROOT, "js/combined-words-data.js"), "utf8");

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
const clone = value => JSON.parse(JSON.stringify(value));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- DOM 桩（解析真实 index.html 与 innerHTML） ---------------- */
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g,
  x => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[x]));
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function browser() {
  let doc;
  class Node {
    constructor(tag = "div", text = "") {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ""; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ""; this.checked = false;
      this.hidden = false; this.disabled = false; this.placeholder = ""; this.open = false;
      const classes = () => (this.attrs.class || "").split(/\s+/).filter(Boolean);
      this.classList = {
        contains: c => classes().includes(c),
        add: (...cs) => { this.attrs.class = [...new Set(classes().concat(cs))].join(" "); },
        remove: (...cs) => { this.attrs.class = classes().filter(c => !cs.includes(c)).join(" "); },
        toggle: (c, force) => {
          const yes = force === undefined ? !classes().includes(c) : !!force;
          if (yes) this.classList.add(c); else this.classList.remove(c);
          return yes;
        }
      };
    }
    get id() { return this.attrs.id || ""; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(""); }
    set textContent(value) { this.detachChildren(); this._html = ""; this._text = String(value); }
    get innerHTML() { return this._html; }
    set innerHTML(value) { this.detachChildren(); this._text = ""; this._html = String(value); parse(this._html, this); }
    detachChildren() {
      if (doc?.activeElement !== this && this.contains(doc?.activeElement)) doc.activeElement = doc.body;
      for (const n of this.children) n.parentNode = null;
      this.children = [];
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (["hidden", "disabled", "checked"].includes(name)) this[name] = true;
      if (name === "value") this.value = String(value);
    }
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
    removeAttribute(name) { delete this.attrs[name]; if (["hidden", "disabled", "checked"].includes(name)) this[name] = false; }
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
    insertBefore(n) { n.parentNode = this; this.children.unshift(n); return n; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    closest(selector) { for (let n = this; n && n !== doc; n = n.parentNode) if (matches(n, selector)) return n; return null; }
    querySelectorAll(selector) { const out = []; const walk = node => { for (const n of node.children) { if (matches(n, selector)) out.push(n); walk(n); } }; walk(this); return out; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    removeEventListener() {}
    focus() { if (doc.contains(this) && !this.disabled) doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 52, width: 100, height: 52 }; }
    getClientRects() { return [{ left: 0, top: 0, width: 100, height: 52 }]; }
    setPointerCapture() {} releasePointerCapture() {}
    dispatch(type, data = {}) {
      const event = {
        target: this, type, detail: 0, key: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
        repeat: false, isComposing: false, defaultPrevented: false, stopped: false, keyCode: 0,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
        getModifierState: () => false, ...data
      };
      for (let n = this; n; n = n.parentNode) {
        if (n["on" + type]) n["on" + type](event);
        for (const fn of n.events.get(type) || []) fn(event);
        if (event.stopped) break;
      }
      return event;
    }
    click() { if (!this.disabled) return this.dispatch("click"); }
  }
  function simple(n, selector) {
    if (n.tagName === "#TEXT") return false;
    const tag = selector.match(/^[a-z][\w-]*/i);
    if (tag && n.tagName !== tag[0].toUpperCase()) return false;
    for (const m of selector.matchAll(/#([\w-]+)/g)) if (n.id !== m[1]) return false;
    for (const m of selector.matchAll(/\.([\w-]+)/g)) if (!n.classList.contains(m[1])) return false;
    for (const m of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
      if (n.getAttribute(m[1]) === null) return false;
      if (m[2] !== undefined && n.getAttribute(m[1]) !== m[2]) return false;
    }
    return true;
  }
  function matches(n, selector) {
    return selector.split(",").some(part => {
      const bits = part.trim().split(/\s+(?![^\[]*\])/);
      let current = n;
      if (!bits.length || !simple(current, bits.pop())) return false;
      while (bits.length) {
        const bit = bits.pop(); current = current.parentNode;
        while (current && current !== doc && !simple(current, bit)) current = current.parentNode;
        if (!current || current === doc) return false;
      }
      return true;
    });
  }
  function parse(source, root) {
    const stack = [root];
    for (const m of source.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)) {
      if (m[0].startsWith("<!") || m[0].startsWith("<?")) continue;
      if (m[3] !== undefined) { stack.at(-1).appendChild(new Node("#text", decode(m[3]))); continue; }
      const tag = m[1].toLowerCase();
      if (m[0].startsWith("</")) { while (stack.length > 1) { const n = stack.pop(); if (n.tagName.toLowerCase() === tag) break; } continue; }
      const n = new Node(tag);
      for (const a of m[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) n.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
      if (tag === "input") {
        const ph = m[2].match(/placeholder\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (ph) n.placeholder = decode(ph[1] ?? ph[2] ?? ph[3] ?? "");
      }
      stack.at(-1).appendChild(n);
      if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) stack.push(n);
    }
  }
  doc = new Node("#document"); parse(html, doc);
  doc.body = doc.querySelector("body");
  doc.documentElement = doc.querySelector("html");
  doc.documentElement.dataset = {};
  for (const select of doc.querySelectorAll("select")) {
    const option = select.querySelector("[selected]") || select.querySelector("option");
    select.value = option?.getAttribute("value") ?? option?.textContent ?? "";
  }
  doc.activeElement = doc.body; doc.visibilityState = "visible";
  doc.createElement = tag => new Node(tag);
  const storage = new Map();
  const failKeys = new Set();
  const intervals = [];
  const winHandlers = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { if (failKeys.has(k)) throw new Error("QuotaExceededError"); storage.set(k, String(v)); },
    removeItem: k => storage.delete(k)
  };
  const speech = { voices: [], getVoices() { return []; }, speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} };
  const window = {
    document: doc, location: { protocol: "https:", href: "https://vocab.test/" }, localStorage,
    addEventListener(type, fn) { if (!winHandlers.has(type)) winHandlers.set(type, []); winHandlers.get(type).push(fn); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getSelection: () => ({ toString: () => "" }), innerWidth: 1200, innerHeight: 800,
    getComputedStyle: el => ({ fontSize: (el && el.style && el.style.fontSize) || "68px" })
  };
  window.speechSynthesis = speech;
  const sandbox = {
    window, document: doc, console, Date: ClockDate, localStorage,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class {}, performance: { now: () => now },
    speechSynthesis: speech, SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  vm.runInContext(cetSource, context, { filename: "cet-words-data.js" });
  vm.runInContext(combinedSource, context, { filename: "combined-words-data.js" });
  vm.runInContext(appSource, context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试入口");
  return {
    T, doc, window, storage, failKeys, intervals,
    query: s => doc.querySelector(s),
    all: s => doc.querySelectorAll(s),
    text(selector) { const el = doc.querySelector(selector); return el ? el.textContent : null; },
    html(selector) { const el = doc.querySelector(selector); return el ? el.innerHTML : null; },
    click(selector) { const el = doc.querySelector(selector); assert.ok(el, "应存在可点击节点 " + selector); el.click(); return el; },
    hasClass(selector, name) { const el = doc.querySelector(selector); return !!el && el.classList.contains(name); }
  };
}

/* ---------------- 断言计数 ---------------- */
let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log("PASS  " + label); }
  catch (e) { failed++; console.error("FAIL  " + label + "\n      " + (e && e.message ? e.message : e)); }
}
function section(title) { console.log("\n== " + title + " =="); }

/* ---------------- 场景辅助 ---------------- */
const MAIN_KEY = "kaoyan_vocab_v1";
function prepare(b, opts = {}) {
  const T = b.T;
  if (T.drillMode) T.exitDrill();
  if (T.isNewOnlySubgroup && T.isNewOnlySubgroup()) T.endNewOnlySubgroup();
  if (T.isExtraSubgroup && T.isExtraSubgroup()) T.endExtraSubgroup();
  T.switchBook("kaoyan");
  const S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = opts.timeSec || 0;
  Object.assign(S.settings, {
    dailyNew: opts.dailyNew === undefined ? 20 : opts.dailyNew,
    order: "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: "primary", singleCharKeys: true,
    dailyReviewCap: opts.cap === undefined ? 0 : opts.cap,
    groupSize: opts.groupSize === undefined ? 10 : opts.groupSize,
    backlogGuard: true,
    autoResume: {
      enabled: opts.autoResume !== false,
      threshold: opts.threshold === undefined ? 5 : opts.threshold,
      idleMs: opts.idleMs === undefined ? 120000 : opts.idleMs,
      countdownMs: 15000
    }
  });
  S.days[todayStr()] = { n: 0, r: 0, ok: 0, no: 0 };
  S.reviewDay = { d: todayStr(), used: opts.used || 0 };
  S.extraDay = { d: todayStr(), extra: 0 };
  T.startSession("main");
  return S;
}
function saveNow(b) { b.T.setReviewCap(Number(b.T.getS().settings.dailyReviewCap)); }
function stateSig(b) {
  const S = b.T.getS();
  return JSON.stringify({
    progress: S.progress, days: S.days, reviewDay: S.reviewDay, extraDay: S.extraDay,
    timeSec: S.timeSec, settings: S.settings
  });
}
function scopeIndices(b) {
  const out = [];
  for (let i = 0; i < b.T.getW().length; i++) if (b.T.inScope(i)) out.push(i);
  return out;
}
function markDue(b, count, opts = {}) {
  const S = b.T.getS();
  const picked = [];
  for (const i of scopeIndices(b)) {
    if (picked.length >= count) break;
    if (opts.skipQ && b.T.Q.includes(i)) continue;
    if (S.progress[i]) continue;
    S.progress[i] = [1, now - 5000, 1, 0, now - 86400000];
    picked.push(i);
  }
  return picked;
}
function completeGroup(b) {
  let guard = 0;
  while (b.T.cur != null && guard++ < 300) { b.T.judge(true); b.T.tryNext(); }
  return guard;
}
const currentWord = b => (b.T.cur == null ? null : b.T.getW()[b.T.cur].w);
function keyEvent(b) {
  return {
    type: "keydown", key: "j", code: "KeyJ", target: b.doc.body, detail: 0,
    ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false,
    defaultPrevented: false, keyCode: 74, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, getModifierState: () => false
  };
}

/* ===========================================================================
 * 0. 契约钩子与静态入口
 * =========================================================================== */
section("0. 契约钩子与静态入口");
{
  const b = browser();
  const T = b.T;
  check("saveAndRest / resumeFromRest / getRestState / isResting 均为函数", () => {
    for (const name of ["saveAndRest", "resumeFromRest", "getRestState", "isResting"]) {
      assert.equal(typeof T[name], "function", name + " 应为函数");
    }
  });
  check("真实 index.html 提供静态入口 #btnSaveRest「保存并休息」", () => {
    const btn = b.query("#btnSaveRest");
    assert.ok(btn, "应有 #btnSaveRest");
    assert.equal(btn.tagName, "BUTTON");
    assert.match(b.text("#btnSaveRest"), /保存并休息/);
  });
  check("会话快照键由 getSessionSnapshotKey 提供且与主记录键分离", () => {
    assert.equal(T.getSessionSnapshotKey("kaoyan"), "vocab_session_snapshot_kaoyan_v1");
    assert.notEqual(T.getSessionSnapshotKey("kaoyan"), MAIN_KEY);
  });
}

/* ===========================================================================
 * 1. 入口可见性
 * =========================================================================== */
section("1. 入口可见性：进行中/等待显示，完成页/空页/休息态隐藏");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  check("学习中有当前卡时显示 #btnSaveRest 且可用", () => {
    assert.notEqual(T.cur, null);
    assert.equal(b.query("#btnSaveRest").hidden, false);
    assert.equal(b.query("#btnSaveRest").disabled, false);
  });

  const b2 = browser();
  prepare(b2);
  b2.T.saveAndRest();
  check("休息态下 #btnSaveRest 隐藏", () => {
    assert.equal(b2.T.isResting(), true);
    assert.equal(b2.query("#btnSaveRest").hidden, true);
  });

  const b3 = browser();
  prepare(b3, { dailyNew: 3, groupSize: 3 });
  completeGroup(b3);
  check("完成页（无进行中的卡）隐藏 #btnSaveRest", () => {
    assert.equal(b3.T.cur, null);
    assert.equal(b3.query("#btnSaveRest").hidden, true);
  });

  const b4 = browser();
  const S4 = prepare(b4);
  S4.settings.fmin = 9999;      // 当前范围无任何词 → 普通空页
  b4.T.startSession("main");
  check("普通空页不显示 #btnSaveRest", () => {
    assert.equal(b4.T.cur, null);
    assert.equal(b4.T.getAutoResumeState().emptyPage, true);
    assert.equal(b4.query("#btnSaveRest").hidden, true);
  });
  check("本页显式等待到期时显示 #btnSaveRest", () => {
    assert.equal(b4.T.startEmptyWait(), true);
    assert.equal(b4.T.getAutoResumeState().waitingForDue, true);
    assert.equal(b4.query("#btnSaveRest").hidden, false);
  });
  check("退出等待后 #btnSaveRest 重新隐藏", () => {
    b4.T.stopEmptyWait();
    assert.equal(b4.T.getAutoResumeState().waitingForDue, false);
    assert.equal(b4.query("#btnSaveRest").hidden, true);
  });
}

/* ===========================================================================
 * 2. 成功保存：记录落盘 + 现场快照 + 休息页 + 继续本组
 * =========================================================================== */
section("2. 成功保存（已揭示）：记录落盘、快照有效、休息页文案与继续本组");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  T.judge(true);
  assert.equal(T.phase, "revealed");
  const curBefore = T.cur, wordBefore = currentWord(b), phaseBefore = T.phase, verdictBefore = T.verdict;
  const answeredBefore = T.answered, totalBefore = T.getGroupTotal();
  const sigBeforeRest = stateSig(b);

  let result = null;
  check("saveAndRest() 返回 {ok,resting,saved,snapshot,error} 且成功", () => {
    result = T.saveAndRest();
    for (const k of ["ok", "resting", "saved", "snapshot"]) assert.ok(k in result, "结果应含 " + k);
    assert.equal(result.error, null, "成功时 error===null（契约字段）");
    assert.equal(result.ok, true);
    assert.equal(result.resting, true);
    assert.equal(result.saved, true);
    assert.equal(result.snapshot, true);
  });
  check("主记录已落盘且与内存一致（progress/days/reviewDay/extraDay/timeSec）", () => {
    const raw = b.storage.get(MAIN_KEY);
    assert.ok(raw, "应有主记录");
    const saved = JSON.parse(raw);
    const S = T.getS();
    assert.deepEqual(saved.progress, clone(S.progress));
    assert.deepEqual(saved.days, clone(S.days));
    assert.deepEqual(saved.reviewDay, clone(S.reviewDay));
    assert.deepEqual(saved.extraDay, clone(S.extraDay));
    assert.equal(saved.timeSec, S.timeSec);
    assert.equal(saved.settings.dailyNew, 20);
    assert.equal(saved.settings.groupSize, 10);
  });
  check("会话快照已写入且 getSessionSnapshotState().valid===true", () => {
    const st = T.getSessionSnapshotState();
    assert.equal(st.present, true);
    assert.equal(st.valid, true);
    assert.equal(st.data.plan.kind, "main");
    assert.equal(st.data.cur, wordBefore);
  });
  check("页面显示 #card .done-rest，含「已保存，先休息」与「本组进度 1/10」，不写「本组完成」", () => {
    assert.ok(b.query("#card .done-rest"), "休息页应有 #card .done-rest");
    assert.match(b.text("#card"), /已保存，先休息/);
    assert.match(b.text("#card"), /本组进度\s*1\s*\/\s*10/);
    assert.doesNotMatch(b.text("#card"), /本组完成/);
  });
  check("#acts 提供 #restResume「继续本组」与 #goStats", () => {
    assert.ok(b.query("#restResume"), "应有 #restResume");
    assert.match(b.text("#restResume"), /继续本组/);
    assert.ok(b.query("#goStats"), "应有 #goStats");
    assert.equal(b.query("#restResume").hidden, false);
  });
  check("休息不改变学习记录/设置/时长/台账", () => {
    assert.equal(stateSig(b), sigBeforeRest);
    assert.equal(T.getS().timeSec, 0);
  });
  check("getRestState() 如实反映休息态与保存结果", () => {
    const rs = T.getRestState();
    assert.equal(rs.resting, true);
    assert.equal(rs.cur, curBefore);
    assert.equal(rs.answered, answeredBefore);
    assert.equal(rs.groupTotal, totalBefore);
    assert.equal(rs.restState.snapshotSaved, true);
    assert.equal(typeof rs.restState.savedAt, "number");
  });
  check("休息期间判定/翻页/撤销被统一守卫拒绝（error===\"resting\"）且记录不变", () => {
    const sig = stateSig(b);
    for (const action of ["know", "dont", "next", "undo"]) {
      const r = T.runStudyAction(action, { event: keyEvent(b), source: "keyboard" });
      assert.equal(r.ok, false, action + " 应被拒绝");
      assert.equal(r.error, "resting", action + " 应返回 resting");
    }
    assert.equal(stateSig(b), sig);
    assert.equal(T.answered, answeredBefore);
    assert.equal(T.verdict, verdictBefore);
  });
  check("点 #restResume 回到同一 cur / phase / verdict / 进度，且撤销栈仍可用", () => {
    b.click("#restResume");
    assert.equal(T.isResting(), false);
    assert.equal(T.cur, curBefore);
    assert.equal(T.phase, phaseBefore);
    assert.equal(T.verdict, verdictBefore);
    assert.equal(T.answered, answeredBefore);
    assert.equal(currentWord(b), wordBefore);
    const undoAction = T.deriveStudyPresentation().actions.find(a => a.id === "undo");
    assert.equal(undoAction.enabled, true, "休息→继续后撤销应可用");
    T.undo();
    assert.equal(T.answered, 0, "撤销休息前的判定");
    assert.equal(T.verdict, null);
    assert.equal(T.phase, "recall");
  });
}

/* ===========================================================================
 * 3. 0 判定开组即休息 + 刷新恢复
 * =========================================================================== */
section("3. 0 判定开组即休息，刷新后恢复同一张卡（休息页不持久化）");
{
  const b = browser();
  const T = b.T;
  prepare(b, { groupSize: 10 });
  const curBefore = T.cur;
  const sigBefore = stateSig(b);
  check("0 判定开组即可保存并休息，文案 0/10", () => {
    const r = T.saveAndRest();
    assert.equal(r.ok, true);
    assert.equal(r.resting, true);
    assert.equal(T.answered, 0);
    assert.match(b.text("#card"), /本组进度\s*0\s*\/\s*10/);
    assert.equal(stateSig(b), sigBefore, "0 判定休息不改记录");
  });
  check("休息中模拟刷新：mode===\"restored\"、同一张卡、recall/verdict=null", () => {
    const r = T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.equal(T.cur, curBefore);
    assert.equal(T.phase, "recall");
    assert.equal(T.verdict, null);
    assert.equal(currentWord(b), b.T.getW()[curBefore].w);
  });
  check("刷新后 isResting()===false（休息页本身不持久化）且快照仍有效", () => {
    assert.equal(T.isResting(), false);
    assert.equal(T.getSessionSnapshotState().valid, true);
    assert.equal(T.getPlan().kind, "main");
  });
}

/* ===========================================================================
 * 4. 已揭示休息 + 刷新恢复（不重复记账）
 * =========================================================================== */
section("4. 已揭示休息，刷新后恢复同一判定现场且不重复提交");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  T.judge(true);
  const word = currentWord(b);
  const progressBefore = JSON.stringify(T.getS().progress[T.cur]);
  const dayBefore = JSON.stringify(T.getS().days[todayStr()]);
  const answeredBefore = T.answered;
  check("已揭示现场保存休息成功", () => {
    const r = T.saveAndRest();
    assert.equal(r.ok, true);
    assert.equal(r.resting, true);
    assert.equal(T.phase, "revealed");
  });
  check("休息刷新后恢复同一张卡与同一判定，且不重复累计记录", () => {
    const r = T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.equal(currentWord(b), word);
    assert.equal(T.phase, "revealed");
    assert.equal(T.verdict, true);
    assert.equal(T.answered, answeredBefore);
    assert.equal(JSON.stringify(T.getS().progress[T.cur]), progressBefore);
    assert.equal(JSON.stringify(T.getS().days[todayStr()]), dayBefore);
    assert.equal(T.isResting(), false);
  });
}

/* ===========================================================================
 * 5. 额度暂停（capPaused）休息：不消费额度、不标记完成、不增时长
 * =========================================================================== */
section("5. 额度暂停（capPaused）休息：保留现场、不消费复习额度、不增时长");
{
  const b = browser();
  const T = b.T;
  const S = prepare(b, { cap: 1, groupSize: 10, timeSec: 42 });
  markDue(b, 4);
  S.reviewDay = { d: todayStr(), used: 1 };
  saveNow(b);
  T.startSession("main");
  check("构造出额度暂停：当前卡是复习卡且预算为 0", () => {
    assert.notEqual(T.cur, null);
    assert.equal(T.isCapPaused(), true);
    assert.equal(T.getReviewLedger().used, 1);
    assert.equal(T.getCapLeft(), 0);
  });
  const dayBefore = JSON.stringify(T.getS().days[todayStr()]);
  const doneBefore = T.getGroupInfo().done;
  const sigBefore = stateSig(b);
  check("额度暂停页可保存并休息，进入休息页", () => {
    const r = T.saveAndRest();
    assert.equal(r.ok, true);
    assert.equal(r.resting, true);
    assert.equal(T.isResting(), true);
    assert.ok(b.query("#card .done-rest"), "休息页应有 #card .done-rest");
  });
  check("休息不消费复习额度、不标记完成、不增加学习时长、不改设置/日统计", () => {
    assert.equal(T.getReviewLedger().used, 1, "台账不变");
    assert.equal(T.getS().timeSec, 42, "学习时长不增加");
    assert.equal(JSON.stringify(T.getS().days[todayStr()]), dayBefore);
    assert.equal(T.getGroupInfo().done, doneBefore);
    assert.notEqual(T.cur, null, "仍有进行中的卡，不算完成");
    assert.equal(JSON.parse(b.storage.get(MAIN_KEY)).timeSec, 42);
    assert.equal(stateSig(b), sigBefore);
  });
  check("休息刷新后恢复同一张卡并仍处于额度暂停", () => {
    const r = T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.equal(T.isResting(), false);
    assert.equal(T.isCapPaused(), true);
    assert.equal(T.getPlan().kind, "main");
    assert.equal(T.getReviewLedger().used, 1);
  });
}

/* ===========================================================================
 * 6. 保存失败：不进入休息页、不谎报成功、可重试
 * =========================================================================== */
section("6. 保存失败：不休息、不谎报「已保存」、显示持续错误与重试入口");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  T.judge(true);
  const sigBefore = stateSig(b);
  b.failKeys.add(MAIN_KEY);
  let failResult = null;
  check("主记录写失败时 saveAndRest() 返回 ok=false / error=\"storage\" 且未休息", () => {
    failResult = T.saveAndRest();
    assert.equal(failResult.ok, false);
    assert.equal(failResult.resting, false);
    assert.equal(failResult.saved, false);
    assert.equal(failResult.snapshot, false);
    assert.equal(failResult.error, "storage");
    assert.equal(T.isResting(), false);
    assert.equal(b.query("#card .done-rest"), null, "不得进入休息页");
  });
  check("保存失败显示 #appAlert（可见、含「未保存」类文案）", () => {
    assert.equal(b.query("#appAlert").hidden, false);
    assert.match(b.text("#appAlertTitle") + b.text("#appAlertBody"), /未保存/);
    assert.match(b.text("#appAlertBody"), /本页学习现场仍在内存中/);
  });
  check("保存失败提供「重试保存并休息」与「导出备份」入口", () => {
    const labels = b.all("#appAlertActions button").map(x => x.textContent);
    assert.ok(labels.some(t => /重试保存并休息/.test(t)), "应有重试入口：" + JSON.stringify(labels));
    assert.ok(labels.some(t => /导出备份/.test(t)), "应保留导出入口");
  });
  check("保存失败不得 toast「已保存」且本页记录不变", () => {
    const toastText = b.text("#toast") || "";
    assert.doesNotMatch(toastText, /已保存/);
    assert.equal(stateSig(b), sigBefore);
  });
  check("恢复可写后点重试成功进入休息页，持续错误提示关闭", () => {
    b.failKeys.delete(MAIN_KEY);
    const retry = b.all("#appAlertActions button").find(x => /重试保存并休息/.test(x.textContent));
    assert.ok(retry, "应有重试按钮");
    retry.click();
    assert.equal(T.isResting(), true);
    assert.ok(b.query("#card .done-rest"), "重试后应进入休息页");
    assert.equal(b.query("#appAlert").hidden, true);
    assert.equal(T.getSessionSnapshotState().valid, true);
  });
}

/* ===========================================================================
 * 7. 会话快照写入失败但主记录成功：仍休息，但不声称现场已保存
 * =========================================================================== */
section("7. 快照写入失败但主记录成功：文案如实说明现场未写入浏览器");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  T.judge(true);
  const word = currentWord(b);
  const snapKey = T.getSessionSnapshotKey();
  b.failKeys.add(snapKey);
  let result = null;
  check("只让会话快照键写失败：主记录成功、仍进入休息页", () => {
    result = T.saveAndRest();
    assert.equal(result.ok, true);
    assert.equal(result.resting, true);
    assert.equal(result.saved, true);
    assert.equal(result.snapshot, false);
    assert.equal(T.isResting(), true);
  });
  check("休息页明确「本页现场未能写入浏览器」且不声称现场已保存", () => {
    const cardText = b.text("#card");
    assert.match(cardText, /本页现场未能写入浏览器/);
    assert.doesNotMatch(cardText, /现场也已写入/);
    assert.doesNotMatch(cardText, /可以继续这一张/);
  });
  check("getRestState().restState.snapshotSaved===false", () => {
    const rs = T.getRestState();
    assert.equal(rs.resting, true);
    assert.equal(rs.restState.snapshotSaved, false);
    assert.equal(rs.cur != null && T.getW()[rs.cur].w, word);
  });
  check("toast 与提示行如实说明刷新后可能无法回到这一张", () => {
    assert.match(b.text("#toast") || "", /未能写入浏览器/);
    assert.match(b.text("#hint") || "", /未写入浏览器/);
    assert.doesNotMatch(b.text("#toast") || "", /现场已保留/);
  });
  check("主记录仍已成功落盘（快照失败不影响学习记录）", () => {
    const saved = JSON.parse(b.storage.get(MAIN_KEY));
    assert.equal(JSON.stringify(saved.progress), JSON.stringify(T.getS().progress));
    assert.ok(saved.days[todayStr()]);
  });
}

/* ===========================================================================
 * 8. 特训中先回父现场再保存
 * =========================================================================== */
section("8. 错词特训中调用 saveAndRest()：先回父现场，再保存主组");
{
  const b = browser();
  const T = b.T;
  prepare(b, { groupSize: 10 });
  const S = T.getS();
  const parentCur = T.cur;
  const parentQ = T.Q.slice();
  const parentAnswered = T.answered;
  // 准备若干错词（不在主组队列内，避免干扰父现场）
  let wrongMarked = 0;
  for (let i = 0; i < T.getW().length && wrongMarked < 3; i++) {
    if (!T.inScope(i) || T.Q.includes(i) || S.progress[i]) continue;
    S.progress[i] = [1, now + 86400000, 1, 2, now - 1000];
    wrongMarked++;
  }
  saveNow(b);
  check("构造进入错词特训", () => {
    assert.equal(T.startDrill(), true);
    assert.equal(T.drillMode, true);
    assert.ok(T.Q.length > 0);
  });
  let result = null;
  check("特训中 saveAndRest()：先退出特训、再进入休息页", () => {
    result = T.saveAndRest();
    assert.equal(result.ok, true);
    assert.equal(result.resting, true);
    assert.equal(T.drillMode, false);
    assert.equal(T.isResting(), true);
    assert.ok(b.query("#card .done-rest"), "特训中保存后应进入休息页");
  });
  check("主组快照仍是父现场：valid、plan.kind===\"main\"、cur 是父组当前词", () => {
    const st = T.getSessionSnapshotState();
    assert.equal(st.valid, true);
    assert.equal(st.data.plan.kind, "main");
    assert.equal(st.data.cur, T.getW()[parentCur].w);
    assert.equal(T.cur, parentCur);
    assert.equal(JSON.stringify(T.Q), JSON.stringify(parentQ));
    assert.equal(T.answered, parentAnswered);
  });
  check("休息刷新后回到父组同一张卡（不是特训现场）", () => {
    const r = T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.equal(T.cur, parentCur);
    assert.equal(T.drillMode, false);
  });
}

/* ===========================================================================
 * 9. 受控加量子组中先回父现场再保存
 * =========================================================================== */
section("9. 受控加量子组中调用 saveAndRest()：先回父组现场，再保存主组");
{
  const b = browser();
  const T = b.T;
  const S = prepare(b, { cap: 1, groupSize: 10 });
  markDue(b, 4);
  S.reviewDay = { d: todayStr(), used: 1 };
  saveNow(b);
  T.startSession("main");
  assert.equal(T.isCapPaused(), true);
  const parentCur = T.cur;
  const parentWord = currentWord(b);
  const parentQ = T.Q.slice();
  check("构造进入受控加量子组（父组额度暂停）", () => {
    assert.equal(T.startExtraSubgroup(), true);
    assert.equal(T.isExtraSubgroup(), true);
    assert.notEqual(currentWord(b), parentWord, "子组当前词与父组不同");
  });
  let result = null;
  check("子组中 saveAndRest()：先回父现场、再进入休息页", () => {
    result = T.saveAndRest();
    assert.equal(result.ok, true);
    assert.equal(result.resting, true);
    assert.equal(T.isExtraSubgroup(), false);
    assert.equal(T.isResting(), true);
    assert.equal(currentWord(b), parentWord, "cur 是父组当前词");
    assert.equal(T.cur, parentCur);
  });
  check("不把子组现场写成主组快照：valid、plan.kind===\"main\"、队列为父组队列", () => {
    const st = T.getSessionSnapshotState();
    assert.equal(st.valid, true);
    assert.equal(st.data.plan.kind, "main");
    assert.equal(st.data.cur, parentWord);
    assert.equal(JSON.stringify(T.Q), JSON.stringify(parentQ));
    assert.equal(JSON.parse(b.storage.get(MAIN_KEY)).progress && true, true);
  });
  check("休息刷新后回到父组同一张卡且仍为额度暂停", () => {
    const r = T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.equal(currentWord(b), parentWord);
    assert.equal(T.isExtraSubgroup(), false);
    assert.equal(T.isCapPaused(), true);
  });
}

/* ===========================================================================
 * 10. 原快捷键一次改判保护在休息→继续后保持
 * =========================================================================== */
section("10. 原快捷键一次改判保护在休息→继续后保持");
{
  const b = browser();
  const T = b.T;
  prepare(b);
  T.judge(true);
  check("休息前：键盘第一次改判允许，answerChanges 记为 1", () => {
    const r = T.runStudyAction("dont", { event: keyEvent(b), source: "keyboard" });
    assert.equal(r.ok, true);
    assert.equal(T.verdict, false);
    assert.equal(T.answerChanges, 1);
  });
  T.saveAndRest();
  b.click("#restResume");
  check("休息→继续后：第二次键盘改判仍被「快捷改判已用过」拒绝", () => {
    const r = T.runStudyAction("know", { event: keyEvent(b), source: "keyboard" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "answer-change-limit");
    assert.equal(T.verdict, false, "被拒绝时不改判");
    assert.equal(T.answerChanges, 1);
  });
  check("休息→继续后：明确按钮/程序改判仍立即生效", () => {
    const r = T.runStudyAction("know", { source: "program" });
    assert.equal(r.ok, true);
    assert.equal(T.verdict, true);
  });
  check("休息前后学习记录与设置不因休息改变", () => {
    const S = T.getS();
    assert.equal(S.settings.dailyNew, 20);
    assert.equal(S.settings.groupSize, 10);
    assert.equal(S.timeSec, 0);
  });
}

/* ===========================================================================
 * 11. 等待页「保存并休息」：只退出等待，不伪装完成/不进入休息页
 * =========================================================================== */
section("11. 本页等待时保存：退出等待、不伪装完成");
{
  const b = browser();
  const T = b.T;
  const S = prepare(b);
  S.settings.fmin = 9999;
  T.startSession("main");
  assert.equal(T.startEmptyWait(), true);
  check("等待页可保存并退出等待，不进入休息页、不伪造完成", () => {
    const r = T.saveAndRest();
    assert.equal(r.ok, true);
    assert.equal(r.resting, false, "等待页没有进行中的卡，不进入休息页");
    assert.equal(T.isResting(), false);
    assert.equal(T.getAutoResumeState().waitingForDue, false);
    assert.equal(b.query("#card .done-rest"), null);
    assert.equal(T.answered, 0);
    assert.equal(T.getGroupTotal(), 0);
  });
  check("等待页保存后主记录已写入（下次启动正常安全开组）", () => {
    assert.ok(b.storage.get(MAIN_KEY), "应有主记录");
    assert.equal(T.getAutoResumeState().emptyPage, true);
  });
}

/* ===========================================================================
 * 12. 复核 P1-1：autoResumeRestHeld 不因「有卡休息→继续」泄漏
 * =========================================================================== */
section("12. 复核 P1-1：有卡休息→继续后不残留「已选择先休息」抑制");
{
  const b = browser();
  const T = b.T;
  prepare(b, { dailyNew: 20, groupSize: 5, threshold: 1, idleMs: 2000 });
  T.saveAndRest();
  check("有卡休息页点 #restResume 后可继续并走完本组", () => {
    assert.equal(T.isResting(), true);
    b.click("#restResume");
    assert.equal(T.isResting(), false);
    completeGroup(b);
    assert.equal(T.cur, null);
    assert.equal(T.getPlan().kind, "main");
  });
  check("走完本组后自动续背资格恢复，状态区不再显示「本次已选择先休息」", () => {
    const st = T.getAutoResumeState();
    assert.equal(st.completedPage, true);
    assert.equal(st.eligible, true);
    assert.doesNotMatch(b.text("#autoResumeText") || "", /本次已选择先休息/);
    assert.equal(T.getAutoResumePause().pausedToday, false);
    assert.equal(b.storage.has(T.autoResumeLeaseKey), false, "未自动开组、不抢租约");
  });

  const b2 = browser();
  const T2 = b2.T;
  const S2 = prepare(b2, { dailyNew: 20 });
  S2.settings.fmin = 9999;
  T2.startSession("main");
  check("空页等待保存退出后再次进入等待不被旧「先休息」抑制", () => {
    assert.equal(T2.startEmptyWait(), true);
    const r = T2.saveAndRest();
    assert.equal(r.ok, true);
    assert.equal(r.resting, false);
    assert.equal(T2.getAutoResumeState().waitingForDue, false);
    assert.equal(T2.startEmptyWait(), true, "重新进入本页等待应成功");
    assert.equal(T2.getAutoResumeState().waitingForDue, true);
    assert.equal(T2.getAutoResumeState().eligible, true);
    assert.doesNotMatch(b2.text("#autoResumeText") || "", /已选择先休息/);
  });
}

/* ===========================================================================
 * 13. 复核 P2-1：休息页隐藏「设置待应用」与刷新恢复提示
 * =========================================================================== */
section("13. 复核 P2-1：休息页隐藏待应用/恢复提示，继续本组后恢复显示");
{
  const b = browser();
  const T = b.T;
  prepare(b, { groupSize: 10 });
  T.setGroupSize(6);
  check("改每组词数制造待应用：#planPendingNotice 正常可见", () => {
    assert.equal(T.hasPendingScopeSettings(), true);
    assert.equal(b.query("#planPendingNotice").hidden, false);
  });
  T.judge(true);
  T.saveAndRest();
  check("休息页隐藏待应用提示与恢复提示", () => {
    assert.equal(T.isResting(), true);
    assert.equal(b.query("#planPendingNotice").hidden, true);
    assert.equal(b.query("#resumeNotice").hidden, true);
  });
  check("点 #restResume 回到本组后待应用提示重新显示", () => {
    b.click("#restResume");
    assert.equal(T.isResting(), false);
    assert.equal(b.query("#planPendingNotice").hidden, false);
    assert.equal(T.hasPendingScopeSettings(), true);
  });

  const b2 = browser();
  const T2 = b2.T;
  prepare(b2, { groupSize: 10 });
  T2.judge(true);
  const rl = T2.simulateReload();
  check("刷新恢复提示在休息页隐藏（平时可见，休息态不得叠加）", () => {
    assert.equal(rl.mode, "restored");
    assert.equal(b2.query("#resumeNotice").hidden, false, "恢复后平时可见");
    T2.saveAndRest();
    assert.equal(T2.isResting(), true);
    assert.equal(b2.query("#resumeNotice").hidden, true);
    assert.equal(b2.query("#planPendingNotice").hidden, true);
  });
}

/* ===========================================================================
 * 14. 复核 P2-5：保存失败重试回到原动作（停靠目标收尾）
 * =========================================================================== */
section("14. 复核 P2-5：保存失败重试回到停靠目标收尾动作");
{
  const b = browser();
  const T = b.T;
  prepare(b, { dailyNew: 20, groupSize: 5 });
  T.setStopTarget();
  completeGroup(b);
  check("完成页停靠目标达标，「今天先到这里」可见", () => {
    assert.equal(T.cur, null);
    assert.equal(T.getStopTarget().reached, true);
    assert.equal(b.query("#stopTargetRest").hidden, false);
    assert.match(b.text("#stopTargetRest"), /今天先到这里/);
  });
  b.failKeys.add(MAIN_KEY);
  b.click("#stopTargetRest");
  check("主记录写失败：显示持续错误，目标与完成页现场保留", () => {
    assert.equal(b.query("#appAlert").hidden, false);
    assert.equal(T.isResting(), false);
    assert.equal(T.cur, null);
    assert.equal(T.getStopTarget() && T.getStopTarget().reached, true);
    const labels = b.all("#appAlertActions button").map(x => x.textContent);
    assert.ok(labels.some(t => /重试保存并休息/.test(t)), "应有重试入口：" + JSON.stringify(labels));
  });
  b.failKeys.delete(MAIN_KEY);
  const retry = b.all("#appAlertActions button").find(x => /重试保存并休息/.test(x.textContent));
  check("恢复可写后重试重走停靠目标收尾：写今日暂停键并清目标", () => {
    assert.ok(retry, "应有重试按钮");
    retry.click();
    assert.equal(T.getAutoResumePause().pausedToday, true);
    assert.equal(T.getStopTarget(), null);
    assert.equal(T.isResting(), false);
    assert.equal(T.cur, null);
    assert.equal(b.query("#appAlert").hidden, true);
    assert.match(b.text("#toast") || "", /今天可以先到这里/);
  });
}

/* ===========================================================================
 * 15. 独立审查：休息态不得从保留的特训入口替换主组现场
 * =========================================================================== */
section("15. 休息态的错词特训入口不能替换已保存现场");
{
  const b = browser(), T = b.T;
  prepare(b, { groupSize: 10 });
  T.judge(false);
  T.saveAndRest();
  const before = JSON.stringify({Q: T.Q, cur: T.cur, answered: T.answered, phase: T.phase, verdict: T.verdict});
  check("休息页不保留可点击的错词特训入口", () => {
    const btn = b.query("#btnDrill");
    assert.ok(btn.hidden || btn.disabled, "不能把休息页当前卡换成特训卡后仍标为已保存");
  });
  check("程序调用 startDrill 也不能绕过休息态，原Q/cur/判定保持", () => {
    assert.equal(T.startDrill(), false);
    assert.equal(T.drillMode, false);
    assert.equal(T.isResting(), true);
    assert.equal(JSON.stringify({Q: T.Q, cur: T.cur, answered: T.answered, phase: T.phase, verdict: T.verdict}), before);
  });
  check("明确继续本组后错词特训仍可正常进入和返回", () => {
    T.resumeFromRest();
    assert.equal(T.startDrill(), true);
    assert.equal(T.drillMode, true);
    T.exitDrill();
    assert.equal(T.drillMode, false);
    assert.equal(T.isResting(), false);
    assert.equal(JSON.stringify({Q: T.Q, cur: T.cur, answered: T.answered, phase: T.phase, verdict: T.verdict}), before);
  });
}

section("16. 重复保存休息调用如实保留快照失败状态");
{
  const b = browser(), T = b.T;
  prepare(b);
  T.judge(true);
  b.failKeys.add(T.getSessionSnapshotKey());
  const first = T.saveAndRest();
  check("首次快照失败仍按合同进入休息但明确snapshot=false", () => {
    assert.equal(first.ok, true);
    assert.equal(first.snapshot, false);
    assert.equal(T.getRestState().restState.snapshotSaved, false);
  });
  check("重复调用不能把未写入现场谎报为snapshot=true", () => {
    const second = T.saveAndRest();
    assert.equal(second.ok, true);
    assert.equal(second.already, true);
    assert.equal(second.snapshot, false);
    assert.equal(T.getRestState().restState.snapshotSaved, false);
  });
}

section("17. 休息后熟练标记使快照失效，不再声称刷新可回当前卡");
{
  const b = browser(), T = b.T;
  prepare(b);
  T.judge(true);
  const wordIndex = T.cur;
  T.saveAndRest();
  T.setProficient(wordIndex, true);
  check("当前词标熟练后仍保留休息选择，已清除旧快照并跳过熟练词", () => {
    assert.equal(T.isResting(), true);
    assert.notEqual(T.cur, wordIndex);
    assert.equal(T.getSessionSnapshotState().present, false);
  });
  check("快照被熟练操作清除后，状态和页面均不能再宣称现场已写入", () => {
    assert.equal(T.getRestState().restState.snapshotSaved, false);
    assert.match(b.text("#card"), /本页现场未能写入浏览器/);
    assert.doesNotMatch(b.text("#card"), /现场也已写入/);
    assert.equal(T.saveAndRest().snapshot, false);
  });
}

section("18. 休息组最后一词被移出后，不困在没有继续入口的休息态");
{
  const b = browser(), T = b.T;
  prepare(b, { groupSize: 1, dailyNew: 20, threshold: 1 });
  T.judge(true);
  const lastWord = T.cur;
  const dayBefore = JSON.stringify(T.getS().days[todayStr()]);
  const ledgerBefore = JSON.stringify(T.getReviewLedger());
  T.saveAndRest();
  T.setProficient(lastWord, true);
  check("休息组最后一词标熟练后自然结束休息，但不自动开启下一组", () => {
    assert.equal(T.cur, null);
    assert.equal(T.isResting(), false);
    assert.equal(b.query("#restResume"), null);
    assert.ok(b.query("#again"), "无卡后保留明确的手动继续入口");
    assert.equal(T.getAutoResumeState().eligible, false, "尊重刚选择的休息，不自动补新组");
    assert.equal(JSON.stringify(T.getS().days[todayStr()]), dayBefore);
    assert.equal(JSON.stringify(T.getReviewLedger()), ledgerBefore);
  });
  check("无卡收尾后明确继续可开始下一组，不再返回resting错误", () => {
    const r = T.runStudyAction("continue", {source: "program"});
    assert.equal(r.ok, true);
    assert.notEqual(T.cur, null);
    assert.notEqual(T.cur, lastWord);
    assert.equal(T.isResting(), false);
    assert.equal(T.answered, 0, "开组不自动判定");
  });
}

/* ---------------- 汇总 ---------------- */
console.log("\n结果：" + passed + " 通过 / " + failed + " 失败");
process.exit(failed ? 1 : 0);
