/**
 * 03 快速双击不越过释义（回归）
 * 用 DOM 桩执行真实 js/app.js：解析 #acts 重绘后的真实按钮、按浏览器事件顺序
 * 派发 pointer/click（含 document 捕获阶段），只断言行为；几何位置由 qa-browser
 * 在真实浏览器验证。
 * 运行：node --max-old-space-size=512 js/test-doubleclick.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const appSource = () => fs.readFileSync(path.join(HERE, "app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appText = appSource();

// 守卫窗口常量直接从真实实现读取，避免把 sleep 写死在测试里。
const GUARD_MS = (() => {
  const m = appText.match(/const JUDGE_DBL_GUARD_MS\s*=\s*(\d+)/);
  assert.ok(m, "app.js 应声明 JUDGE_DBL_GUARD_MS 连击守卫窗口");
  return Number(m[1]);
})();
const GUARD_PX = (() => {
  const m = appText.match(/const JUDGE_DBL_GUARD_PX\s*=\s*(\d+)/);
  assert.ok(m, "app.js 应声明 JUDGE_DBL_GUARD_PX 连击坐标半径");
  return Number(m[1]);
})();
const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 迷你 DOM：支持 innerHTML 里 id 按钮的真实父子关系、事件捕获/冒泡与焦点。 */
function browser({ initial = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const T0 = now;
  const registry = new Map();       // 选择器 → 容器元素
  const byId = new Map();           // id → 当前挂载的按钮/元素
  const documentEvents = new Map(); // type → [{fn, capture}]
  const windowEvents = new Map();
  const intervals = [];
  const timers = [];
  const storage = new Map(initial === null ? [] : [[KEY, JSON.stringify(initial)]]);
  const focusLog = [];
  let document = null;

  function matches(el, selector) {
    if (!el || !selector) return false;
    for (const part of String(selector).split(",")) {
      const sel = part.trim();
      let m;
      if ((m = sel.match(/^#([\w-]+)$/))) { if (el.id === m[1]) return true; continue; }
      if ((m = sel.match(/^\.([\w-]+)$/))) { if (el.classList.contains(m[1])) return true; continue; }
      if ((m = sel.match(/^\[data-([\w-]+)\]$/))) { if (el.dataset && el.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined) return true; continue; }
      if ((m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/))) {
        const v = el.getAttribute(m[1]);
        if (m[2] === undefined ? v !== null : v === m[2]) return true;
        continue;
      }
      if (/^[a-z][a-z0-9-]*$/i.test(sel)) { if (el.tagName === sel.toUpperCase()) return true; }
    }
    return false;
  }
  function closest(el, selector) {
    let node = el;
    while (node) { if (matches(node, selector)) return node; node = node.parentNode; }
    return null;
  }
  function descendants(root, out = []) {
    for (const child of root.children || []) { out.push(child); descendants(child, out); }
    return out;
  }
  function queryWithin(root, selector) { return descendants(root).find(el => matches(el, selector)) || null; }
  function queryAllWithin(root, selector) { return descendants(root).filter(el => matches(el, selector)); }

  function element(tag = "div", id = "") {
    const events = new Map();
    const classes = new Set();
    const attrs = {};
    const el = {
      tagName: String(tag).toUpperCase(), id,
      style: {}, dataset: {}, value: "", checked: false, disabled: false,
      hidden: false, files: [], scrollTop: 0, clientHeight: 600, clientWidth: 320,
      textContent: "", onclick: null, onchange: null, oninput: null,
      offsetWidth: 120, offsetHeight: 40,
      children: [], parentNode: null, _childIds: [], _html: "",
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : force;
          if (on) classes.add(name); else classes.delete(name);
          return on;
        }
      },
      setAttribute(name, value) { attrs[name] = String(value); if (name === "id") el.id = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      removeAttribute(name) { delete attrs[name]; },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
      addEventListener(type, fn, options) {
        if (!events.has(type)) events.set(type, []);
        const capture = typeof options === "boolean" ? options : !!(options && options.capture);
        events.get(type).push({ fn, capture });
      },
      removeEventListener() {},
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      remove() { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(c => c !== el); el.parentNode = null; },
      focus() { focusLog.push(el); if (document) document.activeElement = el; },
      blur() { if (document && document.activeElement === el) document.activeElement = null; },
      contains(node) { let n = node; while (n) { if (n === el) return true; n = n.parentNode; } return false; },
      closest(selector) { return closest(el, selector); },
      querySelector(selector) { return queryWithin(el, selector); },
      querySelectorAll(selector) { return queryAllWithin(el, selector); },
      getBoundingClientRect() { return { left: 8, top: 8, right: 128, bottom: 48, width: 120, height: 40 }; },
      setPointerCapture() {}, releasePointerCapture() {}, scrollIntoView() {},
      dispatchEvent(ev) { return dispatchEvent(el, ev); }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html; },
      set(html) {
        // 重绘会移除旧按钮：先从全局 id 表注销仍指向旧子节点的 id。
        for (const old of el.children) {
          if (old.id && byId.get(old.id) === old) byId.delete(old.id);
          old.parentNode = null;
        }
        el.children = [];
        el._childIds = [];
        el._html = String(html == null ? "" : html);
        parseIds(el, el._html);
      }
    });
    return el;
  }
  /** 从 html 中为带 id 的标签建立真实父子节点（#acts 重绘后可 query #nx）。 */
  function parseIds(container, html) {
    const openTag = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
    for (const match of String(html).matchAll(openTag)) {
      const tag = match[1];
      const attrText = match[2] || "";
      const attrs = {};
      for (const a of attrText.matchAll(/([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/g)) {
        attrs[a[1]] = a[2] === undefined ? "" : a[2];
      }
      if (!attrs.id) continue;      // 只需要可被 $(\"#id\") 访问的节点
      const child = element(tag, attrs.id);
      if (attrs.class) child.setAttribute("class", attrs.class);
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("data-")) child.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        if (k === "class") String(v).split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
      }
      child.parentNode = container;
      container.children.push(child);
      container._childIds.push(child);
      byId.set(child.id, child);
    }
  }

  function dispatchEvent(target, event) {
    const ev = Object.assign({
      type: "", target, currentTarget: null, bubbles: true, cancelBubble: false,
      defaultPrevented: false, timeStamp: now - T0,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.cancelBubble = true; },
      stopImmediatePropagation() { this.cancelBubble = true; }
    }, event);
    ev.target = target;
    // 浏览器语义：document 捕获阶段先于 target/冒泡执行。
    for (const rec of documentEvents.get(ev.type) || []) {
      if (!rec.capture || ev.cancelBubble) continue;
      ev.currentTarget = document;
      rec.fn.call(document, ev);
    }
    let node = target;
    while (node && !ev.cancelBubble) {
      ev.currentTarget = node;
      for (const rec of node._events?.get?.(ev.type) || []) {
        if (ev.cancelBubble) break;
        rec.fn.call(node, ev);
      }
      if (!ev.cancelBubble && typeof node[`on${ev.type}`] === "function") node[`on${ev.type}`].call(node, ev);
      node = ev.cancelBubble ? null : node.parentNode;
    }
    if (!ev.cancelBubble) {
      for (const rec of documentEvents.get(ev.type) || []) {
        if (rec.capture) continue;
        ev.currentTarget = document;
        rec.fn.call(document, ev);
      }
    }
    return ev;
  }

  const tagById = new Map();
  for (const match of indexSource.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) tagById.set(match[2], match[1]);

  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (/^#[\w-]+$/.test(selector)) {
      const id = selector.slice(1);
      if (byId.has(id)) return byId.get(id);
      if (!registry.has(selector)) registry.set(selector, element(tagById.get(id) || "div", id));
      return registry.get(selector);
    }
    if (!registry.has(selector)) registry.set(selector, element("div", ""));
    return registry.get(selector);
  }
  const views = ["study", "list", "stats", "set"].map(v => query(`#v-${v}`));
  views[0].classList.add("on");
  const nav = ["study", "list", "stats", "set"].map(v => { const b = element("button"); b.dataset.v = v; return b; });
  const keyButtons = ["know", "dont", "next", "speak", "star", "proficient"].map(k => { const b = element("button"); b.dataset.k = k; return b; });
  const closeButton = element("button");
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#helpSheet [data-close]") return [closeButton];
    if (selector === "#helpSheet button") return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  query("#helpSheet").hidden = true;

  document = {
    querySelector: query, querySelectorAll: queryAll,
    documentElement: { dataset: {}, style: {} }, body: element("body"),
    visibilityState: "visible", activeElement: null,
    addEventListener(type, fn, options) {
      if (!documentEvents.has(type)) documentEvents.set(type, []);
      const capture = typeof options === "boolean" ? options : !!(options && options.capture);
      documentEvents.get(type).push({ fn, capture });
    },
    removeEventListener() {},
    createElement(tag) { return element(tag); }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const window = {
    document,
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    innerWidth: 424, innerHeight: 776
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class { readAsText(file) { this.result = file.text; this.onload?.({ target: this }); } },
    SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now - T0 }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供测试入口 window.__vocab");

  const fire = (target, type, init) => dispatchEvent(target, Object.assign({ type }, init));
  const clickOn = (target, init = {}) => fire(target, "click", { detail: 1, clientX: 100, clientY: 300, ...init });
  return {
    T, window, document, context, registry, byId, storage, intervals, timers, views, query, queryAll,
    get now() { return now; },
    advance(ms) { now += ms; },
    get guardMs() { return GUARD_MS; },
    get guardPx() { return GUARD_PX; },
    flushTimers() { const pending = timers.splice(0); pending.forEach(t => t.fn()); },
    key(data) {
      const e = {
        key: "", code: "", target: document.body, ctrlKey: false, metaKey: false,
        altKey: false, shiftKey: false, repeat: false, isComposing: false,
        preventDefault() {}, stopPropagation() {}, ...data
      };
      for (const rec of documentEvents.get("keydown") || []) rec.fn(e);
      return e;
    },
    clickOn, fire
  };
}

