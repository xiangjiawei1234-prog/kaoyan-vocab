/**
 * R04「5 词停靠目标 + 纯复习小组」Node 回归。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱）；DOM 桩只模拟浏览器（解析 innerHTML、支持
 * querySelector/click/focus），受控时钟 + 可注入写失败的 localStorage，不复制业务逻辑。
 *
 * 覆盖：
 *  - 停靠目标只在普通主组可设（特训/子组/纯复习/无卡/休息态拒绝），返回 {ok,progress:{goal:5,done,reached}}；
 *  - 计数只累计设定后首次有效作答的不同单词：改判不重复、不会→本组重考再判不重复、撤销首次判定回退、
 *    撤销改判不回退、设定目标前的判定不计入；
 *  - UI：#stopTarget 进度 N/5、#stopTargetCancel；达标后 #stopTargetRest/#stopTargetContinue 与
 *    「剩余/待巩固已保留」文案；取消/继续清空；目标不写 settings/备份/进度；
 *  - 完成页达标时自动续背被按住（eligible=false、startAutoResumeNow=false 且不写存储/不判定），
 *    状态区含停靠目标说明；点继续=显式继续（候选够即开普通主组；候选不足停完成页且资格恢复）；
 *    「今天先到这里」写既有今日暂停键、不改长期 autoResume；
 *  - 纯复习候选口径：当前范围、非熟练、有主学习进度、未掌握、p[1]<=now、受今日剩余复习预算截断；
 *  - startReviewOnly：kind="reviewOnly"、Q.length=min(5,due,budget)、不学新词、不改 dailyNew/新词额度；
 *    预算已满/无到期词的 reason 与按钮/入口状态；
 *  - reviewOnly 快照：valid、plan.kind/groupSize、刷新恢复同一卡与纯复习类型、hasPendingScopeSettings=false；
 *    非法 kind / groupSize=30 的负向拒绝且不卸载主记录；
 *  - 纯复习完成页文案与按钮、无自动续背、可显式「开始普通学习」，且不打乱主学习边界；
 *  - 批次A复核修复：reviewOnly 冻结 baseGroupSize 的待应用口径与快照校验（删除即 bad-plan）、
 *    reviewOnly 完成页 #again 可用性（无候选 disabled、有候选可用）与额度暂停收尾文案「开始普通学习」、
 *    显式重开保持 reviewOnly（无候选返回 false 且现场不变）、完成页「继续学习」走统一动作守卫。
 *
 * 运行：node --max-old-space-size=512 js/test-micro-learning.mjs
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
const MASTER = 11;   // app.js：STAGE_COUNT(10) + 1

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
    click(selector) { const el = doc.querySelector(selector); assert.ok(el, "应存在可点击节点 " + selector); el.click(); return el; }
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
function newScene(opts = {}) {
  const b = browser();
  const T = b.T;
  const S = T.getS();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {}; S.timeSec = 0;
  Object.assign(S.settings, {
    dailyNew: opts.dailyNew === undefined ? 20 : opts.dailyNew,
    order: "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: "primary", singleCharKeys: true,
    dailyReviewCap: opts.cap === undefined ? 0 : opts.cap,
    groupSize: opts.groupSize === undefined ? 10 : opts.groupSize,
    backlogGuard: true,
    autoResume: { enabled: opts.autoResume !== false, threshold: opts.threshold === undefined ? 5 : opts.threshold, idleMs: 120000, countdownMs: 15000 }
  });
  S.days[todayStr()] = { n: 0, r: 0, ok: 0, no: 0 };
  S.reviewDay = { d: todayStr(), used: opts.used || 0 };
  S.extraDay = { d: todayStr(), extra: 0 };
  T.startSession("main");
  return { b, T, S };
}
function completeGroup(T) {
  let guard = 0;
  while (T.cur != null && guard++ < 300) { T.judge(true); T.tryNext(); }
  return guard;
}
function saveNow(T) { T.setReviewCap(Number(T.getS().settings.dailyReviewCap)); }
function markDue(T, S, count, opts = {}) {
  const picked = [];
  for (let i = 0; i < T.getW().length && picked.length < count; i++) {
    if (!T.inScope(i) || S.progress[i]) continue;
    if (opts.skipQ && T.Q.includes(i)) continue;
    S.progress[i] = [1, now - 5000, 1, 0, now - 86400000];
    picked.push(i);
  }
  return picked;
}
const wordOf = (T, i) => (T.getW()[i] ? T.getW()[i].w : null);
const currentWord = b => (b.T.cur == null ? null : b.T.getW()[b.T.cur].w);
const sigOf = (S, keys) => JSON.stringify(keys.map(k => S[k]));

/* ===========================================================================
 * 0. 契约钩子、常量与静态节点
 * =========================================================================== */
section("0. 契约钩子、常量与静态节点");
{
  const b = browser();
  const T = b.T;
  check("停靠目标/纯复习测试钩子齐全", () => {
    for (const name of ["setStopTarget", "clearStopTarget", "restFromStopTarget", "getStopTarget",
      "getReviewOnlyCandidates", "startReviewOnly", "reviewOnlyEntryAvailable"]) {
      assert.equal(typeof T[name], "function", name + " 应为函数");
    }
  });
  check("停靠目标与纯复习小组规模均为 5", () => {
    assert.equal(T.stopTargetSize, 5);
    assert.equal(T.reviewOnlySize, 5);
  });
  check("index.html 提供静态停靠目标入口与状态面板（初始隐藏）", () => {
    for (const sel of ["#btnStopTarget", "#stopTarget", "#stopTargetText", "#stopTargetRest", "#stopTargetContinue", "#stopTargetCancel"]) {
      assert.ok(b.query(sel), "应有 " + sel);
    }
    assert.equal(b.query("#stopTarget").hidden, true);
    assert.match(b.text("#btnStopTarget"), /学\s*5\s*词就停/);
  });
}

/* ===========================================================================
 * 1. 设定上下文：只在普通主组且 cur!=null 可设
 * =========================================================================== */
