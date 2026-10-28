/**
 * 大版本学习呈现模型、统一动作与加量并学习（回归）
 * 受控时钟、DOM桩、四词书 + vm 沙箱执行真实 js/app.js，不复制业务逻辑。
 * 运行：node --max-old-space-size=512 js/test-study-actions.mjs
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

const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 浏览器桩：受控 Date/performance、可捕获 setInterval、可切换可见性与写失败。 */
function browser({ initial = null, sharedStorage = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const T0 = now;
  let failWrites = false;
  const writeLog = [];
  const registry = new Map();
  const documentEvents = new Map(); // type → [{fn, capture}]
  const windowEvents = new Map();
  const intervals = [];
  const timeouts = new Map();
  let timeoutId = 0;
  const storage = sharedStorage || new Map(initial === null ? [] : [[KEY, typeof initial === "string" ? initial : JSON.stringify(initial)]]);

  function element(tag = "div") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(), id: "", style: {}, dataset: {}, value: "",
      checked: false, disabled: false, hidden: false, files: [], scrollTop: 0,
      clientHeight: 600, textContent: "", onclick: null, onchange: null, oninput: null,
      offsetWidth: 100, offsetHeight: 40, children: [], parentNode: null,
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn, options) {
        if (!events.has(type)) events.set(type, []);
        const capture = typeof options === "boolean" ? options : !!(options && options.capture);
        events.get(type).push({ fn, capture });
      },
      removeEventListener() {},
      fire(type, data = {}) {
        const event = Object.assign({type, target: el, preventDefault() {}, stopPropagation() {}}, data);
        for (const item of events.get(type) || []) item.fn(event);
      },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      click() { if (el.onclick) el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); },
      focus() { if (document) document.activeElement = el; },
      blur() { if (document && document.activeElement === el) document.activeElement = null; },
      closest() { return null; },
      contains(node) { return node === el; },
      getAttribute() { return null; },
      setAttribute() {}, removeAttribute() {},
      querySelector() { return element("div"); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html || ""; },
      set(v) { el._html = String(v); }
    });
    return el;
  }
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (!registry.has(selector)) registry.set(selector, element(selector.startsWith("input#") || /^#(dailyNew|pmin|fmin|fmax)$/.test(selector) ? "input" : "div"));
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
    if (selector === "#helpSheet [data-close]" || selector === "#helpSheet button") return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  for (const id of ["helpSheet", "appAlert", "exPop", "wordSheet", "guideSheet", "bookSheet"]) query("#" + id).hidden = true;

  const document = {
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
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    innerWidth: 1200, innerHeight: 800
  };
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem(k, v) {
      if (failWrites) throw new Error("QuotaExceededError: storage disabled");
      writeLog.push(k);
      storage.set(k, String(v));
    },
    removeItem: k => storage.delete(k)
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console, localStorage,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    setTimeout(fn, delay = 0) { const id = ++timeoutId; timeouts.set(id, {fn, at: now + delay}); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class {}, SpeechSynthesisUtterance: class {},
    speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now - T0 }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  for (const file of ["cet-words-data.js", "combined-words-data.js"]) vm.runInContext(fs.readFileSync(path.join(HERE, file), "utf8"), context, {filename: file});
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试入口");
  const study = window.__vocabStudy;
  assert.ok(study, "app.js 应提供 window.__vocabStudy 只读计时钩子");

  const fireDocument = (type, ev = {}) => {
    const event = Object.assign({ type, target: document.body, preventDefault() {}, stopPropagation() {} }, ev);
    for (const rec of documentEvents.get(type) || []) if (rec.capture) rec.fn(event);
    for (const rec of documentEvents.get(type) || []) if (!rec.capture) rec.fn(event);
    return event;
  };
  return {
    T, study, window, document, context, storage, intervals, writeLog, query, views,
    get now() { return now; },
    advance(ms) { now += ms; },
    elapse(ms) {
      const end = now + ms;
      let count = 0;
      while (count++ < 500) {
        const item = [...timeouts].filter(([,timer]) => timer.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!item) break;
        now = item[1].at; timeouts.delete(item[0]); item[1].fn();
      }
      now = end;
    },
    tick() { study.tick(); },
    act() { study.act(); },
    flush() { return study.flush(); },
    debug() { return study.getDebug(); },
    timer() {
      const ms = study.getDebug().tickMs;
      const timer = intervals.find(t => t.ms === ms);
      assert.ok(timer, `应注册 ${ms}ms 学习时长采样定时器`);
      return timer.fn;
    },
    fireDocument,
    setHidden() {
      document.visibilityState = "hidden";
      fireDocument("visibilitychange");
    },
    setVisible() {
      document.visibilityState = "visible";
      fireDocument("visibilitychange");
    },
    key(data) {
      return fireDocument("keydown", {
        key: "", code: "", ctrlKey: false, metaKey: false, altKey: false,
        shiftKey: false, repeat: false, isComposing: false, ...data
      });
    },
    documentClick() { return fireDocument("click"); },
    storageEvent() {
      const e = { key: KEY, newValue: storage.has(KEY) ? storage.get(KEY) : null };
      for (const fn of windowEvents.get("storage") || []) fn(e);
    },
    pageShow() { for (const fn of windowEvents.get("pageshow") || []) fn({ type: "pageshow" }); },
    windowFocus() { for (const fn of windowEvents.get("focus") || []) fn({ type: "focus" }); },
    setFailWrites(value) { failWrites = !!value; },
    timeSec() { return T.getS().timeSec || 0; },
    rawState() { return storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null; }
  };
}

function setup(b, {dailyNew = 2, groupSize = 2, cap = 0, used = 0, dayN = 0, extra = 0, due = 0} = {}) {
  const T = b.T, s = T.getS(), d = today(b.now);
  s.progress = {}; s.days = {[d]: {n: dayN, r: dayN, ok: dayN, no: 0}};
  s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {dailyNew, groupSize, fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: 'primary', order: 'freq', backlogGuard: false, autoSpk: false});
  s.reviewDay = {d, used}; s.extraDay = {d, extra};
  for (let i = 0; i < due; i++) s.progress[i] = [1, b.now - 5000, 1, 0, b.now - 86400000];
  T.setReviewCap(cap); T.startSession(); T.show('study'); return T;
}
function finish(T) { let i = 0; while (T.cur != null && i++ < 120) { T.judge(true); T.tryNext(); } assert.ok(T.cur == null); }
const group = T => JSON.stringify({Q: T.Q, qi: T.qi, cur: T.cur, phase: T.phase, verdict: T.verdict, answered: T.answered, plan: T.getPlan()});
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS  ' + name); } catch (error) { failed++; console.log('FAIL  ' + name + ': ' + error.message); } }