function startStudy(b) {
  const S = b.T.getS();
  Object.assign(S.settings, { fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], order: "freq", dailyNew: 10 });
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  b.T.startSession();
  return S;
}
function snapshot(b) {
  const S = b.T.getS(), i = b.T.cur;
  return {
    cur: i, qi: b.T.qi, phase: b.T.phase, verdict: b.T.verdict, answered: b.T.answered,
    q: JSON.stringify(b.T.Q), progress: JSON.stringify(S.progress[i] || null),
    days: JSON.stringify(S.days)
  };
}
const day = (b) => b.T.getS().days[today(b.now)];
const acts = (b) => b.query("#acts");
const btn = (b, id) => b.query("#" + id);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (error) { failed++; console.log(`FAIL  ${name}: ${error.message}`); }
}

console.log(`== 0. 夹具自检（守卫窗口 ${GUARD_MS}ms / ${GUARD_PX}px，取自真实实现） ==`);

await test("#acts/S 守卫常量与真实 app.js 已加载", () => {
  const b = browser();
  assert.ok(GUARD_MS >= 100 && GUARD_MS <= 2000, `守卫窗口应在合理范围，实际 ${GUARD_MS}`);
  assert.equal(typeof b.T.judge, "function");
  assert.equal(typeof b.T.tryNext, "function");
});