section("1. setStopTarget 上下文：只有进行中的普通主组可设");
{
  const { b, T } = newScene({ groupSize: 10 });
  check("普通主组进行中可设：{ok,progress:{goal:5,done:0,reached:false}}", () => {
    assert.notEqual(T.cur, null);
    const r = T.setStopTarget();
    assert.equal(r.ok, true);
    assert.equal(r.progress.goal, 5);
    assert.equal(r.progress.done, 0);
    assert.equal(r.progress.reached, false);
    assert.equal(eq(T.getStopTarget().words, []), true, "words 应为空：" + JSON.stringify(T.getStopTarget().words));
  });
  check("重复设定保持同一目标（不重置已计数）", () => {
    T.judge(true); T.tryNext();
    const r = T.setStopTarget();
    assert.equal(r.ok, true);
    assert.equal(r.already, true);
    assert.equal(T.getStopTarget().done, 1);
  });

  const sceneComplete = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(sceneComplete.T);
  check("完成页（无当前卡）拒绝设定：error=\"no-card\"", () => {
    assert.equal(sceneComplete.T.cur, null);
    const r = sceneComplete.T.setStopTarget();
    assert.equal(r.ok, false);
    assert.equal(r.error, "no-card");
    assert.equal(sceneComplete.T.getStopTarget(), null);
  });

  const sceneDrill = newScene({ groupSize: 10 });
  {
    const S = sceneDrill.S;
    let marked = 0;
    for (let i = 0; i < sceneDrill.T.getW().length && marked < 2; i++) {
      if (!sceneDrill.T.inScope(i) || sceneDrill.T.Q.includes(i)) continue;
      S.progress[i] = [1, now + 86400000, 1, 2, now];
      marked++;
    }
    saveNow(sceneDrill.T);
    sceneDrill.T.startDrill();
  }
  check("错词特训中拒绝设定：error=\"context\"", () => {
    assert.equal(sceneDrill.T.drillMode, true);
    assert.equal(sceneDrill.T.setStopTarget().error, "context");
  });

  const sceneExtra = newScene({ cap: 1, groupSize: 10 });
  {
    const S = sceneExtra.S;
    markDue(sceneExtra.T, S, 4);
    S.reviewDay = { d: todayStr(), used: 1 };
    saveNow(sceneExtra.T);
    sceneExtra.T.startSession("main");
    sceneExtra.T.startExtraSubgroup();
  }
  check("受控加量子组中拒绝设定：error=\"context\"", () => {
    assert.equal(sceneExtra.T.isExtraSubgroup(), true);
    assert.equal(sceneExtra.T.setStopTarget().error, "context");
  });

  const sceneReview = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(sceneReview.T);
  markDue(sceneReview.T, sceneReview.S, 8);
  saveNow(sceneReview.T);
  sceneReview.T.startReviewOnly();
  check("纯复习小组中拒绝设定：error=\"context\"", () => {
    assert.equal(sceneReview.T.getPlan().kind, "reviewOnly");
    assert.equal(sceneReview.T.setStopTarget().error, "context");
    assert.equal(sceneReview.T.getStopTarget(), null);
  });

  const sceneRest = newScene({ groupSize: 10 });
  sceneRest.T.saveAndRest();
  check("休息态下拒绝设定：error=\"resting\"", () => {
    assert.equal(sceneRest.T.isResting(), true);
    assert.equal(sceneRest.T.setStopTarget().error, "resting");
  });
}

/* ===========================================================================
 * 2. 计数：只累计设定后首次有效作答的不同单词
 * =========================================================================== */
section("2. 计数口径：不同词首次作答才累计，改判/重考不重复，撤销回退");
{
  const s1 = newScene({ dailyNew: 6, groupSize: 6 });
  s1.T.setStopTarget();
  const judged = [];
  for (let k = 0; k < 3; k++) { judged.push(currentWord(s1.b)); s1.T.judge(true); s1.T.tryNext(); }
  check("设定后判定 3 个不同词：done=3、words 为 3 个不同词、未达标", () => {
    const progress = s1.T.getStopTarget();
    assert.equal(progress.done, 3);
    assert.equal(progress.reached, false);
    assert.equal(progress.words.length, 3);
    assert.equal(new Set(progress.words).size, 3);
    assert.equal(eq(progress.words, judged), true, JSON.stringify(progress.words) + " vs " + JSON.stringify(judged));
  });

  const s2 = newScene({ dailyNew: 6, groupSize: 6 });
  s2.T.setStopTarget();
  s2.T.judge(true);
  s2.T.judge(false);
  s2.T.judge(true);
  check("同一词改判（会→不会→会）不重复计数", () => {
    assert.equal(s2.T.answerChanges, 2);
    assert.equal(s2.T.getStopTarget().done, 1);
    assert.equal(s2.T.getStopTarget().words.length, 1);
  });
  check("撤销改判不回退该词计数", () => {
    s2.T.undo();
    assert.equal(s2.T.getStopTarget().done, 1);
    assert.equal(s2.T.getStopTarget().words.length, 1);
  });

  const s3 = newScene({ dailyNew: 6, groupSize: 6 });
  s3.T.setStopTarget();
  s3.T.judge(true);
  check("撤销首次判定回退该词计数与 answered", () => {
    assert.equal(s3.T.getStopTarget().done, 1);
    s3.T.undo();
    assert.equal(s3.T.getStopTarget().done, 0);
    assert.equal(eq(s3.T.getStopTarget().words, []), true);
    assert.equal(s3.T.answered, 0);
    assert.equal(s3.T.phase, "recall");
    assert.equal(s3.T.verdict, null);
  });

  const s4 = newScene({ dailyNew: 3, groupSize: 3 });
  s4.T.setStopTarget();
  const wrongWord = currentWord(s4.b);
  s4.T.judge(false); s4.T.tryNext();
  s4.T.judge(true); s4.T.tryNext();
  s4.T.judge(true); s4.T.tryNext();
  check("「不会→本组重考再判」不重复计数，不同词仍各计 1", () => {
    assert.equal(currentWord(s4.b), wrongWord, "重考词回到队尾再次出现");
    assert.equal(s4.T.pendingReinforce(), 1);
    const before = s4.T.getStopTarget().done;
    s4.T.judge(true);
    const progress = s4.T.getStopTarget();
    assert.equal(progress.done, 3, "A(不会→重考会)+B+C 共 3 个不同词");
    assert.equal(progress.done, before, "重考再判不增加计数");
    assert.equal(progress.words.filter(w => w === wrongWord).length, 1);
    assert.equal(progress.words.length, 3);
  });

  const freeze = newScene({ dailyNew: 10, groupSize: 10 });
  freeze.T.setStopTarget();
  const judgedWords = [];
  for (let k = 0; k < 7; k++) {
    judgedWords.push(currentWord(freeze.b));
    freeze.T.judge(true);
    freeze.T.tryNext();
  }
  check("达标后继续判定更多不同词：计数冻结在 5、words 最长 5、reached 保持", () => {
    const progress = freeze.T.getStopTarget();
    assert.equal(judgedWords.length, 7);
    assert.equal(progress.done, 5);
    assert.equal(progress.words.length, 5);
    assert.equal(progress.reached, true);
    assert.equal(eq(progress.words, judgedWords.slice(0, 5)), true,
      JSON.stringify(progress.words) + " vs " + JSON.stringify(judgedWords.slice(0, 5)));
  });
  check("撤销已计数判定：done 回退为 4 且 reached 复位", () => {
    let guard = 0;
    while (freeze.T.getStopTarget().done >= 5 && guard++ < 20) freeze.T.undo();
    const progress = freeze.T.getStopTarget();
    assert.equal(progress.done, 4);
    assert.equal(progress.reached, false);
    assert.equal(progress.words.length, 4);
  });

  const s5 = newScene({ dailyNew: 6, groupSize: 6 });
  const preWord = currentWord(s5.b);
  s5.T.judge(true);
  s5.T.setStopTarget();
  check("设定目标前的判定不计入", () => {
    assert.equal(s5.T.getStopTarget().done, 0);
    s5.T.judge(false);   // 改判设定前的同一词
    assert.equal(s5.T.getStopTarget().done, 0);
    s5.T.tryNext();
    s5.T.judge(true);
    assert.equal(s5.T.getStopTarget().done, 1, "设定后下一个不同词首次判定才计");
    assert.notEqual(currentWord(s5.b), preWord);
  });
}

