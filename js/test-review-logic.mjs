/**
 * 本轮审查发现的跨日改判、随机抽样与显示同步回归。
 * 使用独立浏览器环境运行实际 app.js，不复制业务逻辑。
 * 运行：node js/test-review-logic.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const PROF_KEY = "kaoyan_vocab_proficient_v1";
const appSource = () => fs.readFileSync(path.join(HERE, "app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function browser({ initial = null, raw = null, storageThrows = false, sharedStorage = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const registry = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const intervals = [];
  const storage = sharedStorage || new Map(initial === null ? [] : [[KEY, typeof initial === "string" ? initial : JSON.stringify(initial)]]);
  const created = [];
  function element(tag = "div", id = "") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(), id,
      _html: "", style: {}, dataset: {}, value: "", checked: false,
      hidden: false, disabled: false, files: [], scrollTop: 0, clientHeight: 600,
      textContent: "", onclick: null, onchange: null, offsetWidth: 100,
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
      removeEventListener() {},
      async dispatch(type, data = {}) { const e = { target: el, ...data }; if (el[`on${type}`]) await el[`on${type}`](e); for (const fn of events.get(type) || []) await fn(e); },
      click() { if (el.onclick) return el.onclick({ target: el, stopPropagation() {}, preventDefault() {} }); },
      focus() { document.activeElement = el; },
      blur() { document.activeElement = null; },
      closest(selector) { if (selector === "button" && el.tagName === "BUTTON") return el; if (selector === ".row" && classes.has("row")) return el; return null; },
      appendChild() {}, remove() {}, setAttribute(name, value) { el[name] = String(value); }, removeAttribute(name) { delete el[name]; },
      getAttribute(name) { return el[name] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
      querySelectorAll(selector) { return queryAll(selector); },
      querySelector(selector) { return query(selector); },
      contains(other) { return el === other; },
      setPointerCapture() {}, releasePointerCapture() {}
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html; },
      set(value) { el._html = String(value); }
    });
    return el;
  }
  const tagById = new Map();
  for (const match of indexSource.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    tagById.set(match[2], match[1]);
  }
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (!registry.has(selector)) registry.set(selector, element(tagById.get(selector.slice(1)) || "div", selector.startsWith("#") ? selector.slice(1) : ""));
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
    if (selector === "#helpSheet button" || selector.includes("[tabindex") && selector.includes("#helpSheet")) return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  query("#helpSheet").hidden = true;
  const document = {
    querySelector: query, querySelectorAll: queryAll,
    documentElement: { dataset: {}, style: {} }, body: element("body"),
    visibilityState: "visible", activeElement: null,
    addEventListener(type, fn) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(fn); },
    createElement(tag) { const el = element(tag); created.push(el); return el; }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class Reader {
    readAsText(file) { this.result = file.text; this.onload?.({ target: this }); }
  }
  const window = {
    document, addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {}
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console,
    localStorage: { getItem: k => { if (storageThrows) throw Error("storage disabled"); return storage.get(k) ?? null; }, setItem: (k, v) => { if (storageThrows) throw Error("storage disabled"); storage.set(k, String(v)); }, removeItem: k => storage.delete(k) },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: Reader,
    SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  if (raw) window.WORDS_RAW = raw;
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供测试入口");
  return {
    T, window, context, registry, storage, intervals, created, query, nav, keyButtons,
    get now() { return now; }, advance(ms) { now += ms; },
    storageEvent(key) { for (const fn of windowEvents.get("storage") || []) fn({ key, newValue: storage.get(key) ?? null }); },
    key(data) { const e = { key: "", code: "", target: document.body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, preventDefault() {}, stopPropagation() {}, ...data }; for (const fn of documentEvents.get("keydown") || []) fn(e); },
    async importFile(value) { const el = query("#file"); await el.dispatch("change", { target: { files: [{ text: typeof value === "string" ? value : JSON.stringify(value), size: 100, name: "backup.json" }], value: "backup.json" } }); }
  };
}

function fullScope(b, dailyNew = 10) {
  const S = b.T.getS();
  Object.assign(S.settings, { fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], order: "freq", dailyNew });
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  b.T.startSession();
  return S;
}

function requireProficient(b) {
  for (const name of ["isProficient", "setProficient", "resetProficient", "normalizeState", "importState", "buildQueue"])
    assert.equal(typeof b.T[name], "function", `缺少 ${name}`);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (error) { failed++; console.log(`FAIL  ${name}: ${error.message}`); }
}

await test("跨日反复改判只保留最终一次作答，保留当天其他学习记录", () => {
  const b = browser(), S = fullScope(b), firstDay = today(b.now);
  b.T.judge(false);
  b.advance(13 * 3600000);
  const secondDay = today(b.now);
  S.days[secondDay] = {n:2, r:5, ok:3, no:2};
  b.T.judge(true); b.T.judge(false); b.T.judge(true); b.T.judge(false);
  assert.deepEqual(clone(S.days[firstDay]), {n:0, r:0, ok:0, no:0});
  assert.deepEqual(clone(S.days[secondDay]), {n:3, r:6, ok:3, no:3});
  assert.equal(S.progress[b.T.cur][3], 1);
});

await test("跨三个日期改判和完整撤销均精确还原各日记录", () => {
  const b = browser(), S = fullScope(b), firstDay = today(b.now);
  b.T.judge(false);
  b.advance(86400000);
  const secondDay = today(b.now);
  S.days[secondDay] = {n:2, r:4, ok:3, no:1};
  b.T.judge(true);
  b.advance(86400000);
  const thirdDay = today(b.now);
  S.days[thirdDay] = {n:3, r:5, ok:2, no:3};
  b.T.judge(false);
  assert.deepEqual(clone(S.days[secondDay]), {n:2, r:4, ok:3, no:1});
  assert.deepEqual(clone(S.days[thirdDay]), {n:4, r:6, ok:2, no:4});
  b.T.undo();
  assert.deepEqual(clone(S.days[secondDay]), {n:3, r:5, ok:4, no:1});
  assert.deepEqual(clone(S.days[thirdDay]), {n:3, r:5, ok:2, no:3});
  b.T.undo();
  assert.deepEqual(clone(S.days[firstDay]), {n:1, r:1, ok:0, no:1});
  assert.deepEqual(clone(S.days[secondDay]), {n:2, r:4, ok:3, no:1});
  b.T.undo();
  assert.deepEqual(clone(S.days[firstDay]), {n:0, r:0, ok:0, no:0});
  assert.deepEqual(clone(S.days[thirdDay]), {n:3, r:5, ok:2, no:3});
});

await test("导入较早进度后重新学习不覆盖该词首次随机抽样", () => {
  const b = browser(), S = fullScope(b, 10);
  S.settings.order = "shuffle";
  b.T.startSession();
  const backup = clone(S), i = b.T.cur, word = b.T.getW()[i].w;
  b.T.judge(false);
  assert.equal(b.T.getSurvey()[word], 0);
  b.T.importState(backup);
  b.T.setCur(i); b.T.setVerdict(null);
  b.T.judge(true);
  assert.equal(b.T.getSurvey()[word], 0);
  b.T.judge(false); b.T.judge(true);
  assert.equal(b.T.getSurvey()[word], 0);
  b.T.undo(); b.T.undo(); b.T.undo();
  assert.equal(b.T.getSurvey()[word], 0);
});

await test("撤销判定后统计条与顶部进度条同时回滚", () => {
  const b = browser(); fullScope(b, 10);
  b.T.judge(true);
  assert.equal(b.query("#bar").style.width, "10%");
  b.T.undo();
  assert.equal(b.T.answered, 0);
  assert.equal(b.query("#bar").style.width, "0%");
});

await test("切换显示偏好立即更新当前卡片并保留判定和队列", async () => {
  const b = browser(), S = fullScope(b, 10);
  const i = b.T.getW().findIndex(w => w.ph && w.ex && w.fm);
  assert.ok(i >= 0);
  b.T.setCur(i);
  b.T.judge(true);
  const queue = JSON.stringify(b.T.Q), before = JSON.stringify(S.progress);
  b.T.show("set");
  for (const id of ["showPh", "showEx", "showFm"]) {
    b.query("#" + id).checked = false;
    await b.query("#" + id).dispatch("change");
  }
  b.T.show("study");
  const html = b.query("#card").innerHTML;
  assert.doesNotMatch(html, /class="ph"|class="ex"|class="fm"/);
  assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.verdict, true);
  assert.equal(JSON.stringify(b.T.Q), queue);
  assert.equal(JSON.stringify(S.progress), before);
});

console.log(`\n审查回归：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