await test("recall 态存在会/不会按钮，尚未判定", () => {
  const b = browser(); startStudy(b);
  const no = btn(b, "no"), ok = btn(b, "ok");
  assert.ok(no && no.parentNode === acts(b), "#no 应是 #acts 的真实子节点");
  assert.ok(ok && ok.parentNode === acts(b), "#ok 应是 #acts 的真实子节点");
  assert.equal(b.T.phase, "recall");
  assert.equal(b.T.verdict, null);
  assert.equal(acts(b).innerHTML.includes('id="nx"'), false, "recall 态不应出现下一个");
});

console.log("== 1. 快速双击「不会」只判定一次并停留释义态 ==");

await test("双击不会：第二次落在新「下一个」按钮上被守卫吞掉", () => {
  const b = browser(); const S = startStudy(b);
  const i = b.T.cur, qLen = b.T.Q.length;
  // 第一次真实指针 click（detail=1）→ 判定不会
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 100, clientY: 300 });
  assert.equal(b.T.verdict, false, "第一次 click 应判定不会");
  assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.answered, 1);
  assert.equal(day(b).n, 1, "首次学习计一次新词");
  assert.equal(day(b).r, 1);
  assert.equal(b.T.Q.length, qLen, "判定本身不追加队列，重考在翻页时才入队");
  const before = snapshot(b);
  // 同一次双击的第二次 click：位置相同、同一帧、detail=2，命中的是重绘后的 #nx
  b.clickOn(btn(b, "nx"), { detail: 2, clientX: 100, clientY: 300 });
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(before), "第二次连击不得翻页/改判/叠加进度");
  assert.equal(b.T.cur, i, "必须停留在当前词");
  assert.equal(b.T.phase, "revealed", "必须停留释义态");
  assert.equal(b.T.verdict, false, "判定结果不得被第二次点击改写");
  assert.equal(day(b).n, 1, "新词只计一次");
  assert.equal(day(b).r, 1, "作答次数不叠加");
  assert.equal(day(b).no, 1, "不会次数不叠加");
  assert.equal(b.T.answered, 1, "answered 不叠加");
  assert.equal(b.T.Q.length, qLen, "重考队列不叠加（第二次点击未触发翻页）");
  assert.equal(S.progress[i][3], 1, "错次只 +1，不叠加");
  assert.equal(b.T.pendingReinforce(), 1, "待巩固只 1 次，不叠加");
  assert.equal(acts(b).dataset.guard, "judge-dblclick", "拦截时在 #acts 留下可观测标记");
  assert.match(b.query("#toast").textContent, /已记录判定/, "给出「已记录判定」提示而不是静默翻页");
});