/* ===========================================================================
 * 3. 停靠目标 UI 与「不写设置/备份/进度」
 * =========================================================================== */
section("3. 停靠目标 UI、达标提示与只读性");
{
  const { b, T, S } = newScene({ groupSize: 6 });
  const settingsBefore = JSON.stringify(clone(S.settings));
  const backupBefore = JSON.stringify(T.buildExport());
  const mainBefore = b.storage.get(MAIN_KEY);
  T.setStopTarget();
  check("设定后 #stopTarget 可见并显示进度 N/5，提供 #stopTargetCancel", () => {
    assert.equal(b.query("#stopTarget").hidden, false);
    assert.match(b.text("#stopTargetText"), /停靠目标/);
    assert.match(b.text("#stopTargetText"), /0\s*\/\s*5/);
    assert.equal(b.query("#stopTargetCancel").hidden, false);
    assert.equal(b.query("#btnStopTarget").hidden, true);
  });
  check("停靠目标不写 settings、备份、进度或主记录", () => {
    assert.equal(JSON.stringify(clone(T.getS().settings)), settingsBefore, "settings 深比较不变");
    assert.equal(JSON.stringify(T.buildExport()), backupBefore, "备份导出不变");
    assert.doesNotMatch(JSON.stringify(T.buildExport()), /stopTarget/);
    assert.equal(b.storage.get(MAIN_KEY), mainBefore, "主记录不变");
  });

  const reachedScene = newScene({ groupSize: 6 });
  reachedScene.T.setStopTarget();
  for (let k = 0; k < 5; k++) { reachedScene.T.judge(k !== 2); reachedScene.T.tryNext(); }
  check("达标后显示 #stopTargetRest/#stopTargetContinue，文案说明剩余与待巩固已保留", () => {
    const t = reachedScene.T;
    assert.equal(t.getStopTarget().reached, true);
    assert.equal(reachedScene.b.query("#stopTargetRest").hidden, false);
    assert.match(reachedScene.b.text("#stopTargetRest"), /先休息，保存现场/);
    assert.equal(reachedScene.b.query("#stopTargetContinue").hidden, false);
    assert.match(reachedScene.b.text("#stopTargetContinue"), /继续本组/);
    assert.equal(reachedScene.b.query("#stopTargetCancel").hidden, true);
    assert.match(reachedScene.b.text("#stopTargetText"), /待巩固\s*1\s*次/);
    assert.match(reachedScene.b.text("#stopTargetText"), /都已保留/);
  });

  const cancelScene = newScene({ groupSize: 6 });
  cancelScene.T.setStopTarget();
  cancelScene.b.click("#stopTargetCancel");
  check("点 #stopTargetCancel 清空目标并隐藏面板", () => {
    assert.equal(cancelScene.T.getStopTarget(), null);
    assert.equal(cancelScene.b.query("#stopTarget").hidden, true);
    assert.match(cancelScene.b.text("#toast") || "", /已取消停靠目标/);
  });
}

/* ===========================================================================
 * 4. 完成页达标：按住自动续背；继续=显式继续；先休息=今日暂停
 * =========================================================================== */