test('模型/命令/加量接口存在，模型严格只读且返回独立数据', () => {
  const b = browser(), T = setup(b);
  for (const name of ['deriveStudyPresentation', 'runStudyAction', 'addExtraAndStudy']) assert.equal(typeof T[name], 'function', name);
  T.getS().days = {}; T.getS().reviewDay = {d: '2025-01-01', used: 8}; T.getS().extraDay = {d: '2025-01-01', extra: 10};
  const before = JSON.stringify(T.getS()), disk = JSON.stringify([...b.storage]), scene = group(T), writes = b.writeLog.length;
  const a = T.deriveStudyPresentation(); assert.equal(a.state, 'recall'); assert.equal(a.mode, 'main');
  a.actions.length = 0; T.deriveStudyPresentation();
  assert.equal(JSON.stringify(T.getS()), before); assert.equal(JSON.stringify([...b.storage]), disk);
  assert.equal(group(T), scene); assert.equal(b.writeLog.length, writes); assert.ok(T.deriveStudyPresentation().actions.length > 0);
});
test('回忆/揭示/完成准确派生，统一判定与继续不重复消费', () => {
  const b = browser(), T = setup(b, {dailyNew: 4});
  assert.equal(T.runStudyAction('next').ok, false); assert.equal(T.answered, 0);
  assert.equal(T.runStudyAction('know').ok, true); assert.equal(T.deriveStudyPresentation().state, 'revealed');
  const day = JSON.stringify(T.getS().days); T.runStudyAction('know'); assert.equal(JSON.stringify(T.getS().days), day);
  T.runStudyAction('next'); T.runStudyAction('know'); T.runStudyAction('next');
  assert.equal(T.deriveStudyPresentation().state, 'done'); assert.equal(T.deriveStudyPresentation().primaryAction, 'continue');
  assert.equal(T.runStudyAction('continue').started, true); assert.equal(T.answered, 0);
});
test('普通空页不自动取得资格；显式等待/退出/启用并等待各自明确', () => {
  const b = browser(), T = setup(b, {dayN: 2});
  assert.equal(T.deriveStudyPresentation().state, 'empty'); assert.equal(T.getAutoResumeState().waitingForDue, false);
  assert.equal(T.runStudyAction('wait').ok, true); assert.equal(T.deriveStudyPresentation().state, 'wait');
  assert.equal(T.runStudyAction('stopWait').ok, true); assert.equal(T.deriveStudyPresentation().state, 'empty');
  T.applyAutoResumePreset('off'); assert.equal(T.runStudyAction('wait').ok, false);
  assert.equal(T.runStudyAction('enableWait').ok, true); assert.equal(T.deriveStudyPresentation().state, 'wait');
});
test('浮层/查词/后台/其他页面/输入法/按住键均不能穿透学习动作', () => {
  const b = browser(), T = setup(b); const before = group(T), state = JSON.stringify(T.getS());
  T.openGuide(); assert.equal(T.runStudyAction('know').ok, false); T.closeSheet();
  b.query('#exPop').hidden = false; assert.equal(T.runStudyAction('know').ok, false); b.query('#exPop').hidden = true;
  b.document.visibilityState = 'hidden'; assert.equal(T.runStudyAction('know').ok, false); b.document.visibilityState = 'visible';
  T.show('set'); assert.equal(T.runStudyAction('know').ok, false); T.show('study');
  for (const event of [{repeat: true}, {isComposing: true}, {target: {tagName: 'INPUT'}}]) assert.equal(T.runStudyAction('know', {event}).ok, false);
  assert.equal(group(T), before); assert.equal(JSON.stringify(T.getS()), state);
  assert.equal(T.runStudyAction('unknown').error, 'unknown-action');
});
test('完成页一次加量并开主组，只授予不判定、不提高原计划或复习上限', () => {
  const b = browser(), T = setup(b, {cap: 20}); finish(T);
  const progress = JSON.stringify(T.getS().progress), days = JSON.stringify(T.getS().days);
  const result = T.addExtraAndStudy(10);
  assert.equal(result.ok, true); assert.equal(result.started, true); assert.equal(result.granted, 10); assert.equal(result.mode, 'main');
  assert.equal(T.getExtraDay().extra, 10); assert.equal(T.getS().settings.dailyNew, 2); assert.equal(T.getReviewCap(), 20);
  assert.equal(JSON.stringify(T.getS().progress), progress); assert.equal(JSON.stringify(T.getS().days), days); assert.equal(T.answered, 0);
  assert.equal(T.addExtraAndStudy(10).ok, false); assert.equal(T.getExtraDay().extra, 10);
});
test('原grant仍只授予；加量并学习复用尚未学的加量，不再重复增加', () => {
  const b = browser(), T = setup(b); finish(T);
  assert.equal(T.grantExtraNew(10).ok, true); assert.equal(T.cur, null);
  const result = T.runStudyAction('addExtraAndStudy', {amount: 10});
  assert.equal(result.ok, true); assert.equal(result.reused, true); assert.equal(result.granted, 0); assert.equal(T.getExtraDay().extra, 10);
});
test('保存失败保留已授予结果且不开组；恢复后重试不会追加', () => {
  const b = browser(), T = setup(b); finish(T); const before = group(T);
  b.setFailWrites(true); const first = T.addExtraAndStudy(10);
  assert.equal(first.ok, false); assert.equal(first.started, false); assert.equal(first.granted, 10); assert.equal(first.error, 'storage');
  assert.equal(T.getExtraDay().extra, 10); assert.equal(group(T), before);
  b.setFailWrites(false); b.query('#appAlert').hidden = true;
  const retry = T.addExtraAndStudy(10); assert.equal(retry.ok, true); assert.equal(retry.reused, true); assert.equal(retry.granted, 0);
  assert.equal(T.getExtraDay().extra, 10); assert.equal(b.rawState().extraDay.extra, 10);
});
test('跨标签已授予但通知延迟时，先读最新额度再复用', () => {
  const b = browser(), T = setup(b); finish(T);
  const incoming = b.rawState(); incoming.extraDay.extra = 10; b.storage.set(KEY, JSON.stringify(incoming));
  const result = T.addExtraAndStudy(10); assert.equal(result.ok, true); assert.equal(result.reused, true);
  assert.equal(result.granted, 0); assert.equal(T.getExtraDay().extra, 10);
});
test('额度暂停加量进入原extra子组；统一返回恢复父卡/预算/未答现场', () => {
  const b = browser(), T = setup(b, {due: 2, cap: 1, used: 1}); const parent = group(T);
  assert.equal(T.deriveStudyPresentation().state, 'cap');
  const result = T.addExtraAndStudy(10); assert.equal(result.ok, true); assert.equal(result.mode, 'extra');
  assert.equal(T.deriveStudyPresentation().state, 'subgroup'); assert.equal(T.isExtraSubgroup(), true); assert.equal(T.getReviewCap(), 1);
  assert.equal(T.runStudyAction('return').ok, true); assert.equal(group(T), parent); assert.equal(T.deriveStudyPresentation().state, 'cap');
  assert.equal(T.getReviewLedger().used, 1); assert.equal(T.getExtraDay().extra, 10);
});
test('父组外没有新词候选时不授予，不用父组未答新词空开子组', () => {
  const b = browser(), T = setup(b, {due: 1, groupSize: 2, cap: 1, used: 1});
  const unlearned = new Set(T.Q.filter(i => !T.hasMainProgress(T.getS().progress[i])));
  for (let i = 0; i < T.getW().length; i++) if (!unlearned.has(i) && !T.getS().progress[i]) T.getS().progress[i] = [1, b.now + 86400000, 1, 0, b.now];
  T.setReviewCap(1); const before = group(T); const result = T.addExtraAndStudy(10);
  assert.equal(result.ok, false); assert.equal(result.error, 'no-candidates'); assert.equal(T.getExtraDay().extra, 0); assert.equal(group(T), before);
});
test('特训不会被continue/加量抢占，统一返回只退出特训', () => {
  const b = browser(), T = setup(b); T.judge(false); T.tryNext(); assert.equal(T.startDrill(), true);
  assert.equal(T.deriveStudyPresentation().state, 'drill'); const before = group(T);
  assert.equal(T.runStudyAction('continue').ok, false); assert.equal(T.addExtraAndStudy(10).ok, false); assert.equal(group(T), before);
  assert.equal(T.runStudyAction('return').ok, true); assert.equal(T.drillMode, false);
});
test('保存失败仍可用统一返回退出特训，保留父组与未落盘特训结果', () => {
  const b=browser(),T=setup(b);T.judge(false);T.tryNext();const parent=group(T);
  assert.equal(T.startDrill(),true);b.setFailWrites(true);T.judge(true);
  const progress=JSON.stringify(T.getS().progress);
  assert.equal(T.deriveStudyPresentation().actions.find(x=>x.id==='return').enabled,true);
  assert.equal(T.runStudyAction('return').ok,true,'与可直接退出的按钮一致，不能额外用保存成功作返回前提');
  assert.equal(T.drillMode,false);assert.equal(group(T),parent);
  assert.equal(JSON.stringify(T.getS().progress),progress,'未落盘结果仍在本页');
  assert.equal(b.query('#appAlert').hidden,false,'返回不清除持续保存错误');
});
test('无效数量/坏主记录均不半开组或授予', () => {
  const b = browser(), T = setup(b); finish(T); const before = group(T);
  for (const n of [0, 101, 1.5, '10']) { assert.equal(T.addExtraAndStudy(n).ok, false); assert.equal(T.getExtraDay().extra, 0); }
  b.storage.set(KEY, '{broken'); const result = T.addExtraAndStudy(10);
  assert.equal(result.ok, false); assert.equal(result.error, 'storage'); assert.equal(group(T), before); assert.equal(T.getExtraDay().extra, 0);
});
test('四书隔离与模型跨日读取不写回旧台账', () => {
  const b = browser(), T = setup(b); finish(T); T.addExtraAndStudy(10);
  const old = JSON.stringify(T.getBookState('kaoyan').extraDay);
  T.switchBook('cet4'); assert.equal(T.getExtraDay().extra, 0); T.deriveStudyPresentation();
  assert.equal(JSON.stringify(T.getBookState('kaoyan').extraDay), old);
  b.advance(86400000); const before = JSON.stringify(T.getS()); T.deriveStudyPresentation(); assert.equal(JSON.stringify(T.getS()), before);
});
test('自动开组前的结果可统一返回，首个有效判定后该资格消失', () => {
  const b = browser(), T = setup(b, {dailyNew: 4}); T.applyAutoResumePreset('quick'); finish(T);
  const before = group(T), days = JSON.stringify(T.getS().days);
  assert.equal(T.startAutoResumeNow(), true); assert.equal(T.deriveStudyPresentation().returnAction, 'return');
  assert.equal(T.runStudyAction('return').ok, true); assert.equal(group(T), before); assert.equal(JSON.stringify(T.getS().days), days);
  assert.equal(T.startAutoResumeNow(), true); T.runStudyAction('know');
  assert.equal(T.deriveStudyPresentation().returnAction, null); assert.equal(T.runStudyAction('return').ok, false);
});
test('暂停父组在外部真实进度变化后失效，旧加量命令不再授予', () => {
  const b = browser(), T = setup(b, {due: 1, cap: 1, used: 1}); const oldWord = T.cur;
  const incoming = b.rawState(); incoming.progress[oldWord][1] = b.now + 86400000;
  b.storage.set(KEY, JSON.stringify(incoming));
  const result = T.addExtraAndStudy(10);
  assert.equal(result.ok, false); assert.equal(result.error, 'context'); assert.equal(T.getExtraDay().extra, 0);
  assert.equal(T.getS().progress[oldWord][1], incoming.progress[oldWord][1]); assert.equal(T.isExtraSubgroup(), false);
});
test('持续错误提示守卫及今天暂停不会被普通等待暗中解除', () => {
  const b = browser(), T = setup(b, {dayN: 2});
  T.pauseAutoResumeToday(); const raw = b.storage.get(T.autoResumePauseKey);
  assert.equal(T.deriveStudyPresentation().primaryAction, 'restoreAuto');
  assert.equal(T.runStudyAction('wait').ok, false); assert.equal(T.runStudyAction('enableWait').ok, false);
  assert.equal(b.storage.get(T.autoResumePauseKey), raw); assert.equal(T.getAutoResumeState().waitingForDue, false);
  assert.equal(T.runStudyAction('restoreAuto').ok, true); assert.equal(T.getAutoResumeState().waitingForDue, false);
  b.query('#appAlert').hidden = false; assert.equal(T.runStudyAction('wait').ok, false);
  b.query('#appAlert').hidden = true; assert.equal(T.runStudyAction('wait').ok, true);
});
test('纯推导：未完成日计划的组尾不可加量，已有可复用额度或预算暂停例外', () => {
  const b = browser(), T = setup(b, {dailyNew: 4, groupSize: 2}); finish(T);
  const read = () => {
    const state = JSON.stringify(T.getS()), disk = JSON.stringify([...b.storage]), scene = group(T), writes = b.writeLog.length;
    const model = T.deriveStudyPresentation();
    assert.equal(JSON.stringify(T.getS()), state); assert.equal(JSON.stringify([...b.storage]), disk);
    assert.equal(group(T), scene); assert.equal(b.writeLog.length, writes); return model;
  };
  const enabled = model => model.actions.find(action => action.id === 'addExtraAndStudy').enabled;
  assert.equal(T.getS().days[today(b.now)].n, 2); assert.equal(read().state, 'done');
  assert.equal(enabled(read()), false, '日计划4但仅学2：组尾不应承诺可加量');
  T.getS().extraDay.extra = 10;
  assert.equal(enabled(read()), true, '可复用已授予额度时不要求先完成原日计划');
  T.getS().extraDay.extra = 0; T.getS().days[today(b.now)].n = 4;
  assert.equal(enabled(read()), true, '日计划完成可授予新加量');
  setup(b, {dailyNew: 4, due: 1, cap: 1, used: 1});
  assert.equal(read().state, 'cap'); assert.equal(enabled(read()), true, '预算暂停仍是独立入口');
});
test('纯推导：主动作始终enabled，关闭且今日暂停或全局阻断时为null', () => {
  const b = browser(), T = setup(b, {dayN: 2});
  T.getS().settings.autoResume.enabled = false;
  b.storage.set(T.autoResumePauseKey, JSON.stringify({kaoyan: today(b.now)}));
  const read = () => {
    const state = JSON.stringify(T.getS()), disk = JSON.stringify([...b.storage]), writes = b.writeLog.length;
    const model = T.deriveStudyPresentation();
    assert.equal(JSON.stringify(T.getS()), state); assert.equal(JSON.stringify([...b.storage]), disk); assert.equal(b.writeLog.length, writes);
    if (model.primaryAction !== null) assert.equal(model.actions.find(action => action.id === model.primaryAction)?.enabled, true);
    if (model.blockedBy) { assert.equal(model.primaryAction, null); assert.equal(model.actions.every(action => !action.enabled), true); }
    return model;
  };
  assert.equal(read().primaryAction, null); assert.equal(read().actions.find(action => action.id === 'enableWait').enabled, false);
  T.getS().settings.autoResume.enabled = true; assert.equal(read().primaryAction, 'restoreAuto');
  b.document.visibilityState = 'hidden'; assert.equal(read().primaryAction, null); b.document.visibilityState = 'visible';
  T.openGuide(); assert.equal(read().primaryAction, null); T.closeSheet();
  b.query('#exPop').hidden = false; assert.equal(read().primaryAction, null); b.query('#exPop').hidden = true;
  b.query('#appAlert').hidden = false;
  const blocked=read();
  assert.equal(blocked.actions.filter(a=>['continue','wait','enableWait','addExtraAndStudy'].includes(a.id)).every(a=>!a.enabled),true);
  b.query('#appAlert').hidden = true;
  T.show('set'); assert.equal(read().primaryAction, null); T.show('study');
  setup(b); T.judge(true); assert.equal(read().primaryAction, 'next');
  b.document.visibilityState = 'hidden'; assert.equal(read().primaryAction, null);
});
test('只读候选冷状态不建立日记录/台账，原候选入口使用同一shape和结果', () => {
  const b = browser(), T = setup(b);
  assert.equal(typeof T.readOnlyCandidateStats, 'function');
  T.getS().days = {}; T.getS().reviewDay = {d: '2025-01-01', used: 9}; T.getS().extraDay = {d: '2025-01-01', extra: 10};
  const before = JSON.stringify(T.getS()), disk = JSON.stringify([...b.storage]), writes = b.writeLog.length;
  const stats = T.readOnlyCandidateStats();
  assert.deepEqual(clone(stats), {available: 2, due: 0, dueActive: 0, fresh: 2, freshActive: 2,
    quota: 2, groupSize: 2, cap: 0, capLeft: null, backlogGuarded: false, capPaused: false});
  assert.equal(T.getCandidatesNow(), stats.available); assert.deepEqual(clone(T.deriveStudyPresentation().candidates), clone(stats));
  assert.equal(JSON.stringify(T.getS()), before); assert.equal(JSON.stringify([...b.storage]), disk); assert.equal(b.writeLog.length, writes);
});
test('只读候选保留到期优先/槽位/额度与积压口径，同代共享预算取大、异代不合回', () => {
  const b = browser(), T = setup(b, {dailyNew: 4, groupSize: 4, due: 3, cap: 3});
  T.getS().settings.backlogGuard = true;
  const incoming = b.rawState(); incoming.reviewDay.used = 2; b.storage.set(KEY, JSON.stringify(incoming));
  const before = JSON.stringify(T.getS());
  assert.deepEqual(clone(T.readOnlyCandidateStats()), {available: 1, due: 3, dueActive: 1, fresh: 0, freshActive: 0,
    quota: 4, groupSize: 4, cap: 3, capLeft: 1, backlogGuarded: true, capPaused: false});
  incoming.reviewDay.used = 3; b.storage.set(KEY, JSON.stringify(incoming));
  assert.equal(T.readOnlyCandidateStats().available, 0); assert.equal(T.readOnlyCandidateStats().capPaused, true);
  incoming._replace = 'independent-new-generation'; b.storage.set(KEY, JSON.stringify(incoming));
  assert.deepEqual(clone(T.readOnlyCandidateStats()), {available: 4, due: 3, dueActive: 3, fresh: 4, freshActive: 1,
    quota: 4, groupSize: 4, cap: 3, capLeft: 3, backlogGuarded: false, capPaused: false});
  assert.equal(JSON.stringify(T.getS()), before);
});
test('无入组候选时模型continue不可用且原因准确；无新词时也不承诺加量', () => {
  const b = browser(), T = setup(b, {dayN: 2});
  let model = T.deriveStudyPresentation();
  assert.equal(model.actions.find(action => action.id === 'continue').enabled, false); assert.equal(model.reason, 'new-quota');
  for (let i = 0; i < T.getW().length; i++) T.getS().progress[i] = [11, b.now + 86400000, 11, 0, b.now];
  T.getS().days[today(b.now)] = {n: 0, r: 0, ok: 0, no: 0}; T.setReviewCap(0); T.startSession();
  model = T.deriveStudyPresentation();
  assert.equal(model.reason, 'no-candidates'); assert.equal(model.actions.find(action => action.id === 'continue').enabled, false);
  assert.equal(model.actions.find(action => action.id === 'addExtraAndStudy').enabled, false); assert.notEqual(model.primaryAction, 'continue');
});
test('P09零范围优先于已满新词额度；只读模型与拒绝继续不空开组', () => {
  const b = browser(), T = setup(b, {dayN: 2});
  for (const word of T.getW()) T.getS().proficient[word.w] = b.now;
  const before = JSON.stringify(T.getS()), disk = JSON.stringify([...b.storage]), scene = group(T), writes = b.writeLog.length;
  const model = T.deriveStudyPresentation();
  assert.equal(model.candidates.available, 0); assert.equal(model.candidates.quota, 0);
  assert.equal(model.reason, 'no-candidates'); assert.equal(model.actions.find(a => a.id === 'continue').reason, 'no-candidates');
  assert.equal(model.actions.find(a => a.id === 'continue').enabled, false); assert.notEqual(model.primaryAction, 'continue');
  assert.equal(T.runStudyAction('continue').ok, false);
  assert.equal(JSON.stringify(T.getS()), before); assert.equal(JSON.stringify([...b.storage]), disk);
  assert.equal(group(T), scene); assert.equal(b.writeLog.length, writes); assert.equal(T.getAutoResumeState().waitingForDue, false);
});
test('P09完成页保存失败说明持续可见，继续禁用且不再呈现主按钮', () => {
  const b = browser(), T = setup(b, {dailyNew: 4, groupSize: 1}); finish(T);
  b.setFailWrites(true); T.setReviewCap(20);
  const before = JSON.stringify(T.getS()), scene = group(T), disk = JSON.stringify([...b.storage]);
  assert.equal(b.query('#appAlert').hidden, false);
  assert.equal(T.deriveStudyPresentation().actions.find(a => a.id === 'continue').reason, 'alert');
  assert.match(b.query('#doneNext').textContent, /尚未保存/);
  assert.equal(b.query('#again').disabled, true); assert.equal(b.query('#again').classList.contains('primary'), false);
  b.elapse(9000);
  assert.equal(b.query('#appAlert').hidden, false); assert.match(b.query('#doneNext').textContent, /尚未保存/);
  assert.equal(T.runStudyAction('continue').ok, false);
  assert.equal(JSON.stringify(T.getS()), before); assert.equal(group(T), scene); assert.equal(JSON.stringify([...b.storage]), disk);
});
test('P09主动结束额度暂停后提高上限，仍是暂停结果且可安全重新开组', () => {
  const b = browser(), T = setup(b, {due: 2, cap: 1, groupSize: 2});
  T.judge(true); T.tryNext(); assert.equal(T.isCapPaused(), true);
  b.query('#capPauseEnd').onclick(); assert.equal(T.cur, null);
  const scene = group(T), progress = JSON.stringify(T.getS().progress), days = JSON.stringify(T.getS().days), used = T.getReviewLedger().used;
  T.setReviewCap(2);
  assert.equal(T.deriveStudyPresentation().reason, 'cap-ended');
  assert.match(b.query('#card').innerHTML, /<h2>本组已暂停<\/h2>/); assert.doesNotMatch(b.query('#card').innerHTML, /<h2>本组完成<\/h2>/);
  assert.match(b.query('#doneNext').textContent, /额度已恢复/);
  assert.equal(b.query('#again').disabled, false); assert.equal(b.query('#again').classList.contains('primary'), true);
  assert.equal(group(T), scene); assert.equal(JSON.stringify(T.getS().progress), progress);
  assert.equal(JSON.stringify(T.getS().days), days); assert.equal(T.getReviewLedger().used, used);
  assert.equal(T.runStudyAction('continue').started, true); assert.notEqual(T.cur, null); assert.equal(T.answered, 0);
  assert.equal(JSON.stringify(T.getS().progress), progress); assert.equal(T.getReviewLedger().used, used);
  const untouched = browser(), U = setup(untouched, {due: 2, cap: 1, used: 1, groupSize: 2});
  untouched.query('#capPauseEnd').onclick();
  assert.equal(U.answered, 0); assert.equal(U.getGroupTotal(), 2); assert.equal(U.deriveStudyPresentation().reason, 'cap-ended');
  assert.match(untouched.query('#card').innerHTML, /本组进度 <b>0<\/b>\/<b>2<\/b>/);
  assert.doesNotMatch(untouched.query('#card').innerHTML, /当前没有进行中的组/);
});
test('组尾沿用空格续组：最后翻页不连带开组，重复/未松键拦截，松开后一次续组', () => {
  const b = browser(), T = setup(b, {dailyNew: 3, groupSize: 1});
  b.key({key: 'f', code: 'KeyF'});
  assert.equal(T.answered, 1);
  b.key({key: ' ', code: 'Space'});
  assert.equal(T.cur, null); assert.equal(T.getS().days[today(b.now)].n, 1);
  assert.match(b.query('#hint').textContent, /空格.*继续下一组/);
  const finished = group(T);
  b.key({key: ' ', code: 'Space', repeat: true}); assert.equal(group(T), finished);
  b.key({key: ' ', code: 'Space'}); assert.equal(group(T), finished, '未松开同一键不打开下一组');
  b.fireDocument('keyup', {key: ' ', code: 'Space'});
  b.key({key: ' ', code: 'Space'});
  assert.notEqual(T.cur, null); assert.equal(T.phase, 'recall'); assert.equal(T.answered, 0);
  assert.equal(T.getS().days[today(b.now)].n, 1, '续组不自动判定首词');
});
test('自定义下一个键和Shift键在完成页沿用，独立继续键仍可使用', () => {
  const b = browser(), T = setup(b, {dailyNew: 5, groupSize: 1});
  assert.equal(T.setInputBinding('next', 'shift+x').ok, true);
  finish(T); b.key({key: 'X', code: 'KeyX', shiftKey: true});
  assert.notEqual(T.cur, null); assert.equal(T.answered, 0);
  assert.equal(T.setInputBinding('continue', 'c').ok, true);
  finish(T); b.key({key: 'c', code: 'KeyC'});
  assert.notEqual(T.cur, null); assert.equal(T.answered, 0);
});
test('完成页独立继续键可复用判定键；关闭字符快捷键和无候选均不空开组', () => {
  const b = browser(), T = setup(b, {dailyNew: 4, groupSize: 1});
  assert.equal(T.setInputBinding('continue', 'f').ok, true);
  finish(T); b.key({key: 'f', code: 'KeyF'});
  assert.notEqual(T.cur, null); assert.equal(T.answered, 0, '完成页复用F只续组，不判定');
  b.key({key: 'f', code: 'KeyF'}); assert.equal(T.answered, 1, '学习卡上的F仍是判定');
  finish(T); const finished = group(T);
  T.getS().settings.singleCharKeys = false;
  b.key({key: ' ', code: 'Space'}); assert.equal(group(T), finished);
  setup(b, {dailyNew: 1, groupSize: 1}); T.getS().settings.singleCharKeys = true;
  finish(T); b.key({key: ' ', code: 'Space'});
  assert.equal(T.cur, null); assert.equal(T.answered, 1);
});
test('纯新词子组完成后沿用下一个键回原组，保留原组暂停现场与预算', () => {
  const b = browser(), T = setup(b, {dailyNew: 2, groupSize: 1, due: 1, cap: 1, used: 1});
  const original = T.cur, plan = JSON.stringify(T.getPlan());
  assert.equal(T.startNewOnlySubgroup(), true); assert.equal(T.isNewOnlySubgroup(), true);
  finish(T); assert.equal(T.cur, null);
  b.key({key: ' ', code: 'Space'});
  assert.equal(T.isNewOnlySubgroup(), false); assert.equal(T.cur, original);
  assert.equal(JSON.stringify(T.getPlan()), plan); assert.equal(T.getReviewLedger().used, 1);
});
test('熟练浮动确认6秒自动收起，状态保留且渲染不续命；取消只恢复熟练标记', () => {
  const b = browser(), T = setup(b, {dailyNew: 3, groupSize: 2});
  const i = T.cur;
  T.setProficient(i, true);
  assert.equal(b.query('#profFeedback').hidden, false); assert.equal(T.isProficient(i), true);
  const progress = JSON.stringify(T.getS().progress), ledger = JSON.stringify(T.getReviewLedger());
  b.elapse(5000); T.renderProfFeedback(); b.elapse(1100);
  assert.equal(b.query('#profFeedback').hidden, true); assert.equal(T.getProfMark(), null);
  assert.equal(T.isProficient(i), true); assert.equal(JSON.stringify(T.getS().progress), progress);
  assert.equal(JSON.stringify(T.getReviewLedger()), ledger);
  const j = T.cur; T.setProficient(j, true);
  b.query('#btnUnMaster').onclick();
  assert.equal(T.isProficient(j), false); assert.equal(T.isProficient(i), true);
  assert.equal(b.query('#profFeedback').hidden, true);
});
test('错词特训完成后空格返回原学习卡，保留主组进度和冻结计划', () => {
  const b = browser(), T = setup(b, {dailyNew: 3, groupSize: 2});
  const original = T.cur, plan = JSON.stringify(T.getPlan());
  T.getS().progress[0] = [1, b.now + 86400000, 1, 1, b.now - 1000];
  assert.equal(T.startDrill(), true); finish(T);
  assert.equal(T.drillMode, true); assert.equal(T.cur, null);
  b.key({key: ' ', code: 'Space'});
  assert.equal(T.drillMode, false); assert.equal(T.cur, original);
  assert.equal(JSON.stringify(T.getPlan()), plan);
});
test('熟练反馈悬停/聚焦暂停计时；手动收起不恢复熟练或更改学习现场', () => {
  const b = browser(), T = setup(b, {dailyNew: 3, groupSize: 2});
  const i = T.cur; T.setProficient(i, true);
  const box = b.query('#profFeedback');
  b.elapse(1000); box.fire('pointerenter'); b.elapse(10000); assert.equal(box.hidden, false);
  box.fire('focusin'); box.fire('pointerleave'); b.elapse(10000); assert.equal(box.hidden, false);
  box.fire('focusout', {relatedTarget: b.document.body}); b.elapse(5100); assert.equal(box.hidden, true);
  const j = T.cur; T.setProficient(j, true); const scene = group(T);
  b.query('#profFeedbackDismiss').onclick(); assert.equal(box.hidden, true);
  assert.equal(T.isProficient(j), true); assert.equal(group(T), scene);
});
test('取消按钮仍聚焦时连续标熟练保留焦点暂停，新目标在离开后获得完整6秒', () => {
  const b = browser(), T = setup(b, {dailyNew: 5, groupSize: 4});
  T.setProficient(T.cur, true);
  const box = b.query('#profFeedback'), cancel = b.query('#btnUnMaster');
  box.contains = node => node === box || node === cancel;
  box.matches = () => false;
  cancel.focus(); box.fire('focusin'); b.elapse(6500);
  assert.equal(box.hidden, false); assert.equal(b.document.activeElement, cancel);
  const j = T.cur; b.key({key: 'm', code: 'KeyM', target: cancel});
  assert.equal(T.isProficient(j), true); assert.equal(T.getProfMark().i, j);
  b.elapse(6500); assert.equal(box.hidden, false, '新目标不可在仍聚焦时隐藏静态取消按钮');
  assert.equal(b.document.activeElement, cancel);
  b.query('#card').focus(); box.fire('focusout', {relatedTarget: b.query('#card')});
  b.elapse(5900); assert.equal(box.hidden, false); b.elapse(200); assert.equal(box.hidden, true);
});
test('同一浮层连续标熟练保留真实悬停，目标更换不沿用已失效的悬停/焦点原因', () => {
  const b = browser(), T = setup(b, {dailyNew: 5, groupSize: 4});
  T.setProficient(T.cur, true);
  const box = b.query('#profFeedback'); let hovered = true;
  box.matches = () => hovered;
  box.fire('pointerenter'); b.elapse(6500); assert.equal(box.hidden, false);
  T.setProficient(T.cur, true); b.elapse(6500); assert.equal(box.hidden, false, '真实悬停随新目标保留');
  box.fire('focusin');
  hovered = false; b.document.activeElement = b.document.body;
  T.setProficient(T.cur, true); b.elapse(6100);
  assert.equal(box.hidden, true, '替换时不存在真实悬停/焦点，旧暂停原因不应延续');
});
console.log(`\n学习动作回归：${passed} 组通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);