await test("同帧 dispatchEvent 双发（下一个）也只判定一次", () => {
  const b = browser(); startStudy(b);
  const before = snapshot(b);
  // 两个 click 在同一微任务里同步派发，中间没有计时器/帧间隔
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 60, clientY: 320 });
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 60, clientY: 320 });
  assert.equal(b.T.cur, before.cur);
  assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.verdict, false);
  assert.equal(day(b).r, 1);
  assert.equal(b.T.answered, 1);
  assert.equal(acts(b).dataset.guard, "judge-dblclick");
});

await test("无坐标的合成连击按同位置处理，不能绕过守卫", () => {
  const b = browser(); startStudy(b);
  b.clickOn(btn(b, "no"), { detail: 1 });           // 判定点击本身无坐标
  const i = b.T.cur, qLen = b.T.Q.length;
  b.clickOn(btn(b, "nx"), { detail: 2 });           // 连击第二次也无坐标
  assert.equal(b.T.cur, i);
  assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.verdict, false);
  assert.equal(b.T.Q.length, qLen);
  assert.equal(day(b).r, 1);
});

console.log("== 2. 双击「会」不得命中 #fix 改判 ==");

await test("双击会：第二次落在「记错了，其实不会」上不改判", () => {
  const b = browser(); const S = startStudy(b);
  const i = b.T.cur;
  b.clickOn(btn(b, "ok"), { detail: 1, clientX: 120, clientY: 310 });
  assert.equal(b.T.verdict, true);
  assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.getS().progress[i][0], 1, "会：升到第 1 档");
  assert.ok(btn(b, "fix"), "释义态存在改判按钮 #fix");
  assert.ok(btn(b, "nx"), "释义态存在下一个按钮 #nx");
  b.clickOn(btn(b, "fix"), { detail: 2, clientX: 120, clientY: 310 });
  assert.equal(b.T.verdict, true, "第二次连击不得把「会」改成「不会」");
  assert.equal(b.T.getS().progress[i][0], 1, "阶段不得被改判回 0");
  assert.equal(day(b).ok, 1);
  assert.equal(day(b).no, 0, "不得凭空增加一次不会");
  assert.equal(b.T.answered, 1);
  assert.equal(acts(b).dataset.guard, "judge-dblclick");
});

console.log("== 3. 守卫只吞一次；窗口过后有意操作立即生效 ==");

await test("守卫窗口过后点「下一个」立即翻页", () => {
  const b = browser(); startStudy(b);
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 100, clientY: 300 });
  b.clickOn(btn(b, "nx"), { detail: 2, clientX: 100, clientY: 300 });  // 被吞
  const i = b.T.cur, qi = b.T.qi;
  b.advance(GUARD_MS + 60);   // 时钟可注入，不写死 sleep
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 100, clientY: 300 });
  assert.notEqual(b.T.cur, i, "窗口过后有意点下一个应翻页");
  assert.equal(b.T.qi, qi + 1);
  assert.equal(b.T.phase, "recall");
  assert.equal(b.T.verdict, null);
});

await test("被吞一次后，窗口内同位置独立点击仍生效（不重复吞）", () => {
  const b = browser(); startStudy(b);
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 50, clientY: 300 });
  b.clickOn(btn(b, "nx"), { detail: 2, clientX: 50, clientY: 300 });  // 吞掉
  const i = b.T.cur;
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 50, clientY: 300 });  // 同窗口内独立点击
  assert.notEqual(b.T.cur, i, "只吞一次，后续独立点击应正常翻页");
  assert.equal(b.T.qi, 1);
});