section("4. 完成页达标：自动续背被按住，继续/先休息语义");
{
  const s = newScene({ dailyNew: 20, groupSize: 5 });
  s.T.setStopTarget();
  completeGroup(s.T);
  const progressBefore = JSON.stringify(s.S.progress);
  const daysBefore = JSON.stringify(s.S.days);
  check("达标完成页：目标保持 reached，按钮为「先休息，保存现场 / 继续学习」", () => {
    assert.equal(s.T.cur, null);
    assert.equal(s.T.getStopTarget().reached, true);
    assert.match(s.b.text("#stopTargetRest"), /今天先到这里/);
    assert.match(s.b.text("#stopTargetContinue"), /继续学习/);
  });
  check("达标完成页不满足自动续背资格，状态区说明停靠目标", () => {
    const st = s.T.getAutoResumeState();
    assert.equal(st.eligible, false);
    assert.equal(s.b.query("#autoResume").hidden, false, "状态区仍可见以说明原因");
    assert.match(s.b.text("#autoResumeText"), /停靠目标/);
  });
  check("startAutoResumeNow() 返回 false 且不判定、不写存储", () => {
    const pressed = s.T.startAutoResumeNow();
    assert.equal(pressed, false);
    assert.equal(JSON.stringify(s.S.progress), progressBefore);
    assert.equal(JSON.stringify(s.S.days), daysBefore);
    assert.equal(s.b.storage.has(s.T.autoResumeLeaseKey), false);
    assert.equal(s.T.getStopTarget().reached, true);
  });

  s.b.click("#stopTargetContinue");
  check("点「继续学习」：清空目标 → 显式继续开普通主组（不是自动续背）", () => {
    assert.equal(s.T.getStopTarget(), null);
    assert.equal(s.b.query("#stopTarget").hidden, true);
    assert.notEqual(s.T.cur, null);
    assert.equal(s.T.getPlan().kind, "main");
    assert.ok(s.T.Q.length > 0);
    assert.equal(s.b.storage.has(s.T.autoResumeLeaseKey), false, "显式继续不抢自动续背租约");
    assert.equal(s.T.getAutoResumePause().pausedToday, false, "显式继续不写今日暂停");
  });

  const insufficient = newScene({ dailyNew: 5, groupSize: 5 });
  insufficient.T.setStopTarget();
  completeGroup(insufficient.T);
  const mainRawBefore = insufficient.b.storage.get(MAIN_KEY);
  insufficient.b.click("#stopTargetContinue");
  check("候选不足时点继续：清空目标、停在完成页、自动续背资格恢复且不自动开组", () => {
    const t = insufficient.T;
    assert.equal(t.getStopTarget(), null);
    assert.equal(t.cur, null);
    assert.equal(t.getAutoResumeState().eligible, true);
    assert.equal(insufficient.b.storage.has(t.autoResumeLeaseKey), false);
    assert.equal(insufficient.b.storage.get(MAIN_KEY), mainRawBefore, "没有自动开组/不写主记录");
    assert.match(insufficient.b.text("#toast") || "", /停靠目标已结束/);
  });

  const restScene = newScene({ dailyNew: 20, groupSize: 5 });
  restScene.T.setStopTarget();
  completeGroup(restScene.T);
  const arBefore = JSON.stringify(restScene.T.getS().settings.autoResume);
  restScene.b.click("#stopTargetRest");
  check("完成页点「今天先到这里」：清空目标并写既有今日暂停键", () => {
    const t = restScene.T;
    assert.equal(t.getStopTarget(), null);
    assert.equal(t.getAutoResumePause().pausedToday, true);
    assert.equal(JSON.stringify(t.getS().settings.autoResume), arBefore, "不修改长期 autoResume 设置");
    assert.equal(t.getAutoResumeState().eligible, false, "已明确先休息，本页不再自动续背");
    assert.match(restScene.b.text("#autoResumeText"), /先休息/);
  });
}

/* ===========================================================================
 * 5. 纯复习候选口径
 * =========================================================================== */
section("5. getReviewOnlyCandidates：当前范围/非熟练/有主进度/未掌握/到期/预算");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  const T = s.T, S = s.S, W = T.getW();
  // 两个到期可复习词（ky=1，便于用 kyOnly 制造范围外样本）
  const dueOK = [];
  for (let i = 0; i < W.length && dueOK.length < 2; i++) {
    if (W[i].ky !== 1 || !T.inScope(i) || S.progress[i]) continue;
    dueOK.push(i);
  }
  for (const i of dueOK) S.progress[i] = [1, now - 5000, 1, 0, now - 86400000];
  const excluded = [];
  for (let i = 0; i < W.length && excluded.length < 4; i++) {
    if (!T.inScope(i) || S.progress[i] || dueOK.includes(i)) continue;
    excluded.push(i);
  }
  const [profI, futureI, noMainI, masterI] = excluded;
  S.progress[profI] = [1, now - 5000, 1, 0, now - 86400000];  // 熟练 → 排除
  T.setProficient(profI, true);
  S.progress[futureI] = [1, now + 86400000, 1, 0, now - 86400000];  // 未到期 → 排除
  S.progress[noMainI] = [0, now - 5000, 0, 2, 0];                    // 无主学习进度 → 排除
  S.progress[masterI] = [MASTER, now - 5000, 5, 0, now - 86400000];  // 已掌握 → 排除
  let outOfScope = -1;
  for (let i = 0; i < W.length; i++) {
    if (W[i].ky !== 0 || !T.inScope(i) || S.progress[i]) continue;
    outOfScope = i; break;
  }
  S.progress[outOfScope] = [1, now - 5000, 1, 0, now - 86400000];     // 当前范围外 → 排除
  S.settings.kyOnly = true;
  saveNow(T);
  const stats = T.getReviewOnlyCandidates();
  check("只统计当前范围内到期、非熟练、有主进度、未掌握(p[1]<=now)的词", () => {
    assert.equal(T.inScope(outOfScope), false, "范围外样本当前不在范围");
    assert.equal(T.isProficient(profI), true);
    assert.equal(stats.due, 2, "只有 2 个符合条件的到期词：" + JSON.stringify(stats));
    assert.equal(stats.count, 2);
    assert.equal(stats.reason, "");
    assert.equal(stats.cap, 0);
    assert.equal(stats.budget, null);
  });

  const s2 = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s2.T);
  markDue(s2.T, s2.S, 8);
  saveNow(s2.T);
  check("cap=0（不限）时最多取 5 张：due=8 → count=5", () => {
    const st = s2.T.getReviewOnlyCandidates();
    assert.equal(st.due, 8);
    assert.equal(st.count, 5);
    assert.equal(st.count, 5);
    assert.equal(st.cap, 0);
    assert.equal(st.budget, null);
  });
}

/* ===========================================================================
 * 6. 今日剩余复习预算截断
 * =========================================================================== */
