/**
 * 学习、熟练名单与备份安全回归。
 * 使用独立浏览器环境运行实际 app.js，不复制业务逻辑。
 * 运行：node js/test-regressions.mjs
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

await test("未判定翻页不写进度、不改变队列", () => {
  const b = browser(), S = fullScope(b);
  const before = JSON.stringify({ Q: b.T.Q, qi: b.T.qi, progress: S.progress, days: S.days });
  b.T.tryNext(true);
  assert.equal(JSON.stringify({ Q: b.T.Q, qi: b.T.qi, progress: S.progress, days: S.days }), before);
});

await test("新词只计一次新词，今日复习不重复计新词", () => {
  const b = browser(), S = fullScope(b), i = b.T.cur;
  b.T.judge(true);
  assert.equal(S.days[today(b.now)].n, 1);
  assert.equal(Number(b.query("#s-rev").textContent), 0);
  b.T.judge(false);
  assert.equal(S.days[today(b.now)].n, 1);
  assert.equal(S.days[today(b.now)].ok, 0);
  assert.equal(S.days[today(b.now)].no, 1);
  assert.ok(S.progress[i]);
});

await test("每天的新词额度跨会话生效", () => {
  const b = browser(), S = fullScope(b, 1);
  b.T.judge(true); b.T.tryNext(true); b.T.startSession();
  assert.equal(S.days[today(b.now)].n, 1);
  assert.equal(b.T.cur, null);
});

await test("撤销错词翻页后再前进不会追加两次重考", () => {
  const b = browser(); fullScope(b);
  const before = clone(b.T.Q);
  b.T.judge(false); b.T.tryNext(true);
  const after = clone(b.T.Q);
  b.T.undo();
  assert.equal(b.T.Q.length, before.length);
  b.T.tryNext(true);
  assert.equal(JSON.stringify(b.T.Q), JSON.stringify(after));
});

await test("延迟撤销改判，调度时间和计数精确还原", () => {
  const b = browser(), S = fullScope(b);
  const i = b.T.cur;
  b.T.judge(false);
  const before = JSON.stringify({ progress: S.progress[i], days: S.days });
  b.advance(12000); b.T.judge(true); b.advance(4000); b.T.undo();
  assert.equal(JSON.stringify({ progress: S.progress[i], days: S.days }), before);
  assert.equal(b.T.verdict, false);
});

await test("跨午夜撤销判定回滚原日期且不修改新一天计数", () => {
  const b = browser(), S = fullScope(b), originalDay = today(b.now);
  const original = clone(S.days[originalDay]);
  b.T.judge(true);
  b.advance(13 * 3600000);
  const nextDay = today(b.now);
  S.days[nextDay] = { n: 4, r: 9, ok: 6, no: 3 };
  const nextRecord = JSON.stringify(S.days[nextDay]);
  b.T.undo();
  assert.equal(JSON.stringify(S.days[originalDay] || { n: 0, r: 0, ok: 0, no: 0 }), JSON.stringify(original));
  assert.equal(JSON.stringify(S.days[nextDay]), nextRecord);
});

await test("完成页仍可撤销最后一次翻页", () => {
  const b = browser(); fullScope(b, 1);
  const i = b.T.cur;
  b.T.judge(true); b.T.tryNext(true);
  assert.equal(b.T.cur, null);
  b.T.undo();
  assert.equal(b.T.cur, i);
  assert.equal(b.T.verdict, true);
});

await test("标为熟练不占新词配额并清除所有重复项", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b, 3), i = b.T.cur, word = b.T.getW()[i].w;
  const dayBefore = JSON.stringify(S.days);
  b.T.Q.push(i, i);
  b.T.setProficient(i, true);
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.includes(i), false);
  assert.notEqual(b.T.cur, i);
  assert.equal(JSON.stringify(S.days), dayBefore);
  assert.equal(b.T.answered, 0);
  assert.ok(S.proficient[word]);
  assert.equal(b.T.buildQueue(b.now).fresh.includes(i), false);
});

await test("熟练名单从所有复习、错词、乱序队列排除", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur;
  S.progress[i] = [1, b.now - 10000, 0, 3, b.now - 20000];
  b.T.setProficient(i, true);
  for (const order of ["freq", "wrong", "shuffle"]) {
    S.settings.order = order; b.T.startSession();
    assert.equal(b.T.Q.includes(i), false, `${order} 不应入队`);
    assert.equal(b.T.buildQueue(b.now).due.includes(i), false);
  }
});

await test("熟练后的判定和自动重学均不覆写熟练名单", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur;
  b.T.setProficient(i, true);
  const before = JSON.stringify({ progress: S.progress, days: S.days });
  b.T.setCur(i); b.T.judge(false);
  assert.equal(JSON.stringify({ progress: S.progress, days: S.days }), before);
  b.advance(365 * 86400000); b.T.startSession();
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.includes(i), false);
  assert.ok(S.proficient[b.T.getW()[i].w]);
});

await test("熟练名单刷新页面后仍生效", () => {
  const b = browser(); requireProficient(b);
  fullScope(b);
  const i = b.T.cur; b.T.setProficient(i, true);
  const reloaded = browser({ initial: b.storage.get(KEY) });
  assert.equal(reloaded.T.isProficient(i), true);
  assert.equal(reloaded.T.Q.includes(i), false);
});

await test("熟练后的撤销不会让熟练词回到卡片或队尾", () => {
  const b = browser(); requireProficient(b);
  fullScope(b);
  const i = b.T.cur;
  b.T.judge(false); b.T.tryNext(true); b.T.undo();
  b.T.setProficient(i, true); b.T.undo();
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.slice(b.T.qi).includes(i), false);
  assert.notEqual(b.T.cur, i);
});

await test("取消熟练可恢复新词和已有到期复习", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b, 100), i = b.T.cur, j = b.T.Q[1];
  S.progress[j] = [1, b.now - 1, 0, 2, b.now - 1000];
  b.T.setProficient(i, true); b.T.setProficient(j, true);
  b.T.setProficient(i, false); b.T.setProficient(j, false);
  const q = b.T.buildQueue(b.now);
  assert.equal(q.fresh.includes(i), true);
  assert.equal(q.due.includes(j), true);
});

await test("重置熟练名单不删除学习调度或收藏", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur;
  b.T.judge(false);
  S.stars[i] = 1;
  const progress = JSON.stringify(S.progress);
  b.T.setProficient(i, true); b.T.resetProficient();
  assert.equal(Object.keys(S.proficient).length, 0);
  assert.equal(JSON.stringify(S.progress), progress);
  assert.equal(S.stars[i], 1);
});

await test("熟练占全部当前范围时队列为空且统计不为负", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), indices = b.T.getW().map((_, i) => i);
  for (const i of indices) S.proficient[b.T.getW()[i].w] = b.now;
  b.T.startSession(); b.T.show("stats");
  assert.equal(b.T.inScopeCount(), 0);
  assert.equal(b.T.cur, null);
  assert.equal(b.T.Q.length, 0);
  assert.doesNotMatch(b.query("#kpis").innerHTML, /<b>-\d/);
});

await test("熟练列表可查看、默认词表不混入熟练词", () => {
  const b = browser(); requireProficient(b);
  fullScope(b);
  const i = b.T.cur, w = b.T.getW()[i].w;
  b.T.setProficient(i, true);
  b.query("#fsc").value = "all"; b.query("#fst").value = "all"; b.query("#q").value = w;
  b.T.applyFilter();
  assert.doesNotMatch(b.query("#listInner").innerHTML, new RegExp(`data-i="${i}"`));
  b.query("#fst").value = "proficient"; b.T.applyFilter();
  assert.match(b.query("#listInner").innerHTML, new RegExp(`data-i="${i}"`));
});

await test("备份导出导入保留熟练、收藏和复习调度", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur;
  b.T.judge(false); S.stars[i] = 1; b.T.setProficient(i, true);
  const backup = clone(S);
  const other = browser(); other.T.importState(backup);
  assert.equal(other.T.isProficient(i), true);
  assert.equal(JSON.stringify(other.T.getS().progress[i]), JSON.stringify(backup.progress[i]));
  assert.equal(other.T.getS().stars[i], 1);
  assert.equal(other.T.Q.includes(i), false);
});

await test("旧版备份无熟练字段也可导入且不会丢失进度", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur; b.T.judge(true);
  const backup = clone(S); delete backup.proficient;
  b.T.importState(backup);
  assert.ok(b.T.getS().progress[i]);
  assert.equal(Object.keys(b.T.getS().proficient).length, 0);
});

await test("导入旧备份不会让当前熟练词重新入队", () => {
  const b = browser(); requireProficient(b);
  const S = fullScope(b), i = b.T.cur, backup = clone(S);
  delete backup.proficient;
  b.T.setProficient(i, true); b.T.importState(backup);
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.includes(i), false);
});

await test("另一标签普通保存不能抹去刚新增的熟练词", () => {
  const a = browser(); fullScope(a);
  const b = browser({ sharedStorage: a.storage }); fullScope(b);
  const i = a.T.cur, word = a.T.getW()[i].w;
  a.T.setProficient(i, true);
  b.intervals.find(t => t.ms === 15000).fn();
  assert.ok(JSON.parse(a.storage.get(PROF_KEY))[word]);
  assert.ok(JSON.parse(a.storage.get(KEY)).proficient[word]);
  b.storageEvent(PROF_KEY);
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.includes(i), false);
});

await test("多标签先后标熟练会合并，取消和名单重置同步生效", () => {
  const a = browser(); fullScope(a);
  const b = browser({ sharedStorage: a.storage }); fullScope(b);
  const i = a.T.cur, j = a.T.Q[1];
  a.T.setProficient(i, true); b.T.setProficient(j, true);
  a.storageEvent(PROF_KEY);
  assert.equal(a.T.isProficient(i), true); assert.equal(a.T.isProficient(j), true);
  a.T.setProficient(i, false); b.storageEvent(PROF_KEY);
  assert.equal(b.T.isProficient(i), false); assert.equal(b.T.isProficient(j), true);
  a.T.resetProficient(); b.storageEvent(PROF_KEY);
  assert.equal(Object.keys(b.T.getS().proficient).length, 0);
});

await test("仅学习时长的外部同步不重置当前已判定卡片", () => {
  const b = browser(); fullScope(b);
  const i = b.T.cur; b.T.judge(true);
  const state = clone(b.T.getS()); state.timeSec += 15;
  const beforeQ = JSON.stringify(b.T.Q), beforeProgress = JSON.stringify(b.T.getS().progress);
  b.storage.set(KEY, JSON.stringify(state)); b.storageEvent(KEY);
  assert.equal(b.T.cur, i); assert.equal(b.T.verdict, true); assert.equal(b.T.phase, "revealed");
  assert.equal(b.T.answered, 1); assert.equal(JSON.stringify(b.T.Q), beforeQ);
  assert.equal(JSON.stringify(b.T.getS().progress), beforeProgress);
  assert.equal(b.T.getS().timeSec, state.timeSec);
});

await test("另一标签未收到事件时，时长自动保存不会覆盖新判定", () => {
  const a = browser(); fullScope(a);
  const b = browser({ sharedStorage: a.storage }); fullScope(b);
  const i = a.T.cur;
  a.T.judge(true);
  const judged = clone(a.T.getS());
  b.intervals.find(t => t.ms === 15000).fn();
  const saved = JSON.parse(a.storage.get(KEY));
  assert.equal(JSON.stringify(saved.progress), JSON.stringify(judged.progress));
  assert.equal(JSON.stringify(saved.days), JSON.stringify(judged.days));
  assert.equal(JSON.stringify(b.T.getS().progress[i]), JSON.stringify(judged.progress[i]));
  assert.equal(b.T.Q.includes(i), false);
});

await test("另一标签未收到事件时，设置保存不会覆盖新判定", async () => {
  const a = browser(); fullScope(a);
  const b = browser({ sharedStorage: a.storage }); fullScope(b); b.T.show("set");
  const i = a.T.cur;
  a.T.judge(false);
  const judged = clone(a.T.getS());
  b.query("#dailyNew").value = 7;
  await b.query("#dailyNew").dispatch("change");
  const saved = JSON.parse(a.storage.get(KEY));
  assert.equal(JSON.stringify(saved.progress), JSON.stringify(judged.progress));
  assert.equal(JSON.stringify(saved.days), JSON.stringify(judged.days));
  assert.equal(JSON.stringify(b.T.getS().progress[i]), JSON.stringify(judged.progress[i]));
});

await test("另一标签的熟练标记在事件送达前也不会被备份导入清除", () => {
  const a = browser(); fullScope(a);
  const b = browser({ sharedStorage: a.storage }); fullScope(b);
  const backup = clone(b.T.getS()), i = a.T.cur, word = a.T.getW()[i].w;
  a.T.setProficient(i, true);
  b.T.importState(backup);
  assert.equal(b.T.isProficient(i), true);
  assert.ok(JSON.parse(a.storage.get(PROF_KEY))[word]);
});

await test("主进度损坏时仍保留独立存储的熟练名单", () => {
  const a = browser(); fullScope(a);
  const i = a.T.cur;
  a.T.setProficient(i, true); a.storage.set(KEY, "{bad json");
  const b = browser({ sharedStorage: a.storage });
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.Q.includes(i), false);
  assert.equal(b.T.getStorageOK(), false);
});

await test("外部同步的熟练数据损坏时保持现有完整状态", () => {
  const b = browser(); fullScope(b); b.T.judge(true);
  const before = JSON.stringify(b.T.getS());
  const other = clone(b.T.getS()); other.progress = {}; other.days = {};
  b.storage.set(KEY, JSON.stringify(other)); b.storage.set(PROF_KEY, "{bad json");
  b.storageEvent(PROF_KEY);
  assert.equal(JSON.stringify(b.T.getS()), before);
});

await test("跨天保留当前卡/判定/撤销，下一组才使用新一天配额", () => {
  const b = browser(), S = fullScope(b, 1);
  const i = b.T.cur;
  b.T.judge(true);
  assert.equal(b.T.verdict, true);
  b.advance(86400000);
  b.intervals.find(t => t.ms === 60000).fn();
  assert.equal(b.T.cur, i, "跨天不得换掉当前卡");
  assert.equal(b.T.verdict, true, "跨天不得清空判定");
  assert.equal(b.T.phase, "revealed");
  assert.equal(S.days[today(b.now)].n, 0, "新一天新词额度归零");
  b.T.undo();
  assert.equal(b.T.verdict, null, "跨天后撤销历史仍可用");
  assert.equal(S.progress[i], undefined);
  b.T.startSession();
  assert.notEqual(b.T.cur, null, "下一组按新配额补充新词");
  assert.ok(b.T.Q.length >= 1);
});

await test("特训后撤销首次学习，再次学习恰好计一次新词", () => {
  const b = browser(), S = fullScope(b, 10);
  const i = b.T.cur;
  b.T.judge(false);
  assert.equal(S.days[today(b.now)].n, 1);
  assert.equal(b.T.startDrill(), true, "错词特训应可开始");
  assert.equal(b.T.cur, i);
  b.T.judge(true);            // 特训把错次清零
  b.T.exitDrill();
  b.T.undo();                 // 撤销主学习首次判定
  assert.equal(S.progress[i], undefined, "撤销后回到未学");
  assert.equal(S.days[today(b.now)].n, 0, "新词额度一并回滚");
  const fresh = b.T.buildQueue().fresh;
  assert.equal(fresh.includes(i), true, "未学词应回到新词队列");
  b.T.setCur(i); b.T.setVerdict(null);
  b.T.judge(true);
  assert.equal(S.days[today(b.now)].n, 1, "再次首次学习只计一次新词");
});

await test("特训占位计入错词本但不冒充已学，仍按新词入队", () => {
  const b = browser(), S = fullScope(b);
  const i = b.T.cur;
  b.T.applyDrill(i, false);
  assert.equal(b.T.hasMainProgress(S.progress[i]), false, "占位不是主学习");
  assert.equal(b.T.isMainLearned(i), false);
  assert.equal(b.T.buildQueue().fresh.includes(i), true, "未学词仍在 fresh 队列");
  b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>1<\/b><span>错词/, "占位错次计入错词");
  assert.doesNotMatch(b.query("#kpis").innerHTML, /<b>1<\/b><span>已掌握/);
});

await test("答错追加重考不扩大本组进度分母，并单独显示待巩固", () => {
  const b = browser(), S = fullScope(b, 3);
  const total = b.T.getGroupTotal();
  assert.equal(total, 3);
  b.T.judge(false);
  assert.match(b.query("#s-prog").textContent, /^1\/3$/, "首答后主进度 1/3");
  b.T.tryNext(true);
  assert.equal(b.T.getGroupTotal(), 3, "重考不改变本组初始词数");
  assert.match(b.query("#s-prog").textContent, /^1\/3$/, "重考后主进度不倒退也不扩分母");
  assert.match(b.query("#s-pending").textContent, /待巩固 1 次/, "重考单独显示待巩固");
});

await test("修改设置时限制额度和覆盖数并重建匹配词队列", async () => {
  const b = browser(), S = fullScope(b);
  b.T.show("set");
  b.query("#dailyNew").value = 99999; b.query("#pmin").value = 99;
  await b.query("#dailyNew").dispatch("change");
  assert.equal(S.settings.dailyNew, 500); assert.equal(S.settings.pmin, 46);
  assert.ok(b.T.Q.every(i => b.T.getW()[i].c >= 46));
});

for (const bad of [null, [], "text", 23, { progress: null }, { days: null }, { settings: null, progress: [] }]) {
  await test(`异常备份被拒绝或安全归一化：${JSON.stringify(bad)}`, () => {
    const b = browser(); requireProficient(b);
    const S = fullScope(b); b.T.judge(true);
    const before = JSON.stringify(b.T.getS());
    try { b.T.importState(bad); } catch {}
    const after = b.T.getS();
    assert.ok(after && after.settings && after.progress && after.days && after.proficient);
    assert.equal(Array.isArray(after.progress), false);
    assert.equal(Array.isArray(after.days), false);
    assert.equal(typeof after.settings.dailyNew, "number");
    b.T.startSession();
    if (!bad || Array.isArray(bad) || typeof bad !== "object") assert.equal(JSON.stringify(b.T.getS()), before);
  });
}

await test("无效 JSON 文件导入不改变当前进度或已保存备份", async () => {
  const b = browser(), S = fullScope(b); b.T.judge(true);
  const before = JSON.stringify(S), stored = b.storage.get(KEY);
  await b.importFile("{invalid json");
  assert.equal(JSON.stringify(b.T.getS()), before);
  assert.equal(b.storage.get(KEY), stored);
});

await test("损坏本地备份不造成白屏、保护原记录，显式重置后可保存", () => {
  for (const initial of ["{bad", { progress: null, days: null, stars: null }, { progress: [] }, { settings: { keys: { know: 2 }, pos: null } }]) {
    const b = browser({ initial });
    assert.ok(b.T.getS().settings);
    b.T.startSession();
    assert.equal(b.T.getStorageOK(), false);
    b.query("#rst").click();
    assert.equal(b.T.getStorageOK(), true);
    assert.doesNotThrow(() => JSON.parse(b.storage.get(KEY)));
  }
});

await test("导入无效索引和调度数据不会影响有效词条", () => {
  const b = browser(); requireProficient(b);
  fullScope(b); b.T.judge(true);
  const before = JSON.stringify(b.T.getS());
  const malformed = {
    settings: { dailyNew: 1000, pmin: 100, fmin: -2, fmax: -3, pos: ["n", "bogus"], order: "<img>" },
    progress: { 0: [1, b.now, 2, 3, b.now - 5000], 1: [-1, 0, 0, 0, 0], 2: [Infinity, 0, 0, 0, 0], 3: [1, "<svg>", 0, 0, 0], 999999: [1, 0, 0, 0, 0], constructor: [1, 0, 0, 0, 0] },
    days: { "bad date": { n: 5, r: 1, ok: 0, no: 1 }, "2026-10-10": { n: -1, r: 2, ok: 1, no: 1 } },
    stars: { 0: 1, 999999: 1 },
    proficient: { people: b.now, "unknown-word": b.now, "<script>": b.now }
  };
  assert.throws(() => b.T.normalizeState(malformed));
  try { b.T.importState(malformed); } catch {}
  assert.equal(JSON.stringify(b.T.getS()), before);
  const clean = b.T.normalizeState({ settings: malformed.settings, progress: { 0: malformed.progress[0] }, days: {}, stars: {0:1}, proficient: {people:b.now} });
  assert.deepEqual(clone(clean.progress[0]), [1, b.now, 2, 3, b.now - 5000]);
  assert.equal(clean.settings.dailyNew, 500);
  assert.equal(clean.settings.pmin, 46);
  assert.equal(clean.settings.order, "freq");
  assert.equal(clean.settings.fmin, 1);
  assert.equal(clean.settings.fmax, 0);
  assert.deepEqual(clone(clean.settings.pos), ["n"]);
});

await test("危险和冲突快捷键导入不能注入页面或抢占保留键", () => {
  const b = browser(); requireProficient(b);
  b.T.importState({ settings: { keys: { know: '\"><img src=x onerror=alert(1)>', dont: "?", next: "Escape", speak: "F", star: "f" } }, progress: {}, days: {}, stars: {} });
  const keys = b.T.getS().settings.keys;
  assert.equal(Object.values(keys).some(k => k.includes("<") || k.includes("\"")), false);
  assert.equal(Object.values(keys).includes("?"), false);
  assert.equal(Object.values(keys).includes("Escape"), false);
  const normal = Object.values(keys).map(k => k.toLowerCase());
  assert.equal(new Set(normal).size, normal.length);
  assert.doesNotMatch(b.query("#card").innerHTML, /<img|onerror/);
});

await test("快捷键忽略 Ctrl、Alt、Meta、重复和输入法事件", () => {
  const b = browser(), S = fullScope(b);
  const before = JSON.stringify(S.progress);
  for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { repeat: true }, { isComposing: true }]) b.key({ key: "f", ...modifier });
  assert.equal(JSON.stringify(S.progress), before);
  assert.equal(b.T.verdict, null);
  b.key({ key: "f" });
  assert.equal(b.T.verdict, true);
});

await test("关闭单字符快捷键后字母/空格/问号不触发，方向键与 Enter 仍可用", () => {
  const b = browser(), S = fullScope(b);
  S.settings.singleCharKeys = false;
  b.query("#singleCharKeys").checked = false;
  const before = JSON.stringify(S.progress);
  b.key({ key: "f" });
  b.key({ key: " " });
  b.key({ key: "?" });
  assert.equal(JSON.stringify(S.progress), before, "关闭后字母/空格不得判定");
  assert.equal(b.T.verdict, null);
  assert.equal(b.query("#helpSheet").hidden, true, "关闭后 ? 不打开帮助");
  const old = b.T.cur;
  b.key({ key: "ArrowRight" });
  assert.equal(b.T.verdict, true, "方向键保留");
  b.key({ key: "Enter" });
  assert.notEqual(b.T.cur, old, "Enter 保留翻页");
  S.settings.singleCharKeys = true;
  b.key({ key: "j" });
  assert.equal(b.T.verdict, false, "重新启用后字母恢复");
  const normalized = b.T.normalizeState({ settings: { singleCharKeys: false }, progress: {}, days: {} });
  assert.equal(normalized.settings.singleCharKeys, false, "设置可持久化");
});

await test("熟练保存失败：导出合入待写入增删且不修改内存", () => {
  const b = browser(), S = fullScope(b);
  const i = b.T.cur, w = b.T.getW()[i].w;
  const other = b.T.getW()[i + 1].w;
  b.storage.set(PROF_KEY, JSON.stringify({ [other]: 111 }));
  const setItem = b.context.localStorage.setItem;
  b.context.localStorage.setItem = (key, value) => {
    if (key === PROF_KEY) throw new Error("quota");
    setItem(key, value);
  };
  b.T.setProficient(i, true);
  assert.equal(b.T.isProficient(i), true, "内存中保留新增熟练");
  assert.match(b.T.getStorageAlert(), /考研英语/, "保存失败应持续提示受影响词书");
  const before = JSON.stringify(b.T.getS());
  const added = b.T.buildExport();
  assert.equal(added.books.kaoyan.proficient[w], S.proficient[w], "待写入新增并入导出");
  assert.equal(added.books.kaoyan.proficient[other], 111, "同时保留最新独立名单");
  assert.equal(JSON.stringify(b.T.getS()), before, "导出前后学习状态一致");

  // 取消熟练写入失败时，导出也不能让旧存储值复活。
  b.storage.set(PROF_KEY, JSON.stringify({ [w]: 111, [other]: 111 }));
  b.T.setProficient(i, false);
  const removed = b.T.buildExport();
  assert.equal(removed.books.kaoyan.proficient[w], undefined, "待写入取消操作覆盖旧存储值");
  assert.equal(removed.books.kaoyan.proficient[other], 111);
  b.context.localStorage.setItem = setItem;
});

await test("Ctrl+Z 和 Cmd+Z 的真实键盘事件都能撤销判定", () => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const b = browser(), S = fullScope(b), i = b.T.cur;
    b.key({ key: "f" }); assert.equal(b.T.verdict, true);
    b.key({ key: "z", [modifier]: true });
    assert.equal(b.T.verdict, null); assert.equal(b.T.phase, "recall");
    assert.equal(S.progress[i], undefined);
    assert.equal(S.days[today(b.now)].n, 0);
  }
});

await test("熟练按钮与默认快捷键 M 都连接永久排除功能", () => {
  for (const action of [b => b.query("#markProficient").click(), b => b.key({ key: "m" })]) {
    const b = browser(); requireProficient(b); fullScope(b);
    const i = b.T.cur;
    assert.match(b.query("#acts").innerHTML, /id="markProficient"/);
    action(b);
    assert.equal(b.T.isProficient(i), true);
    assert.notEqual(b.T.cur, i);
    assert.equal(b.T.answered, 0);
  }
});

await test("词表详情查看不替换背诵队列且不突破新词额度", () => {
  const b = browser(); requireProficient(b); fullScope(b, 1);
  const i = b.T.cur, next = b.T.getW().findIndex((_, index) => index !== i);
  b.T.judge(true);
  const before = JSON.stringify({ Q: b.T.Q, cur: b.T.cur, verdict: b.T.verdict, S: b.T.getS() });
  b.T.show("list"); b.T.openWord(next);
  assert.equal(JSON.stringify({ Q: b.T.Q, cur: b.T.cur, verdict: b.T.verdict, S: b.T.getS() }), before);
  assert.equal(b.query("#wordTitle").textContent, b.T.getW()[next].w);
  assert.equal(b.query("#wordSheet").hidden, false);
  b.T.closeSheet();
  assert.equal(b.query("#wordSheet").hidden, true);
});

await test("有输入焦点时快捷键不会判定或翻页", () => {
  const b = browser(); fullScope(b);
  b.key({ key: "f", target: { tagName: "INPUT" } });
  b.key({ key: "f", target: { tagName: "DIV", isContentEditable: true } });
  assert.equal(b.T.verdict, null);
});

await test("空白学习天不计入学习天数", () => {
  const b = browser(); fullScope(b); b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>0<\/b><span>学习天数<\/span>/);
});

await test("当前范围内掌握数和未学数不被其他词影响", () => {
  const b = browser(), S = fullScope(b);
  const W = b.T.getW(), outside = W.findIndex(x => x.f < 5);
  S.progress[outside] = [11, 0, 11, 0, b.now];
  S.settings.fmin = 5;
  b.T.show("stats");
  assert.equal(b.T.scopedMasteredCount(), 0);
  assert.match(b.query("#kpis").innerHTML, /<b>0<\/b><span>已掌握<\/span>/);
  assert.doesNotMatch(b.query("#kpis").innerHTML, /<b>-\d/);
});

await test("词表筛选结果缩小时返回顶部并呈现匹配行", () => {
  const b = browser(); fullScope(b);
  b.query("#listScroll").scrollTop = 200000;
  b.query("#q").value = b.T.getW()[0].w;
  b.T.applyFilter();
  assert.equal(b.query("#listScroll").scrollTop, 0);
  assert.match(b.query("#listInner").innerHTML, /data-i="0"/);
});

await test("词表按词频排名显示补收录词，同时保持迁移后的数组主键", async () => {
  const b = browser(); fullScope(b); b.T.show("list");
  const W = b.T.getW(), first = b.query("#listInner").innerHTML.match(/class="row(?: row-active)?" data-i="(\d+)" style="top:0px"><span class="c-rank">#(\d+)<\/span>/);
  assert.ok(first);
  const tailStart = W.findIndex(x => x.w === "can");
  assert.equal(Number(first[1]), tailStart);
  assert.equal(Number(first[2]), 1);
  assert.equal(W[tailStart].w, "can");
  for (const [offset, word] of ["can", "one", "will", "may", "own"].entries()) {
    const i = tailStart + offset;
    assert.equal(W.findIndex(x => x.w === word), i);
    const top = (W[i].r - 1) * 52;
    b.query("#listScroll").scrollTop = top;
    await b.query("#listScroll").dispatch("scroll");
    const html = b.query("#listInner").innerHTML;
    assert.match(html, new RegExp(`data-i="${i}" style="top:${top}px"><span class="c-rank">#${W[i].r}<`));
    const ranks = [...html.matchAll(/class="c-rank">#(\d+)</g)].map(m => Number(m[1]));
    assert.ok(ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]));
  }
});

await test("存储被禁用仍可学习并导出内存中的记录", () => {
  const b = browser({ storageThrows: true }); fullScope(b);
  b.T.judge(true);
  assert.equal(b.T.verdict, true);
  assert.equal(b.T.getStorageOK(), false);
  assert.doesNotThrow(() => b.query("#exp").click());
});

await test("连续三天学习 streak 为 3，断档后只计连续段", () => {
  const b = browser(), S = fullScope(b);
  for (const d of [0, 1, 2]) S.days[today(b.now - d * 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>3 天<\/b><span>连续打卡/);
  S.days[today(b.now - 4 * 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  S.days[today(b.now - 5 * 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>3 天<\/b><span>连续打卡/);
});

await test("今日尚未学习时 streak 仍累计之前连续天数", () => {
  const b = browser(), S = fullScope(b);
  for (const d of [1, 2, 3]) S.days[today(b.now - d * 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  S.days[today(b.now)] = { n: 0, r: 0, ok: 0, no: 0 };
  b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>3 天<\/b><span>连续打卡/);
});

await test("空白日（r=0）不计入 streak 也不计学习天数", () => {
  const b = browser(), S = fullScope(b);
  S.days[today(b.now)] = { n: 0, r: 0, ok: 0, no: 0 };
  S.days[today(b.now - 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  b.T.show("stats");
  assert.match(b.query("#kpis").innerHTML, /<b>1 天<\/b><span>连续打卡/);
  assert.match(b.query("#kpis").innerHTML, /<b>1<\/b><span>学习天数<\/span>/);
});

await test("统计最近 14 天窗口截断更早的学习记录", () => {
  const b = browser(), S = fullScope(b);
  S.days[today(b.now - 20 * 86400000)] = { n: 5, r: 10, ok: 8, no: 2 };
  b.T.show("stats");
  assert.equal(b.query("#daysHint").textContent, "最近 14 天还没有学习记录");
  assert.match(b.query("#kpis").innerHTML, /<b>1<\/b><span>学习天数<\/span>/);
  S.days[today(b.now - 13 * 86400000)] = { n: 1, r: 1, ok: 1, no: 0 };
  b.T.show("stats");
  assert.equal(b.query("#daysHint").textContent, "");
});

await test("改判来回切换不叠加 stage，已掌握边界可升可降", () => {
  const b = browser(), S = fullScope(b), i = b.T.cur;
  for (let k = 0; k < 4; k++) { b.T.judge(k % 2 === 0); }
  b.T.judge(true);
  assert.equal(S.progress[i][0], 1);
  assert.equal(S.days[today(b.now)].n, 1);
  assert.equal(S.days[today(b.now)].r, 1);
  assert.equal(b.T.answered, 1);
  S.progress[i] = [11, b.now + 86400000, 11, 0, b.now];
  b.T.setCur(i); b.T.setVerdict(null); b.T.judge(true);
  assert.equal(S.progress[i][0], 11);
  b.T.setVerdict(null); b.T.judge(false);
  assert.equal(S.progress[i][0], 0);
});

await test("撤销链可逐步回滚判定、改判与多步翻页", () => {
  const b = browser(), S = fullScope(b, 30);
  const w0 = b.T.cur;
  b.T.judge(true); b.T.tryNext(true);
  const w1 = b.T.cur;
  b.T.judge(false); b.T.judge(true); b.T.tryNext(true);
  const w2 = b.T.cur;
  b.T.judge(false);
  b.T.undo();
  assert.equal(b.T.cur, w2); assert.equal(b.T.verdict, null); assert.equal(S.progress[w2], undefined);
  b.T.undo();
  assert.equal(b.T.cur, w1); assert.equal(b.T.verdict, true); assert.equal(S.progress[w1][0], 1);
  b.T.undo();
  assert.equal(b.T.cur, w1); assert.equal(b.T.verdict, false); assert.equal(S.progress[w1][0], 0);
  b.T.undo();
  assert.equal(b.T.cur, w1); assert.equal(b.T.verdict, null); assert.equal(S.progress[w1], undefined);
  b.T.undo();
  assert.equal(b.T.cur, w0); assert.equal(b.T.verdict, true); assert.equal(S.progress[w0][0], 1);
  b.T.undo();
  assert.equal(b.T.cur, w0); assert.equal(b.T.verdict, null); assert.equal(b.T.answered, 0);
});

await test("pos 筛选与 fmin/pmin/fmax 组合精确计数", () => {
  const b = browser(); fullScope(b);
  const S = b.T.getS(), W = b.T.getW();
  S.settings.pos = ["n"];
  assert.equal(b.T.inScopeCount(), W.filter(x => x.p === 0).length);
  S.settings.pos = ["x"];
  assert.equal(b.T.inScopeCount(), W.filter(x => ![0, 1, 2, 3].includes(x.p)).length);
  S.settings.pos = ["n", "v"];
  assert.equal(b.T.inScopeCount(), W.filter(x => x.p === 0 || x.p === 1).length);
  S.settings.pos = [];
  S.settings.fmin = 5; S.settings.pmin = 3; S.settings.fmax = 20;
  assert.equal(b.T.inScopeCount(), W.filter(x => x.f >= 5 && x.f <= 20 && x.c >= 3).length);
  S.settings.kyOnly = true;
  assert.equal(b.T.inScopeCount(), W.filter(x => x.f >= 5 && x.f <= 20 && x.c >= 3 && x.ky === 1).length);
});

await test("范围内 0 词时队列为空且统计不为负", () => {
  const b = browser(); fullScope(b);
  const S = b.T.getS();
  S.settings.fmin = 9999;
  S.progress[0] = [1, b.now - 1000, 1, 0, b.now];
  b.T.startSession(); b.T.show("stats");
  assert.equal(b.T.inScopeCount(), 0);
  assert.equal(b.T.Q.length, 0);
  assert.equal(b.T.cur, null);
  assert.equal(b.T.countDue(), 0);
  assert.doesNotMatch(b.query("#kpis").innerHTML, /<b>-\d|NaN/);
});

await test("连续 startSession 重置计数但保留今日新词配额", () => {
  const b = browser(), S = fullScope(b, 2);
  b.T.judge(true); b.T.tryNext(true); b.T.judge(true); b.T.tryNext(true);
  assert.equal(b.T.answered, 2);
  b.T.startSession();
  assert.equal(b.T.answered, 0);
  assert.equal(b.T.qi, 0);
  assert.equal(S.days[today(b.now)].n, 2);
  const q = b.T.buildQueue(b.now);
  assert.equal(q.fresh.length, 0);
});

await test("配额用尽后到期词仍入队，未到期词不入队", () => {
  const b = browser(), S = fullScope(b, 1);
  const W = b.T.getW();
  b.T.judge(true); b.T.tryNext(true);
  const dueIdx = W.findIndex((_, i) => i !== b.T.Q[0]);
  S.progress[dueIdx] = [1, b.now - 1000, 1, 0, b.now - 5000];
  const futureIdx = dueIdx + 1;
  S.progress[futureIdx] = [3, b.now + 86400000, 3, 0, b.now];
  b.T.startSession();
  assert.equal(b.T.Q.includes(dueIdx), true);
  assert.equal(b.T.Q.includes(futureIdx), false);
  assert.equal(b.T.countDue(), 1);
});

await test("shuffle 队列在同一会话内可复现", () => {
  const b = browser(); fullScope(b, 30);
  b.T.getS().settings.order = "shuffle";
  b.T.startSession();
  const a = JSON.stringify(b.T.buildQueue(b.now));
  const c = JSON.stringify(b.T.buildQueue(b.now));
  assert.equal(a, c);
  assert.ok(JSON.parse(a).fresh.length > 1);
});

await test("错词重考最多两轮，不会无限入队", () => {
  const b = browser(); fullScope(b, 1);
  const only = b.T.cur;
  b.T.judge(false); b.T.tryNext(true);
  assert.equal(b.T.Q.length, 2);
  assert.equal(b.T.Q[1], only);
  b.T.judge(false); b.T.tryNext(true);
  assert.equal(b.T.Q.length, 3);
  b.T.judge(false); b.T.tryNext(true);
  assert.equal(b.T.Q.length, 3);
  assert.equal(b.T.cur, null);
});

await test("备份导入导出 roundtrip 保真进度、收藏、设置", () => {
  const b = browser(); fullScope(b, 7);
  const S = b.T.getS(), i = b.T.cur, j = b.T.Q[1];
  b.T.judge(true); b.T.tryNext(true); b.T.judge(false);
  S.stars[j] = 1;
  S.settings.pos = ["n"]; S.settings.kyOnly = true; S.settings.order = "wrong";
  const backup = clone(S);
  const other = browser();
  other.T.importState(backup);
  const S2 = other.T.getS();
  assert.equal(JSON.stringify(S2.progress), JSON.stringify(backup.progress));
  assert.equal(JSON.stringify(S2.days), JSON.stringify(backup.days));
  assert.equal(S2.stars[j], 1);
  assert.equal(S2.settings.dailyNew, 7);
  assert.equal(S2.settings.pos.join(), "n");
  assert.equal(S2.settings.kyOnly, true);
  assert.equal(S2.settings.order, "wrong");
  assert.equal(JSON.stringify(S2.settings.keys), JSON.stringify(backup.settings.keys));
});

await test("字段缺省的备份可导入并落到安全默认值", () => {
  const b = browser(); fullScope(b);
  const out = b.T.importState({
    progress: { 0: [1, b.now + 1000, 1, 0, b.now] },
    days: { [today(b.now - 86400000)]: { n: 1, r: 1, ok: 1, no: 0 } }
  });
  assert.equal(out.settings.dailyNew, 30);
  assert.equal(out.timeSec, 0);
  assert.deepEqual(Object.keys(out.stars), []);
  assert.deepEqual(Object.keys(out.proficient), []);
  assert.ok(out.progress[0]);
});

await test("导入时数值类型安全强转，脏类型拒绝", () => {
  const b = browser(); fullScope(b);
  assert.equal(b.T.normalizeState({ settings: { dailyNew: "30" }, progress: {}, days: {} }).settings.dailyNew, 30);
  assert.equal(b.T.normalizeState({ settings: { dailyNew: 7.9 }, progress: {}, days: {} }).settings.dailyNew, 7);
  assert.equal(b.T.normalizeState({ settings: { fmin: 5, fmax: 2 }, progress: {}, days: {} }).settings.fmax, 5);
  assert.equal(b.T.normalizeState({ settings: { pos: ["n", "n", "bogus"] }, progress: {}, days: {} }).settings.pos.join(), "n");
  assert.equal(b.T.normalizeState({ stars: { 0: 0, 1: 9 }, progress: {}, days: {} }).stars[1], 1);
  assert.equal(b.T.normalizeState({ stars: { 0: 0, 1: 9 }, progress: {}, days: {} }).stars[0], undefined);
  assert.throws(() => b.T.normalizeState({ progress: { 0: ["1", 0, 1, 0, 0] }, days: {} }));
  assert.throws(() => b.T.normalizeState({ progress: { 0: [1, 0, 1, 0] }, days: {} }));
  assert.throws(() => b.T.normalizeState({ progress: { "01": [1, 0, 1, 0, 0] }, days: {} }));
});

await test("normalizeState 对合法数据幂等", () => {
  const b = browser(); fullScope(b);
  const raw = {
    settings: { dailyNew: 20, fmin: 3, fmax: 2, pmin: 1.5, pos: ["n", "x", "zz"], order: "wrong", keys: { know: "F", dont: "j", next: " ", speak: "s", star: "b", proficient: "m" } },
    progress: { 0: [2, b.now + 100, 3, 1, b.now], 5: [11, 0, 11, 0, 0] },
    days: { "2026-10-01": { n: 1, r: 3, ok: 2, no: 1 } },
    stars: { 3: 1 },
    proficient: { people: b.now },
    timeSec: 3.9
  };
  const n1 = clone(b.T.normalizeState(raw));
  const n2 = clone(b.T.normalizeState(n1));
  assert.deepEqual(n2, n1);
  assert.equal(n1.settings.keys.know, "f");
  assert.equal(n1.timeSec, 3);
});

await test("快捷键大小写等价，空格与 Enter 可翻页但 recall 门控", () => {
  for (const key of ["f", "F"]) {
    const b = browser(); fullScope(b);
    b.key({ key });
    assert.equal(b.T.verdict, true, `${key} 应判定会`);
    b.T.undo();
    b.key({ key: "j" });
    assert.equal(b.T.verdict, false);
    b.key({ key: "Enter" });
    assert.equal(b.T.qi, 1);
  }
  const b = browser(); fullScope(b);
  const i = b.T.cur;
  b.key({ key: " " });
  assert.equal(b.T.cur, i);
  assert.equal(b.T.qi, 0);
  b.key({ key: "j" });
  b.key({ key: " ", code: "Space" });
  assert.equal(b.T.qi, 1);
});

await test("改绑数字键生效，非法键与冲突键被拒绝，Esc 取消", () => {
  const b = browser(); fullScope(b);
  b.keyButtons.find(x => x.dataset.k === "know").click();
  b.key({ key: "1" });
  assert.equal(b.T.getS().settings.keys.know, "1");
  b.key({ key: "1" });
  assert.equal(b.T.verdict, true);
  b.keyButtons.find(x => x.dataset.k === "dont").click();
  for (const bad of ["Enter", "F5", "é", "Aa"]) {
    b.key({ key: bad });
    assert.equal(b.T.getS().settings.keys.dont, "j", `${bad} 不应被接受`);
  }
  b.keyButtons.find(x => x.dataset.k === "speak").click();
  b.key({ key: "1" });
  assert.equal(b.T.getS().settings.keys.speak, "s", "与 know=1 冲突应拒绝");
  b.keyButtons.find(x => x.dataset.k === "star").click();
  b.key({ key: "Escape" });
  b.key({ key: "z" });
  assert.equal(b.T.getS().settings.keys.star, "b", "Esc 取消改绑后按键不再被改写");
});

await test("空格可改绑到其他动作且不与 next 冲突", () => {
  const b = browser(); fullScope(b);
  b.keyButtons.find(x => x.dataset.k === "next").click();
  b.key({ key: "z" });
  assert.equal(b.T.getS().settings.keys.next, "z");
  b.keyButtons.find(x => x.dataset.k === "dont").click();
  b.key({ key: " " });
  assert.equal(b.T.getS().settings.keys.dont, " ");
  b.key({ key: " " });
  assert.equal(b.T.verdict, false);
});

await test("星标快捷键可切换且与熟练互不干扰", () => {
  const b = browser(); requireProficient(b); fullScope(b);
  const i = b.T.cur, word = b.T.getW()[i].w;
  b.key({ key: "b" });
  assert.equal(b.T.getS().stars[i], 1);
  assert.equal(b.T.Q.includes(i), true);
  assert.equal(b.T.isProficient(i), false);
  b.key({ key: "m" });
  assert.equal(b.T.isProficient(i), true);
  assert.equal(b.T.getS().stars[i], 1);
  assert.equal(b.T.Q.includes(i), false);
  b.T.setProficient(i, false);
  assert.equal(b.T.getS().stars[i], 1);
  b.T.setCur(i); b.T.setVerdict(null);
  b.query("#fst").value = "star"; b.query("#fsc").value = "all"; b.query("#q").value = word;
  b.T.applyFilter();
  assert.match(b.query("#listInner").innerHTML, new RegExp(`data-i="${i}"`));
  b.key({ key: "b" });
  assert.equal(b.T.getS().stars[i], undefined);
});

await test("空库与全掌握 KPI 不出现 NaN 或负数", () => {
  const b = browser(); fullScope(b, 100);
  const S = b.T.getS(), W = b.T.getW();
  b.T.show("stats");
  assert.doesNotMatch(b.query("#kpis").innerHTML, /NaN|<b>-\d/);
  assert.match(b.query("#kpis").innerHTML, /<b>—<\/b><span>累计正确率/);
  for (let i = 0; i < W.length; i++) S.progress[i] = [11, b.now + 86400000, 11, 0, b.now];
  S.timeSec = 3661;
  b.T.show("stats");
  const kpi = b.query("#kpis").innerHTML;
  assert.ok(kpi.includes(`<b>${W.length}</b><span>已掌握`));
  assert.match(kpi, /<b>0<\/b><span>未学/);
  assert.match(kpi, /<b>0<\/b><span>学习中/);
  assert.match(kpi, /1 小时 1 分/);
  assert.doesNotMatch(kpi, /NaN|<b>-\d/);
});

await test("部分熟练时 KPI 分项自洽且不为负", () => {
  const b = browser(); requireProficient(b); fullScope(b);
  const S = b.T.getS(), W = b.T.getW();
  S.proficient[W[0].w] = b.now;
  S.proficient[W[1].w] = b.now;
  S.stars = { 0: 1, 1: 1, 2: 1 };
  S.progress[3] = [2, b.now - 1, 2, 4, b.now];
  S.days[today(b.now)] = { n: 1, r: 3, ok: 1, no: 2 };
  b.T.show("stats");
  const kpi = b.query("#kpis").innerHTML;
  assert.match(kpi, /<b>2<\/b><span>熟练（全词库）/);
  assert.match(kpi, /<b>3<\/b><span>收藏/);
  assert.match(kpi, /<b>1<\/b><span>错词/);
  assert.match(kpi, /<b>1<\/b><span>学习中/);
  assert.doesNotMatch(kpi, /NaN|<b>-\d/);
  const unlearned = Number((kpi.match(/<b>(\d+)<\/b><span>未学/) || [])[1]);
  assert.ok(Number.isFinite(unlearned) && unlearned >= 0);
});

await test("到期筛选排除熟练/掌握/未来词，按到期时间排序且保留学习队列", () => {
  const b = browser(), S = fullScope(b), W = b.T.getW();
  S.progress[0] = [1, b.now - 100, 1, 0, b.now];
  S.progress[1] = [0, b.now - 1000, 0, 1, b.now];
  S.progress[2] = [1, b.now + 1, 1, 0, b.now];
  S.progress[3] = [11, b.now - 1, 11, 0, b.now];
  S.progress[4] = [2, b.now - 1, 2, 0, b.now];
  S.proficient[W[4].w] = b.now;
  const queue = JSON.stringify(b.T.Q), cur = b.T.cur;
  b.T.show("stats");
  b.query("#btnDueList").click();
  assert.equal(b.query("#fst").value, "due");
  assert.match(b.query("#listCount").textContent, /共 2 词/);
  const html = b.query("#listInner").innerHTML;
  assert.ok(html.indexOf('data-i="1"') < html.indexOf('data-i="0"'));
  for (const i of [2, 3, 4]) assert.ok(!html.includes(`data-i="${i}"`));
  assert.equal(JSON.stringify(b.T.Q), queue);
  assert.equal(b.T.cur, cur);
});

await test("复习安排统计严格遵循范围和到期边界，计数与队列一致", () => {
  const b = browser(), S = fullScope(b), W = b.T.getW();
  S.progress[0] = [0, b.now, 0, 1, b.now];
  S.progress[1] = [1, b.now + 86400000, 1, 0, b.now];
  S.progress[2] = [2, b.now + 86400001, 2, 0, b.now];
  S.progress[3] = [11, b.now - 1, 11, 0, b.now];
  S.progress[4] = [1, b.now - 1, 1, 0, b.now];
  S.proficient[W[4].w] = b.now;
  assert.deepEqual(clone(b.T.reviewPlan()), {due: 1, upcoming: 1, next: b.now + 86400000});
  assert.equal(b.T.reviewPlan().due, b.T.countDue());
  S.settings.fmin = 9999;
  assert.deepEqual(clone(b.T.reviewPlan()), {due: 0, upcoming: 0, next: null});
});

await test("详情区分未学、到期、未来、已掌握与熟练复习状态", () => {
  const b = browser(), S = fullScope(b), i = b.T.cur;
  assert.match(b.T.wordReviewLabel(i), /尚未学习/);
  b.T.judge(false);
  assert.match(b.T.wordReviewLabel(i), /2026-10-10 12:05/);
  b.T.openWord(i);
  assert.match(b.query("#wordDetail").innerHTML, /下次复习/);
  b.advance(300000);
  assert.match(b.T.wordReviewLabel(i), /已到期/);
  S.progress[i][0] = 11;
  assert.match(b.T.wordReviewLabel(i), /已掌握/);
  S.proficient[b.T.getW()[i].w] = b.now;
  assert.match(b.T.wordReviewLabel(i), /熟练/);
});

await test("到期词列表随轮询刷新，不重置滚动或学习队列", () => {
  const b = browser(), S = fullScope(b);
  S.progress[0] = [1, b.now + 1000, 1, 0, b.now];
  b.query("#fst").value = "due";
  b.T.show("list");
  assert.match(b.query("#listCount").textContent, /共 0 词/);
  const queue = JSON.stringify(b.T.Q);
  b.advance(1000);
  b.intervals.find(x => x.ms === 30000).fn();
  assert.match(b.query("#listCount").textContent, /共 1 词/);
  assert.equal(JSON.stringify(b.T.Q), queue);
});

await test("全部判不会的已学词不会显示尚未开始学习", () => {
  const b = browser(); fullScope(b);
  b.T.judge(false); b.T.show("stats");
  assert.equal(b.query("#stagesHint").textContent, "");
});

await test("打开帮助会取消改键，不会在浮层中意外改写快捷键", () => {
  const b = browser(); fullScope(b);
  b.T.show("set");
  b.keyButtons.find(x => x.dataset.k === "know").click();
  b.query("#btnHelp").click();
  b.key({key: "x"});
  assert.equal(b.T.getS().settings.keys.know, "f");
  assert.equal(b.query("#helpSheet").hidden, false);
  b.key({key: "Escape"});
  assert.equal(b.query("#helpSheet").hidden, true);
});

await test("换卡和关闭详情会关闭过期的例句查词浮层", () => {
  const b = browser(); fullScope(b);
  b.T.showExPop("people");
  assert.equal(b.query("#exPop").hidden, false);
  b.T.judge(true);
  assert.equal(b.query("#exPop").hidden, true);
  b.T.openWord(b.T.cur);
  b.T.showExPop("people");
  b.T.closeSheet();
  assert.equal(b.query("#exPop").hidden, true);
});

console.log(`\n回归结果：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