await test("坐标明显不同的点击视为有意操作立即生效（几何由 qa-browser 验证）", () => {
  const b = browser(); startStudy(b);
  b.clickOn(btn(b, "ok"), { detail: 1, clientX: 20, clientY: 80 });
  const i = b.T.cur;
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 20 + GUARD_PX + 60, clientY: 80 });
  assert.notEqual(b.T.cur, i, "远离判定点的点击不应被当成连击");
});

await test("键盘 / 程序触发的 click（detail=0）永不布防也永不拦截", () => {
  const b = browser(); startStudy(b);
  // detail=0 的会/不会模拟键盘激活：不布防
  b.clickOn(btn(b, "no"), { detail: 0 });
  assert.equal(b.T.verdict, false);
  const i = b.T.cur;
  // 紧接着 detail=0 的下一个：立即生效，无延迟
  b.clickOn(btn(b, "nx"), { detail: 0 });
  assert.notEqual(b.T.cur, i, "键盘激活的 click 不应被守卫拖慢");
  // 程序调用同样不受守卫影响
  b.T.judge(true);
  b.T.tryNext(true);
  assert.equal(b.T.qi, 2);
});

console.log("== 4. 键盘判定、下一个、改判、撤销不被拖慢 ==");

await test("键盘 j → 空格下一个连续操作无延迟", () => {
  const b = browser(); startStudy(b);
  b.key({ key: "j" });
  assert.equal(b.T.verdict, false, "j 判定不会");
  assert.equal(b.T.phase, "revealed");
  const qi = b.T.qi;
  b.key({ key: " " });   // 默认 next 键，同一时间点
  assert.equal(b.T.qi, qi + 1, "键盘下一个应立即生效");
  assert.equal(b.T.phase, "recall");
});

await test("键盘判定后改判与撤销照常", () => {
  const b = browser(); const S = startStudy(b);
  const i = b.T.cur;
  b.key({ key: "j" });
  b.key({ key: "f" });
  assert.equal(b.T.verdict, true, "键盘 f 改判为会");
  assert.equal(S.progress[i][0], 1);
  b.T.undo();
  assert.equal(b.T.verdict, false, "撤销改判回到不会");
  b.T.undo();
  assert.equal(b.T.phase, "recall", "撤销判定回到未判定");
  assert.equal(S.progress[i], undefined);
});

await test("守卫窗口内点击改判被吞（避免连击误操作），窗口后照常", () => {
  const b = browser(); const S = startStudy(b);
  const i = b.T.cur;
  b.clickOn(btn(b, "ok"), { detail: 1, clientX: 90, clientY: 300 });
  b.clickOn(btn(b, "fix"), { detail: 1, clientX: 90, clientY: 300 });  // 同位置秒点：吞
  assert.equal(b.T.verdict, true, "连击不得改判");
  assert.equal(b.T.phase, "revealed");
  assert.equal(S.progress[i][0], 1);
  b.advance(GUARD_MS + 50);
  b.clickOn(btn(b, "fix"), { detail: 1, clientX: 90, clientY: 300 });
  assert.equal(b.T.verdict, false, "窗口过后有意点改判立即生效");
  assert.equal(S.progress[i][0], 0);
});

await test("守卫窗口内点击撤销被吞，停留释义态；窗口后撤销照常", () => {
  const b = browser(); const S = startStudy(b);
  const i = b.T.cur;
  b.clickOn(btn(b, "ok"), { detail: 1, clientX: 70, clientY: 300 });
  b.clickOn(btn(b, "undoBtn"), { detail: 1, clientX: 70, clientY: 300 });  // 连击第二次：吞
  assert.equal(b.T.phase, "revealed", "连击不得撤销判定");
  assert.equal(b.T.verdict, true);
  assert.equal(S.progress[i][0], 1);
  b.advance(GUARD_MS + 50);
  b.clickOn(btn(b, "undoBtn"), { detail: 1, clientX: 70, clientY: 300 });
  assert.equal(b.T.phase, "recall", "窗口过后有意撤销立即生效");
  assert.equal(b.T.verdict, null);
});