section("6. 预算边界：cap=已用+2 只开 2 张；预算已满返回 review-cap");
{
  const s = newScene({ dailyNew: 3, groupSize: 3, cap: 3, used: 1 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  check("cap=已用+2：候选被截断为 2、count<=reviewCapLeft", () => {
    const T = s.T;
    const st = T.getReviewOnlyCandidates();
    assert.equal(st.due, 8);
    assert.equal(st.budget, 2);
    assert.equal(st.count, 2);
    assert.ok(st.count <= T.reviewCapLeft());
    assert.equal(T.reviewCapLeft(), 2);
  });
  check("开组只取 min(5,due,预算)=2 张，且都是到期复习卡", () => {
    const T = s.T;
    const dayN = s.S.days[todayStr()].n;
    const start = T.startReviewOnly();
    assert.equal(start.ok, true);
    assert.equal(T.getPlan().kind, "reviewOnly");
    assert.equal(T.Q.length, 2);
    for (const i of T.Q) {
      assert.equal(T.isProficient(i), false);
      assert.equal(T.hasMainProgress(s.S.progress[i]), true);
      assert.ok(s.S.progress[i][1] <= Date.now());
      assert.ok(s.S.progress[i][0] < MASTER);
    }
    assert.equal(s.S.days[todayStr()].n, dayN, "不学新词、不占新词额度");
    assert.equal(s.S.settings.dailyNew, 3);
  });

  const full = newScene({ dailyNew: 3, groupSize: 3, cap: 1, used: 1 });
  completeGroup(full.T);
  markDue(full.T, full.S, 4);
  saveNow(full.T);
  const buttonBefore = full.T.getReviewOnlyCandidates();
  check("预算已满：count=0、reason=\"review-cap\"、按钮不出现", () => {
    const st = full.T.getReviewOnlyCandidates();
    assert.equal(st.due, 4);
    assert.equal(st.budget, 0);
    assert.equal(st.count, 0);
    assert.equal(st.reason, "review-cap");
    assert.equal(full.b.query("#startReviewOnly"), null);
    assert.equal(buttonBefore.count, 0);
  });
  check("预算已满时 startReviewOnly() 返回 ok=false 且不开组", () => {
    const T = full.T;
    const planBefore = T.getPlan() ? T.getPlan().kind : null;
    const r = T.startReviewOnly();
    assert.equal(r.ok, false);
    assert.equal(r.error, "review-cap");
    assert.equal(T.cur, null);
    assert.equal(T.getPlan() ? T.getPlan().kind : null, planBefore);
  });
}

/* ===========================================================================
 * 7. startReviewOnly 契约与入口
 * =========================================================================== */
section("7. startReviewOnly：纯复习类型、不学新词、不改新词计划");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  check("完成页有到期候选时出现 #startReviewOnly，reviewOnlyEntryAvailable=true", () => {
    assert.equal(s.T.reviewOnlyEntryAvailable(), true);
    assert.ok(s.b.query("#startReviewOnly"), "应有纯复习入口");
    assert.match(s.b.text("#startReviewOnly"), /纯复习/);
  });
  const dayNBefore = s.S.days[todayStr()].n;
  s.b.click("#startReviewOnly");
  check("点入口后 kind=\"reviewOnly\"、groupSize=5、Q.length=min(5,due,budget)", () => {
    const T = s.T;
    assert.equal(T.getPlan().kind, "reviewOnly");
    assert.equal(T.getPlan().groupSize, 5);
    assert.equal(T.Q.length, Math.min(5, 8, Infinity));
    assert.equal(T.Q.length, 5);
  });
  check("每个 Q 元素都满足到期/非熟练/有主学习进度/未掌握/当前范围，全部不是未学新词", () => {
    const T = s.T, S = s.S;
    for (const i of T.Q) {
      assert.equal(T.inScope(i), true);
      assert.equal(T.isProficient(i), false);
      assert.equal(T.hasMainProgress(S.progress[i]), true);
      assert.ok(S.progress[i][0] < MASTER);
      assert.ok(S.progress[i][1] <= Date.now());
    }
  });
  check("纯复习不学新词、不占新词额度、不改 dailyNew", () => {
    assert.equal(s.S.days[todayStr()].n, dayNBefore);
    assert.equal(s.S.settings.dailyNew, 3);
    assert.equal(s.S.days[todayStr()].n, 3, "今日新词仍为 3");
  });

  check("已有进行中的卡时拒绝开始纯复习（group-active）", () => {
    const another = newScene({ groupSize: 5 });
    assert.notEqual(another.T.cur, null);
    const r = another.T.startReviewOnly();
    assert.equal(r.ok, false);
    assert.equal(r.error, "group-active");
  });

  const noDue = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(noDue.T);
  noDue.T.setReviewCap(0);
  check("无到期词：reason=\"no-candidates\"、按钮不出现、start 返回 false", () => {
    const st = noDue.T.getReviewOnlyCandidates();
    assert.equal(st.due, 0);
    assert.equal(st.count, 0);
    assert.equal(st.reason, "no-candidates");
    assert.equal(noDue.b.query("#startReviewOnly"), null);
    const r = noDue.T.startReviewOnly();
    assert.equal(r.ok, false);
    assert.equal(r.error, "no-candidates");
    assert.equal(noDue.T.cur, null);
  });
}

/* ===========================================================================
 * 8. 纯复习快照：有效、刷新恢复纯复习类型
 * =========================================================================== */
section("8. 纯复习快照：valid、plan.kind/groupSize、刷新恢复同一卡与纯复习类型");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  s.T.startReviewOnly();
  check("0 判定开组即写入有效纯复习快照", () => {
    const st = s.T.getSessionSnapshotState();
    assert.equal(st.valid, true);
    assert.equal(st.data.plan.kind, "reviewOnly");
    assert.equal(st.data.plan.groupSize, 5);
    assert.equal(st.data.queue.length, 5);
  });
  const curWord = currentWord(s.b);
  s.T.judge(true);
  s.T.tryNext();
  const judgedWord = currentWord(s.b);
  check("判定一张后快照仍 valid，plan.kind===\"reviewOnly\"、groupSize===5", () => {
    const st = s.T.getSessionSnapshotState();
    assert.equal(st.valid, true, "快照应有效：" + st.reason);
    assert.equal(st.data.plan.kind, "reviewOnly");
    assert.equal(st.data.plan.groupSize, 5);
    assert.equal(st.data.cur, judgedWord);
    assert.equal(s.T.hasPendingScopeSettings(), false, "纯复习组不误报「设置待应用」");
  });
  check("刷新恢复同一张卡且仍是 reviewOnly（纯复习类型不丢失）", () => {
    const r = s.T.simulateReload();
    assert.equal(r.mode, "restored");
    assert.notEqual(s.T.cur, null);
    assert.equal(currentWord(s.b), judgedWord);
    assert.equal(s.T.getPlan().kind, "reviewOnly");
    assert.equal(s.T.getPlan().groupSize, 5);
    assert.equal(s.T.isResting(), false);
    assert.equal(s.T.hasPendingScopeSettings(), false);
  });
}

/* ===========================================================================
 * 9. 快照负向校验：非法 kind / groupSize=30 不得恢复且不卸载主记录
 * =========================================================================== */
