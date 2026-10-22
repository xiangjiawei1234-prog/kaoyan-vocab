/** 持久化审查回归：使用小词库与 DOM 桩执行真实 app.js，不复制业务逻辑。 */
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
const tuple = (word, rank) => [word, "", "释义", 0, rank, 10, 3, "", "", 1, ""];
const fixture = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(tuple);
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
  window.WORDS_RAW = raw || clone(fixture);
  window.WORDS_CET4 = clone(fixture);
  window.WORDS_CET6 = clone(fixture);
  window.WORDS_COMBINED = clone(fixture);
  window.WORD_BOOK_META = Object.fromEntries(["kaoyan", "cet4", "cet6", "combined"].map(id => [id, {paperCount: 46, dataVersion: 1}]));
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

const SURVEY_KEY = "kaoyan_vocab_survey_v1";
const ACTIVE_KEY = "vocab_active_book_v1";
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS  " + name); }
function shuffleSession(b) {
  Object.assign(b.T.getS().settings, {order: "shuffle", pmin: 0, dailyNew: 6});
  b.T.startSession();
}

test("保存失败后手动切书保留当前内存记录", () => {
  const b = browser();
  const setItem = b.context.localStorage.setItem;
  b.context.localStorage.setItem = (key, value) => {
    if (key === KEY) throw new Error("quota");
    setItem(key, value);
  };
  const i = b.T.cur;
  b.T.judge(true);
  assert.equal(b.T.switchBook("cet4"), false);
  assert.equal(b.T.getBook(), "kaoyan");
  assert.ok(b.T.getS().progress[i]);
  assert.match(b.query("#toast").textContent, /先导出进度备份/);
});

test("保存失败后跨标签切书不会丢掉本页记录", () => {
  const b = browser();
  b.context.localStorage.setItem = () => { throw new Error("quota"); };
  const i = b.T.cur;
  b.T.judge(false);
  b.storage.set(ACTIVE_KEY, "cet4");
  b.storageEvent(ACTIVE_KEY);
  assert.equal(b.T.getBook(), "kaoyan");
  assert.ok(b.T.getS().progress[i]);
});

test("空字符串记录视作损坏并保护，仍可使用其它词书", () => {
  const b = browser({initial: ""});
  assert.equal(b.T.getStorageOK(), false);
  assert.equal(b.storage.get(KEY), "");
  assert.equal(b.T.switchBook("cet4"), true);
  assert.equal(b.T.getStorageOK(), true);
  assert.equal(b.storage.get(KEY), "");
});

test("损坏独立名单不妨碍切去其它词书，已有主记录保持原样", () => {
  const raw = JSON.stringify({progress: {0: [1, 0, 1, 0, 0]}, days: {}});
  const b = browser({sharedStorage: new Map([[KEY, raw], [PROF_KEY, "{broken"]])});
  assert.equal(b.T.getStorageOK(), false);
  assert.equal(b.T.switchBook("cet4"), true);
  assert.equal(b.storage.get(KEY), raw);
});

test("损坏记录保护期间新作答仍保存在本页，不可切走丢失", () => {
  const b = browser({initial: "{broken"});
  const i = b.T.cur;
  b.T.judge(true);
  assert.equal(b.T.switchBook("cet4"), false);
  assert.ok(b.T.getS().progress[i]);
  assert.equal(b.storage.get(KEY), "{broken");
});

test("另一标签删除主键后本页清空旧进度，后续计时保存不复活", () => {
  const b = browser();
  const i = b.T.cur;
  b.T.judge(true);
  b.storage.delete(KEY);
  b.storageEvent(KEY);
  assert.equal(Object.keys(b.T.getS().progress).length, 0);
  // 旧测试用 15000ms 定时器触发保存；新口径是 1000ms 采样 + 有效学习活动。
  const study = b.window.__vocabStudy;
  assert.ok(study, "app.js 应提供 __vocabStudy 计时钩子");
  study.act();
  b.advance(31000);
  const timer = b.intervals.find(x => x.ms === study.getDebug().tickMs);
  assert.ok(timer, "应存在学习时长采样定时器");
  timer.fn();
  const saved = b.storage.get(KEY);
  assert.ok(saved, "同步后仍应能正常保存新记录");
  assert.equal(JSON.parse(saved).progress[i], undefined, "已删除的旧进度不得复活");
});

test("localStorage.clear 的空 key 事件同步清除进度与抽样", () => {
  const b = browser();
  shuffleSession(b);
  b.T.judge(true);
  assert.equal(b.T.getSurveyStats().n, 1);
  b.storage.clear();
  b.storageEvent(null);
  assert.equal(Object.keys(b.T.getS().progress).length, 0);
  assert.equal(b.T.getSurveyStats().n, 0);
});

test("延迟 storage 事件时新增和撤销抽样保留其它标签样本", () => {
  const b = browser();
  shuffleSession(b);
  const ownWord = b.T.getW()[b.T.cur].w;
  const otherWord = b.T.getW().find(w => w.w !== ownWord).w;
  b.storage.set(SURVEY_KEY, JSON.stringify({[otherWord]: 0}));
  b.T.judge(true);
  assert.deepEqual(JSON.parse(b.storage.get(SURVEY_KEY)), {[ownWord]: 1, [otherWord]: 0});
  b.T.undo();
  assert.deepEqual(JSON.parse(b.storage.get(SURVEY_KEY)), {[otherWord]: 0});
});

test("其它标签已重置抽样时旧标签新增样本不会复活旧样本", () => {
  const b = browser();
  shuffleSession(b);
  b.T.judge(true);
  const first = b.T.getW()[b.T.cur].w;
  b.T.tryNext(true);
  const second = b.T.getW()[b.T.cur].w;
  b.storage.delete(SURVEY_KEY);
  b.T.judge(false);
  const survey = JSON.parse(b.storage.get(SURVEY_KEY));
  assert.equal(survey[first], undefined);
  assert.equal(survey[second], 0);
});

test("导出以最新独立熟练名单为准，但不修改当前内存状态", () => {
  const b = browser();
  const w = b.T.getW()[0].w;
  const before = JSON.stringify(b.T.getS());
  b.storage.set(PROF_KEY, JSON.stringify({[w]: 123}));
  const first = b.T.buildExport();
  assert.equal(first.books.kaoyan.proficient[w], 123, "导出读取最新独立熟练名单");
  assert.equal(JSON.stringify(b.T.getS()), before, "导出不得修改内存中的学习状态");
  b.storage.set(PROF_KEY, "{}");
  const second = b.T.buildExport();
  assert.equal(second.books.kaoyan.proficient[w], undefined, "取消后的熟练词不复活");
  assert.equal(JSON.stringify(b.T.getS()), before, "再次导出仍不修改内存状态");
});
console.log(`持久化审查回归：${passed} 通过`);