await test("特训中也受连击保护，且有意翻页可继续", () => {
  const b = browser(); startStudy(b);
  b.T.judge(false); b.T.tryNext(true);      // 制造错词
  assert.equal(b.T.startDrill(), true);
  b.clickOn(btn(b, "ok"), { detail: 1, clientX: 10, clientY: 10 });
  assert.equal(b.T.verdict, true);
  const cur = b.T.cur, qi = b.T.qi;
  b.clickOn(btn(b, "nx"), { detail: 2, clientX: 10, clientY: 10 });
  assert.equal(b.T.cur, cur, "特训中连击被吞");
  assert.equal(b.T.qi, qi);
  b.advance(GUARD_MS + 50);
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 10, clientY: 10 });
  assert.notEqual(b.T.cur, cur, "特训中有意点下一个可继续");
  b.T.exitDrill();
});

await test("有意点「熟练」不受守卫影响；改判/撤销之外入口照常", () => {
  const b = browser(); startStudy(b);
  const i = b.T.cur;
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 33, clientY: 300 });
  b.advance(GUARD_MS + 50);
  assert.ok(btn(b, "markProficient"), "释义态存在熟练入口");
  b.clickOn(btn(b, "markProficient"), { detail: 1, clientX: 33, clientY: 300 });
  assert.equal(b.T.isProficient(i), true, "窗口过后有意点熟练应生效");
  assert.notEqual(b.T.cur, i, "熟练后当前卡移出背诵");
  assert.equal(b.T.Q.slice(b.T.qi).includes(i), false, "熟练词不再出现在后续队列");
});

await test("输入法组合与重复键不会触发判定", () => {
  const b = browser(); startStudy(b);
  b.key({ key: "j", isComposing: true });
  assert.equal(b.T.verdict, null, "输入法组合中的按键不判定");
  b.key({ key: "j", repeat: true });
  assert.equal(b.T.verdict, null, "按住重复键不判定");
  b.key({ key: "j" });
  assert.equal(b.T.verdict, false, "正常按键仍判定");
});

console.log("== 5. 触摸滚动 / pointermove 不触发判定 ==");

await test("触摸滚动（pointerdown→move→up，无 click）不判定", () => {
  const b = browser(); const S = startStudy(b);
  const before = snapshot(b);
  const no = btn(b, "no");
  b.fire(no, "pointerdown", { pointerType: "touch", clientX: 100, clientY: 400 });
  b.fire(no, "pointermove", { pointerType: "touch", clientX: 100, clientY: 320 });
  b.fire(no, "pointermove", { pointerType: "touch", clientX: 100, clientY: 260 });
  b.fire(no, "pointerup", { pointerType: "touch", clientX: 100, clientY: 260 });
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(before), "滚动/拖动不应判定或改变进度");
  assert.equal(b.T.verdict, null);
  const d = day(b) || { n: 0, r: 0, ok: 0, no: 0 };
  assert.equal(d.r, 0, "没有任何作答记录");
});

await test("pointermove 在卡片与操作区都不会触发判定", () => {
  const b = browser(); startStudy(b);
  const before = snapshot(b);
  b.fire(b.query("#card"), "pointermove", { pointerType: "mouse", clientX: 30, clientY: 200 });
  b.fire(acts(b), "pointermove", { pointerType: "touch", clientX: 30, clientY: 210 });
  b.fire(btn(b, "no"), "pointermove", { pointerType: "pen", clientX: 30, clientY: 220 });
  assert.equal(JSON.stringify(snapshot(b)), JSON.stringify(before));
  assert.equal(b.T.verdict, null);
});

console.log("== 6. 有意操作后界面回到正常流程 ==");

await test("吞掉连击后仍可逐次完成翻页/改判/撤销", () => {
  const b = browser(); startStudy(b);
  b.clickOn(btn(b, "no"), { detail: 1, clientX: 100, clientY: 600 });
  b.clickOn(btn(b, "nx"), { detail: 2, clientX: 100, clientY: 600 });
  b.advance(GUARD_MS + 120);
  b.clickOn(btn(b, "fix"), { detail: 1, clientX: 100, clientY: 600 });
  assert.equal(b.T.verdict, true, "窗口后改判成功");
  b.advance(10);
  b.clickOn(btn(b, "undoBtn"), { detail: 1, clientX: 100, clientY: 620 });
  assert.equal(b.T.verdict, false, "窗口后撤销改判成功");
  b.advance(10);
  b.clickOn(btn(b, "nx"), { detail: 1, clientX: 100, clientY: 640 });
  assert.equal(b.T.phase, "recall", "窗口后翻页成功");
  assert.equal(b.T.verdict, null);
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