section("9. 纯复习快照负向校验：非法 kind / groupSize 被拒绝且不丢主记录");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  s.T.startReviewOnly();
  s.T.judge(true);
  const snapKey = s.T.getSessionSnapshotKey();
  const progressKeysBefore = Object.keys(s.S.progress).length;
  const data = JSON.parse(s.b.storage.get(snapKey));
  const reviewWords = data.queue.slice();
  data.plan.kind = "weird";
  s.b.storage.set(snapKey, JSON.stringify(data));
  check("手工把快照 plan.kind 改成非法值：valid=false 且 reason=bad-plan", () => {
    const st = s.T.getSessionSnapshotState();
    assert.equal(st.valid, false);
    assert.equal(st.reason, "bad-plan");
  });
  check("非法 kind 刷新：不恢复该现场（mode=started、普通主组新卡）", () => {
    const r = s.T.simulateReload();
    assert.equal(r.mode, "started");
    assert.equal(s.T.getPlan().kind, "main");
    assert.notEqual(s.T.cur, null);
  });
  check("非法 kind 刷新不卸载主记录（纯复习词的进度仍在）", () => {
    const saved = JSON.parse(s.b.storage.get(MAIN_KEY));
    assert.ok(saved.progress, "主记录仍有 progress");
    for (const w of reviewWords) {
      const i = s.T.getW().findIndex(x => x.w === w);
      assert.ok(Object.prototype.hasOwnProperty.call(saved.progress, String(i)), w + " 的进度未被卸载");
    }
    assert.ok(Object.keys(saved.progress).length >= progressKeysBefore);
  });

  const s2 = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s2.T);
  markDue(s2.T, s2.S, 8);
  saveNow(s2.T);
  s2.T.startReviewOnly();
  s2.T.judge(true);
  const data2 = JSON.parse(s2.b.storage.get(s2.T.getSessionSnapshotKey()));
  data2.plan.groupSize = 30;
  s2.b.storage.set(s2.T.getSessionSnapshotKey(), JSON.stringify(data2));
  check("手工把 reviewOnly 快照 groupSize 改成 30：valid=false 且刷新不恢复", () => {
    const st = s2.T.getSessionSnapshotState();
    assert.equal(st.valid, false);
    assert.equal(st.reason, "bad-plan");
    const r = s2.T.simulateReload();
    assert.equal(r.mode, "started");
    assert.equal(s2.T.getPlan().kind, "main");
    assert.equal(s2.T.hasPendingScopeSettings(), false);
  });
}

/* ===========================================================================
 * 10. 纯复习完成页：文案、按钮、无自动续背、显式开始普通学习
 * =========================================================================== */
section("10. 纯复习完成页：纯复习完成 / 开始普通学习 / 无自动续背");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  s.T.startReviewOnly();
  const dayNBefore = s.S.days[todayStr()].n;
  completeGroup(s.T);
  check("复习完本组后 #card 文案含「纯复习完成」且不冒充普通完成", () => {
    assert.equal(s.T.cur, null);
    assert.match(s.b.text("#card"), /纯复习完成/);
    assert.doesNotMatch(s.b.text("#card"), /本组完成/);
  });
  check("#again 文案为「开始普通学习」（不是「继续下一组」）", () => {
    assert.ok(s.b.query("#again"), "应有 #again");
    assert.match(s.b.text("#again"), /开始普通学习/);
    assert.doesNotMatch(s.b.text("#again"), /继续下一组/);
  });
  check("纯复习完成页隐藏自动续背面板，startAutoResumeNow() 返回 false", () => {
    assert.equal(s.b.query("#autoResume").hidden, true);
    const progressBefore = JSON.stringify(s.S.progress);
    assert.equal(s.T.startAutoResumeNow(), false);
    assert.equal(JSON.stringify(s.S.progress), progressBefore, "不判定");
    assert.equal(s.b.storage.has(s.T.autoResumeLeaseKey), false);
  });
  check("仍有到期候选时 #startReviewOnly 文案含「再复习」", () => {
    const btn = s.b.query("#startReviewOnly");
    assert.ok(btn, "应有再次复习入口");
    assert.match(btn.textContent, /再复习/);
    assert.match(btn.textContent, /\d+/);
  });
  check("纯复习不改新词计划与熟练名单", () => {
    assert.equal(s.S.days[todayStr()].n, dayNBefore);
    assert.equal(s.S.settings.dailyNew, 3);
    assert.equal(eq(s.S.proficient, {}), true, JSON.stringify(s.S.proficient));
  });
  s.b.click("#again");
  check("点「开始普通学习」才显式进入普通主组（reviewOnly 不冒充完成页继续语义）", () => {
    assert.notEqual(s.T.cur, null);
    assert.equal(s.T.getPlan().kind, "main");
    assert.equal(s.T.getStopTarget(), null);
  });
}

/* ===========================================================================
 * 11. 纯复习不打乱主学习边界
 * =========================================================================== */
section("11. 纯复习不打乱主学习边界：不学新词、不清熟练、不动主组队列以外记录");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  const S = s.S, T = s.T;
  // 一个熟练词（不应被纯复习清除）
  let profI = -1;
  for (let i = 0; i < T.getW().length; i++) {
    if (!T.inScope(i) || S.progress[i] || S.proficient[T.getW()[i].w]) continue;
    profI = i; break;
  }
  T.setProficient(profI, true);
  const profSnapshot = JSON.stringify(S.proficient);
  const dayNBefore = S.days[todayStr()].n;
  const extraBefore = JSON.stringify(S.extraDay);
  const ledgerBefore = T.getReviewLedger().used;
  T.startReviewOnly();
  // 主组队列以外、也不在本轮纯复习 Q 里的到期词（剩余候选）
  const outside = [];
  for (let i = 0; i < T.getW().length && outside.length < 1; i++) {
    if (T.Q.includes(i) || !S.progress[i]) continue;
    if (!T.inScope(i)) continue;
    outside.push(i);
  }
  const outsideBefore = JSON.stringify(S.progress[outside[0]]);
  completeGroup(T);
  check("纯复习不学新词、不占新词额度、不改 dailyNew/extraDay", () => {
    assert.equal(S.days[todayStr()].n, dayNBefore);
    assert.equal(S.settings.dailyNew, 3);
    assert.equal(JSON.stringify(S.extraDay), extraBefore);
  });
  check("纯复习不清熟练名单", () => {
    assert.equal(JSON.stringify(S.proficient), profSnapshot);
    assert.equal(T.isProficient(profI), true);
  });
  check("主组队列以外的到期词进度不被纯复习改动", () => {
    assert.ok(outside.length === 1);
    assert.equal(JSON.stringify(S.progress[outside[0]]), outsideBefore);
  });
  check("纯复习判定计入今日复习台账（各 5 张），但不产生新词额度", () => {
    assert.equal(T.getReviewLedger().used, ledgerBefore + 5);
    assert.equal(S.days[todayStr()].n, dayNBefore);
  });
}

/* ===========================================================================
 * 12. 复核 P2-3：reviewOnly 的 baseGroupSize 待应用口径与快照校验
 * =========================================================================== */
section("12. 复核 P2-3：reviewOnly 冻结 baseGroupSize 的待应用口径与快照");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  s.T.startReviewOnly();
  check("groupSize=3 开始纯复习：不误报待应用，快照冻结 baseGroupSize=3", () => {
    assert.equal(s.T.getPlan().kind, "reviewOnly");
    assert.equal(s.T.hasPendingScopeSettings(), false);
    const st = s.T.getSessionSnapshotState();
    assert.equal(st.valid, true);
    assert.equal(st.data.plan.kind, "reviewOnly");
    assert.equal(st.data.plan.groupSize, 5);
    assert.equal(st.data.plan.baseGroupSize, 3);
  });
  check("工作台 getPendingDiff 无 groupSize 行", () => {
    const ws = s.b.window.__vocabWorkspace;
    assert.ok(ws, "应有 window.__vocabWorkspace");
    assert.equal(typeof ws.getPendingDiff, "function");
    const rows = ws.getPendingDiff();
    assert.equal(rows.some(row => row.key === "groupSize"), false, JSON.stringify(rows));
  });
  check("组内把 settings.groupSize 改成 30：待应用且 diff 含 groupSize(3→30)", () => {
    const S = s.T.getS();
    S.settings.groupSize = 30;
    saveNow(s.T);
    assert.equal(s.T.hasPendingScopeSettings(), true);
    const rows = s.b.window.__vocabWorkspace.getPendingDiff();
    const row = rows.find(r => r.key === "groupSize");
    assert.ok(row, "diff 应含 groupSize 行：" + JSON.stringify(rows));
    assert.equal(row.before, 3);
    assert.equal(row.after, 30);
  });

  const s2 = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s2.T);
  markDue(s2.T, s2.S, 8);
  saveNow(s2.T);
  s2.T.startReviewOnly();
  const snapKey = s2.T.getSessionSnapshotKey();
  const data = JSON.parse(s2.b.storage.get(snapKey));
  delete data.plan.baseGroupSize;
  s2.b.storage.set(snapKey, JSON.stringify(data));
  check("删除 baseGroupSize 的 reviewOnly 快照：valid=false(bad-plan) 且安全开新组", () => {
    const st = s2.T.getSessionSnapshotState();
    assert.equal(st.valid, false);
    assert.equal(st.reason, "bad-plan");
    const r = s2.T.simulateReload();
    assert.equal(r.mode, "started");
    assert.equal(s2.T.getPlan().kind, "main");
  });
}

/* ===========================================================================
 * 13. 复核 P2-4：reviewOnly 完成页 #again 可用性与额度暂停收尾文案
 * =========================================================================== */
section("13. 复核 P2-4：reviewOnly 完成页 #again 可用性与 capDone 文案");
{
  const noCand = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(noCand.T);
  markDue(noCand.T, noCand.S, 5);
  saveNow(noCand.T);
  noCand.T.startReviewOnly();
  completeGroup(noCand.T);
  check("纯复习完成且无可行候选：#again.disabled===true", () => {
    assert.equal(noCand.T.cur, null);
    assert.equal(noCand.T.getPlan().kind, "reviewOnly");
    assert.equal(noCand.T.readOnlyCandidateStats().available, 0);
    assert.ok(noCand.b.query("#again"), "应有 #again");
    assert.equal(noCand.b.query("#again").disabled, true);
  });

  const withCand = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(withCand.T);
  markDue(withCand.T, withCand.S, 8);
  saveNow(withCand.T);
  withCand.T.startReviewOnly();
  completeGroup(withCand.T);
  check("纯复习完成仍有到期候选：#again 可用（disabled===false）", () => {
    assert.ok(withCand.T.readOnlyCandidateStats().available > 0);
    assert.equal(withCand.b.query("#again").disabled, false);
  });

  const capDone = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(capDone.T);
  markDue(capDone.T, capDone.S, 8);
  saveNow(capDone.T);
  capDone.T.startReviewOnly();
  check("额度暂停主动结束的纯复习完成页：#again 文案为「开始普通学习」", () => {
    const T = capDone.T, S = T.getS();
    T.setReviewCap(1);
    S.reviewDay = { d: todayStr(), used: 1 };
    saveNow(T);
    assert.equal(T.isCapPaused(), true);
    assert.equal(capDone.b.query("#capPause").hidden, false);
    capDone.b.click("#capPauseEnd");
    assert.equal(T.cur, null, "主动结束本组后停在完成页");
    assert.equal(T.getPlan().kind, "reviewOnly");
    assert.match(capDone.b.text("#again"), /开始普通学习/);
    assert.doesNotMatch(capDone.b.text("#again"), /重新开始本组/);
  });
  check("额度暂停收尾不冒充纯复习完成：标题/通用暂停说明不被纯复习文案覆盖", () => {
    assert.doesNotMatch(capDone.b.text("#card"), /纯复习完成/);
    assert.match(capDone.b.text("#card"), /本组已暂停/);
  });
}

/* ===========================================================================
 * 14. 复核 P2-6：显式重开保持纯复习类型
 * =========================================================================== */
section("14. 复核 P2-6：显式重开保持 reviewOnly，无候选时保持现场");
{
  const s = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(s.T);
  markDue(s.T, s.S, 8);
  saveNow(s.T);
  s.T.startReviewOnly();
  check("reviewOnly 进行中改 dailyNew 后显式重开仍是 reviewOnly", () => {
    const T = s.T, S = T.getS();
    S.settings.dailyNew = 7;
    saveNow(T);
    assert.equal(T.hasPendingScopeSettings(), true);
    const r = T.applySettingsRestart();
    assert.equal(r, true);
    assert.equal(T.getPlan().kind, "reviewOnly");
    assert.equal(T.getPlan().groupSize, 5);
    assert.notEqual(T.cur, null);
    assert.equal(T.getSessionSnapshotState().valid, true);
  });

  const noCand = newScene({ dailyNew: 3, groupSize: 3 });
  completeGroup(noCand.T);
  markDue(noCand.T, noCand.S, 8);
  saveNow(noCand.T);
  noCand.T.startReviewOnly();
  check("无候选时显式重开返回 false 且当前现场不变", () => {
    const T = noCand.T;
    T.setReviewCap(1);
    T.getS().reviewDay = { d: todayStr(), used: 1 };
    saveNow(T);
    assert.equal(T.getReviewOnlyCandidates().count, 0);
    const planBefore = JSON.stringify(T.getPlan());
    const qBefore = T.Q.slice();
    const curBefore = T.cur;
    const answeredBefore = T.answered;
    const r = T.applySettingsRestart();
    assert.equal(r, false);
    assert.equal(JSON.stringify(T.getPlan()), planBefore);
    assert.equal(JSON.stringify(T.Q), JSON.stringify(qBefore));
    assert.equal(T.cur, curBefore);
    assert.equal(T.answered, answeredBefore);
    assert.match(noCand.b.text("#toast") || "", /没有可重建的到期词/);
  });
}

/* ===========================================================================
 * 15. 复核顺带项：完成页「继续学习」走统一动作守卫
 * =========================================================================== */
section("15. 复核顺带项：完成页继续走 runStudyAction 守卫");
{
  const s = newScene({ dailyNew: 20, groupSize: 5 });
  s.T.setStopTarget();
  completeGroup(s.T);
  check("完成页停靠目标达标且 #stopTargetContinue 可见", () => {
    assert.equal(s.T.cur, null);
    assert.equal(s.T.getStopTarget().reached, true);
    assert.equal(s.b.query("#stopTargetContinue").hidden, false);
  });
  s.b.failKeys.add(MAIN_KEY);
  const fail = s.T.saveAndRest();
  check("#appAlert 可见时点 #stopTargetContinue 不开新组", () => {
    assert.equal(fail.ok, false);
    assert.equal(s.b.query("#appAlert").hidden, false);
    assert.equal(s.T.getStopTarget().reached, true, "保存失败不清停靠目标");
    s.b.click("#stopTargetContinue");
    assert.equal(s.T.cur, null, "持续错误期间不得开新组");
    assert.match(s.b.text("#toast") || "", /请先处理页面中的记录错误/);
  });
  s.b.failKeys.delete(MAIN_KEY);
  check("关闭持续错误后显式继续可开普通主组", () => {
    const close = s.b.all("#appAlertActions button").find(x => x.textContent === "关闭");
    assert.ok(close, "应有「关闭」按钮");
    close.click();
    assert.equal(s.b.query("#appAlert").hidden, true);
    // 真实页面由自动续背采样定时器每秒刷新完成页按钮可用性；这里直接执行最后注册的采样回调。
    s.b.intervals.at(-1).fn();
    assert.equal(s.b.query("#again").disabled, false, "错误关闭后 #again 应恢复可用");
    s.b.click("#again");
    assert.notEqual(s.T.cur, null);
    assert.equal(s.T.getPlan().kind, "main");
    assert.equal(s.T.getStopTarget(), null);
  });
}

/* 2026-10-28 独立复查：临时目标是主组现场的一部分，暂离专项不能偷偷取消。 */
section("16. 主组停靠目标随父现场保留");
{
  const s = newScene({groupSize: 10});
  s.T.setStopTarget(); s.T.judge(true); s.T.tryNext();
  let wrongIndex = s.T.getW().findIndex((w, i) => s.T.inScope(i) && !s.T.Q.includes(i));
  s.S.progress[wrongIndex] = [1, now + 86400000, 1, 1, now]; saveNow(s.T);
  const target = clone(s.T.getStopTarget()), cur = s.T.cur;
  s.T.startDrill(); completeGroup(s.T); s.T.exitDrill();
  check("做完错词特训返回后，原组停靠目标与已学不同词仍保留", () => {
    assert.equal(s.T.cur, cur); assert.deepEqual(clone(s.T.getStopTarget()), target);
  });
  check("返回后首次判定继续累计，特训作答不计入原组目标", () => {
    s.T.judge(true); assert.equal(s.T.getStopTarget()?.done, 2);
  });
}
{
  const s = newScene({cap: 1, groupSize: 10});
  markDue(s.T, s.S, 3); saveNow(s.T); s.T.startSession("main");
  s.T.setStopTarget(); s.T.judge(true); s.T.tryNext();
  const target = clone(s.T.getStopTarget()), cur = s.T.cur;
  assert.equal(s.T.startExtraSubgroup(), true);
  s.T.judge(true); s.T.endExtraSubgroup();
  check("额度暂停中暂背新词后返回，不清除父组停靠目标", () => {
    assert.equal(s.T.cur, cur); assert.deepEqual(clone(s.T.getStopTarget()), target);
  });
}

section("17. 纯复习快照不能凭类型标签把未学词变成复习候选");
{
  const s = newScene({groupSize: 5});
  const data = clone(s.T.getSessionSnapshotState().data);
  data.plan.kind = "reviewOnly"; data.plan.baseGroupSize = 5;
  check("合法普通新词快照改成reviewOnly时，未学词必须拒绝恢复", () => {
    s.b.storage.set(s.T.getSessionSnapshotKey(), JSON.stringify(data));
    const checked = s.T.getSessionSnapshotState();
    assert.equal(checked.valid, false); assert.equal(checked.reason, "review-word-unlearned");
  });
}

{
  const s = newScene({groupSize: 5, dailyNew: 1}); s.T.judge(true);
  const data = clone(s.T.getSessionSnapshotState().data);
  data.plan.kind = "reviewOnly"; data.plan.baseGroupSize = 5;
  check("新词已经首次判定也不能把其未学基线冒充纯复习快照", () => {
    assert.equal(data.curBaseline.prog, null);
    s.b.storage.set(s.T.getSessionSnapshotKey(), JSON.stringify(data));
    const checked = s.T.getSessionSnapshotState();
    assert.equal(checked.valid, false); assert.equal(checked.reason, "review-word-unlearned");
  });
}

/* ---------------- 汇总 ---------------- */
console.log("\n结果：" + passed + " 通过 / " + failed + " 失败");
process.exit(failed ? 1 : 0);
