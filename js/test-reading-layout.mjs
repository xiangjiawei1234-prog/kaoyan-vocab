/**
 * F1 阅读与布局定制：设置归一化/严格校验、卡片渲染顺序与标签开关、
 * 固定次级动作与更多操作、改设置不改变学习现场、统计面板展开持久化。
 * DOM 桩 + vm 沙箱执行真实 js/app.js，不复制业务逻辑。
 * 运行：node --max-old-space-size=512 js/test-reading-layout.mjs
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
const appSource = () => fs.readFileSync(process.env.INPUT_APP_SOURCE || path.join(HERE, "app.js"), "utf8");
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
  let failWrites = false, selection = "";
  const writeLog = [];
  const registry = new Map();
  const documentEvents = new Map(); // type → [{fn, capture}]
  const windowEvents = new Map();
  const intervals = [];
  const timeouts = new Map(); let timeoutId = 0;
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
      fire(type,data={}) {
        const event=Object.assign({type,target:el,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}},data);
        for(const rec of events.get(type)||[])if(rec.capture)rec.fn(event);
        for(const rec of events.get(type)||[])if(!rec.capture)rec.fn(event);
        return event;
      },
      appendChild(child) { child.remove?.(); el.children.push(child); child.parentNode = el; return child; },
      insertBefore(child, ref) {
        if (child === ref) return child;
        child.remove?.();
        const i = ref ? el.children.indexOf(ref) : -1;
        if (i >= 0) el.children.splice(i, 0, child); else el.children.push(child);
        child.parentNode = el; return child;
      },
      remove() {
        if (!el.parentNode) return;
        const i = el.parentNode.children.indexOf(el);
        if (i >= 0) el.parentNode.children.splice(i, 1);
        el.parentNode = null;
      },
      click() { if (el.onclick) el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); },
      focus() { if (document) document.activeElement = el; },
      blur() { if (document && document.activeElement === el) document.activeElement = null; },
      closest() { return null; },
      contains(node) { return node === el; },
      getAttribute(name) { return el._attrs && Object.prototype.hasOwnProperty.call(el._attrs, name) ? el._attrs[name] : null; },
      setAttribute(name, value) { if (!el._attrs) el._attrs = {}; el._attrs[name] = String(value); },
      removeAttribute(name) { if (el._attrs) delete el._attrs[name]; },
      querySelector(selector) { if (!el._queries) el._queries = new Map(); if (!el._queries.has(selector)) el._queries.set(selector, element("div")); return el._queries.get(selector); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html || ""; },
      set(v) { el._html = String(v); }
    });
    return el;
  }
  /* F1：设置控件与统计 details 的静态桩（真实 DOM 由 index.html 提供，这里只给可绑定对象）。 */
  const densityButtons = ["comfortable", "compact"].map(v => {
    const btn = element("button"); btn.dataset.cardDensity = v; return btn;
  });
  const secondaryChecks = ["undo", "proficient", "speak", "star"].map(v => {
    const input = element("input"); input.type = "checkbox"; input.dataset.secondaryAction = v; return input;
  });
  const statsPanels = ["statsForecastPanel", "surveyPanel", "statsFreqPanel", "statsStagesPanel",
    "statsDaysPanel", "statsHeatmapPanel"].map(id => { const d = element("details"); d.id = id; d.open = false; return d; });
  const statsPanelById = new Map(statsPanels.map(d => ["#" + d.id, d]));
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (statsPanelById.has(selector)) return statsPanelById.get(selector);
    if (!registry.has(selector)) registry.set(selector, element(selector.startsWith("input#") || /^#(dailyNew|pmin|fmin|fmax)$/.test(selector) ? "input" : "div"));
    return registry.get(selector);
  }
  const views = ["study", "list", "stats", "set"].map(v => query(`#v-${v}`));
  const statsRoot = query("#v-stats");
  const statsCards = ["statsPlanPanel", "statsOverviewPanel", ...statsPanels.map(x => x.id)].map(id => { const card = query("#" + id); card.id = id; return card; });
  for (const card of statsCards) { card.classList.add("panel"); statsRoot.appendChild(card); }
  views[0].classList.add("on");
  const nav = ["study", "list", "stats", "set"].map(v => { const b = element("button"); b.dataset.v = v; return b; });
  const keyButtons = ["know", "dont", "next", "speak", "star", "proficient", "continue", "wait", "return", "listSearch"].map(k => { const b = element("button"); b.dataset.k = k; return b; });
  const closeButton = element("button");
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#helpSheet [data-close]" || selector === "#helpSheet button") return [closeButton];
    if (selector === "#cardDensitySeg [data-card-density]") return densityButtons;
    if (selector === "#secondaryActionChoices [data-secondary-action]") return secondaryChecks;
    if (selector === "#v-stats details.stats-details" || selector === "#v-stats .stats-details") return statsPanels;
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  for (const id of ["helpSheet", "appAlert", "exPop", "wordSheet", "guideSheet", "bookSheet"]) query("#" + id).hidden = true;
  // 学习卡桩：renderCard 只用 #card 的 class/dataset/scrollTop/innerHTML，
  // 以及 .answer-extra 的展开状态（F1 同卡重绘保序）——用可控的 details 桩观察。
  const cardEl = query("#card");
  const answerExtraEl = element("details");
  answerExtraEl.classList.add("answer-extra");
  let fmOpenWrites = 0;
  let fmOpenValue = false;
  Object.defineProperty(answerExtraEl, "open", {
    get() { return fmOpenValue; },
    set(v) { fmOpenValue = !!v; if (v) fmOpenWrites++; }
  });
  cardEl.querySelector = (sel) => sel === ".answer-extra" ? answerExtraEl : null;
  cardEl.querySelectorAll = () => [];

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
    getSelection:()=>({toString:()=>selection}),
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
    clearInterval(id) { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    setTimeout(fn, delay) { const id = ++timeoutId; timeouts.set(id, {fn, delay}); return id; },
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
    const event = Object.assign({ type, target: document.body, defaultPrevented:false, preventDefault() {this.defaultPrevented=true;}, stopPropagation() {} }, ev);
    for (const rec of documentEvents.get(type) || []) if (rec.capture) rec.fn(event);
    for (const rec of documentEvents.get(type) || []) if (!rec.capture) rec.fn(event);
    return event;
  };
  return {
    T, study, window, document, context, storage, intervals, writeLog, query, views, keyButtons,
    selectText(text){selection=text;},
    get now() { return now; },
    advance(ms) { now += ms; },
    runTimeout(delay) { for (const [id, t] of [...timeouts]) if (t.delay === delay) { timeouts.delete(id); t.fn(); } },
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
    rawState() { return storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null; },
    // F1：卡片/词形 details/设置控件桩的只读观察口。
    queryAll,
    card: cardEl,
    answerExtra: answerExtraEl,
    fmOpenWrites: () => fmOpenWrites,
    resetFmWrites() { fmOpenWrites = 0; }
  };
}

function setup(b, {dailyNew = 2, groupSize = 2, cap = 0, used = 0, dayN = 0, extra = 0, due = 0} = {}) {
  const T = b.T, s = T.getS(), d = today(b.now);
  s.progress = {}; s.days = {[d]: {n: dayN, r: dayN, ok: dayN, no: 0}};
  s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {dailyNew, groupSize, fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: 'primary', order: 'freq', backlogGuard: false, autoSpk: false,
    cardDensity: 'comfortable', readingOrder: ['meaning', 'example', 'forms'],
    showCardMeta: true, showCardStage: true, showCardPos: true,
    secondaryActions: ['undo', 'proficient'], actionLayout: 'standard'});
  s.reviewDay = {d, used}; s.extraDay = {d, extra};
  for (let i = 0; i < due; i++) s.progress[i] = [1, b.now - 5000, 1, 0, b.now - 86400000];
  T.setReviewCap(cap); T.startSession(); T.show('study'); return T;
}
function finish(T) { let i = 0; while (T.cur != null && i++ < 120) { T.judge(true); T.tryNext(); } assert.ok(T.cur == null); }
const group = T => JSON.stringify({Q: T.Q, qi: T.qi, cur: T.cur, phase: T.phase, verdict: T.verdict, answered: T.answered, plan: T.getPlan()});
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS  ' + name); } catch (error) { failed++; console.log('FAIL  ' + name + ': ' + error.message); } }

const prefs = b => b.window.__vocabSettingsProfiles;
const W = T => T.getW();
const cardHtml = b => b.query("#card").innerHTML;
const actsHtml = b => b.query("#acts").innerHTML;
const countId = (html, id) => (html.match(new RegExp('id="' + id + '"', "g")) || []).length;
const patch = (b, p) => prefs(b).applySettingsPatch(p);
const renderWord = (T, i, revealed) => {
  T.setVerdict(null); T.setCur(i);
  if (revealed) { T.setVerdict(true); T.setCur(i); }
};
const richIndex = T => W(T).findIndex(x => x.ex && x.fm && x.m && x.ph);
const noFmIndex = T => W(T).findIndex(x => x.ex && !x.fm && x.m);
const scene = T => JSON.stringify({group:JSON.parse(group(T)),progress:T.getS().progress,days:T.getS().days,
  review:T.getS().reviewDay,extra:T.getS().extraDay,time:T.getS().timeSec,plan:T.getPlan()});
function permutations(list){
  if (list.length <= 1) return [list.slice()];
  const out = [];
  list.forEach((item, i) => {
    for (const rest of permutations(list.slice(0, i).concat(list.slice(i + 1)))) out.push([item].concat(rest));
  });
  return out;
}
/** 伪事件：设置页上移/下移按钮在真实 DOM 里是 button[data-order-key][data-order-dir]。 */
const orderButton = (key, dir) => ({
  dataset: {orderKey: key, orderDir: String(dir)},
  getAttribute: () => null,
  closest: () => orderButton(key, dir)
});

/* ---------------- 1. 默认值 / 归一化 / 旧记录与旧备份兼容 ---------------- */
test('F1 新默认：舒适/默认顺序/显示三类元信息/固定撤销与熟练', () => {
  const b = browser(), T = setup(b), s = T.getS().settings;
  assert.equal(s.cardDensity, "comfortable");
  assert.deepEqual(clone(s.readingOrder), ["meaning", "example", "forms"]);
  assert.equal(s.showCardMeta, true);
  assert.equal(s.showCardStage, true);
  assert.equal(s.showCardPos, true);
  assert.deepEqual(clone(s.secondaryActions), ["undo", "proficient"]);
  assert.deepEqual(clone(T.getReadingLayout()), {cardDensity:"comfortable", readingOrder:["meaning","example","forms"],
    showCardMeta:true, showCardStage:true, showCardPos:true, secondaryActions:["undo","proficient"], actionLayout:"standard"});
  const exp = T.buildExport();
  assert.equal(exp.version, 3, "备份格式仍为 v3");
  assert.deepEqual(clone(exp.books.kaoyan.settings.readingOrder), ["meaning", "example", "forms"]);
  assert.deepEqual(clone(exp.books.kaoyan.settings.secondaryActions), ["undo", "proficient"]);
  assert.equal(exp.books.kaoyan.settings.cardDensity, "comfortable");
});

test('F1 旧记录/旧备份缺字段只在归一化补齐，不整份重置其他设置', () => {
  const b = browser(), T = setup(b), raw = clone(T.getS());
  raw.settings.dailyNew = 33;
  for (const k of ["cardDensity", "readingOrder", "showCardMeta", "showCardStage", "showCardPos", "secondaryActions"])
    delete raw.settings[k];
  const n = T.normalizeState(raw).settings;
  assert.equal(n.dailyNew, 33, "其他合法设置保留");
  assert.equal(n.cardDensity, "comfortable");
  assert.deepEqual(clone(n.readingOrder), ["meaning", "example", "forms"]);
  assert.equal(n.showCardMeta, true); assert.equal(n.showCardStage, true); assert.equal(n.showCardPos, true);
  assert.deepEqual(clone(n.secondaryActions), ["undo", "proficient"]);
});

test('F1 归一化逐子项修复：单个非法只修该字段，合法值保留', () => {
  const b = browser(), T = setup(b), raw = clone(T.getS());
  raw.settings.cardDensity = "dense";
  raw.settings.readingOrder = ["example", "meaning"];        // 不是全排列
  raw.settings.showCardMeta = "yes";                          // 非布尔
  raw.settings.showCardStage = false;                         // 合法
  raw.settings.showCardPos = 1;                               // 非布尔
  raw.settings.secondaryActions = ["undo", "undo"];           // 重复
  const n = T.normalizeState(raw).settings;
  assert.equal(n.cardDensity, "comfortable");
  assert.deepEqual(clone(n.readingOrder), ["meaning", "example", "forms"]);
  assert.equal(n.showCardMeta, true);
  assert.equal(n.showCardStage, false);
  assert.equal(n.showCardPos, true);
  assert.deepEqual(clone(n.secondaryActions), ["undo", "proficient"]);
  raw.settings.cardDensity = "compact";
  raw.settings.readingOrder = ["forms", "meaning", "example"];
  raw.settings.secondaryActions = ["speak", "star"];
  const n2 = T.normalizeState(raw).settings;
  assert.equal(n2.cardDensity, "compact");
  assert.deepEqual(clone(n2.readingOrder), ["forms", "meaning", "example"]);
  assert.deepEqual(clone(n2.secondaryActions), ["speak", "star"]);
  assert.equal(T.normalizeReadingOrder(["meaning","example","forms","x"]).join(","), "meaning,example,forms");
  assert.equal(T.normalizeSecondaryActions(["undo","proficient","speak"]).join(","), "undo,proficient");
});

/* ---------------- 2. readingOrder 严格全排列与非法拒绝 ---------------- */
test('F1 readingOrder 六个全排列都是合法值，非法数组/类型整组回默认', () => {
  const b = browser(), T = setup(b);
  const all = permutations(["meaning", "example", "forms"]);
  assert.equal(all.length, 6);
  for (const order of all) {
    assert.equal(patch(b, {readingOrder: order}).ok, true, JSON.stringify(order));
    assert.deepEqual(clone(T.getS().settings.readingOrder), order);
  }
  for (const bad of [[], ["meaning"], ["meaning","example"], ["meaning","example","forms","x"],
    ["meaning","meaning","forms"], ["meaning","example","other"], null, "meaning", 42]) {
    const before = JSON.stringify(T.getS().settings), disk = b.storage.get(KEY);
    assert.equal(patch(b, {readingOrder: bad}).ok, false, JSON.stringify(bad));
    assert.equal(JSON.stringify(T.getS().settings), before);
    assert.equal(b.storage.get(KEY), disk, "非法配置不写盘");
  }
});

test('F1 六字段严格校验：坏密度/坏布尔/三级固定动作都被原子拒绝', () => {
  const b = browser(), T = setup(b), before = scene(T), disk = b.storage.get(KEY);
  const bads = [
    {cardDensity: "dense"}, {cardDensity: null},
    {showCardMeta: "true"}, {showCardStage: 0}, {showCardPos: null},
    {secondaryActions: ["undo", "proficient", "speak"]},
    {secondaryActions: ["undo", "undo"]},
    {secondaryActions: ["undo", "unknown"]},
    {secondaryActions: "undo"}
  ];
  for (const p of bads) {
    assert.equal(patch(b, p).ok, false, JSON.stringify(p));
    assert.equal(scene(T), before);
    assert.equal(b.storage.get(KEY), disk);
  }
});

/* ---------------- 3. 卡片渲染：顺序 / 不泄漏 / 缺内容 / 标签开关 ---------------- */
test('F1 判定后主体按 readingOrder 渲染，六种顺序都成立', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  assert.ok(i >= 0, "存在同时有例句与词形的词");
  for (const order of permutations(["meaning", "example", "forms"])) {
    assert.equal(patch(b, {readingOrder: order}).ok, true);
    renderWord(T, i, true);
    const h = cardHtml(b);
    const pos = {
      meaning: h.indexOf('<div class="mean">'),
      example: h.indexOf('<div class="ex" lang="en"'),
      forms: h.indexOf('<details class="answer-extra">')
    };
    assert.ok(pos.meaning >= 0 && pos.example >= 0 && pos.forms >= 0, "三块内容都在");
    const positions = order.map(k => pos[k]);
    assert.deepEqual(positions.slice().sort((x, y) => x - y), positions, "顺序应为 " + order.join(" → "));
    assert.ok(h.indexOf('<div class="word"') >= 0 && h.indexOf('<div class="word"') < pos.meaning, "词头始终在答案前");
  }
});

test('F1 回忆阶段不渲染释义/例句/词形，词头仍在', () => {
  const b = browser(), T = setup(b), i = richIndex(T), x = W(T)[i];
  renderWord(T, i, false);
  const h = cardHtml(b);
  assert.ok(h.includes("word-face") && h.includes('<div class="word" lang="en">'));
  assert.ok(!h.includes('<div class="answer"'));
  assert.ok(!h.includes('class="mean"'));
  assert.ok(!h.includes('class="answer-extra"'));
  assert.ok(!h.includes('class="ex"'));
  assert.ok(!h.includes(x.m), "回忆阶段不泄漏中文释义原文");
});

test('F1 缺内容自然跳过：无词形词按 [forms, meaning, example] 只渲染剩下两块', () => {
  const b = browser(), T = setup(b), i = noFmIndex(T);
  assert.ok(i >= 0, "存在没有词形变化的词");
  assert.equal(patch(b, {readingOrder: ["forms", "meaning", "example"]}).ok, true);
  renderWord(T, i, true);
  const h = cardHtml(b);
  assert.ok(!h.includes('class="answer-extra"'), "无词形时不渲染空 details");
  assert.ok(h.indexOf('<div class="mean">') >= 0 && h.indexOf('<div class="ex" lang="en"') > h.indexOf('<div class="mean">'));
  assert.equal(patch(b, {showEx: false}).ok, true);
  renderWord(T, i, true);
  assert.ok(!cardHtml(b).includes('class="ex"'), "showEx=false 时例句块自然跳过");
});

test('F1 三个 showCard* 开关只控制学习卡标签块；回忆态词头与判定按钮不受影响', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  let h = cardHtml(b);
  assert.ok(h.includes('class="tagrow"') && h.includes("词频 #"));
  assert.ok(h.includes('class="posline"'));
  assert.ok(h.includes('class="dots"'));
  assert.equal(patch(b, {showCardMeta: false}).ok, true); renderWord(T, i, true); h = cardHtml(b);
  assert.ok(!h.includes('class="tagrow"') && !h.includes("词频 #") && !h.includes("次 /"));
  assert.ok(h.includes('class="posline"') && h.includes('class="dots"'));
  assert.equal(patch(b, {showCardStage: false}).ok, true); renderWord(T, i, true); h = cardHtml(b);
  assert.ok(!h.includes('class="dots"'));
  assert.ok(h.includes('aria-label="单词"'), "阶段隐藏后词面 aria-label 不再声称含阶段");
  assert.equal(patch(b, {showCardPos: false}).ok, true); renderWord(T, i, true); h = cardHtml(b);
  assert.ok(!h.includes('class="posline"'));
  assert.ok(h.includes('<div class="word" lang="en">'), "词头始终保留");
  assert.equal(patch(b, {showCardMeta: true, showCardStage: true, showCardPos: true}).ok, true);
  renderWord(T, i, false);
  const recallActs = actsHtml(b);
  assert.ok(recallActs.includes('id="ok"') && recallActs.includes('id="no"'), "回忆态主判定按钮不受标签开关影响");
});

test('F1 密度只加卡片内 class，不改变卡片 DOM/按钮/动作区标记', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  const normal = cardHtml(b);
  assert.ok(!b.card.classList.contains("card-compact"));
  assert.equal(patch(b, {cardDensity: "compact"}).ok, true);
  renderWord(T, i, true);
  assert.ok(b.card.classList.contains("card-compact"), "紧凑密度只加 #card class");
  assert.equal(cardHtml(b), normal, "密度不改变卡片内容结构");
  assert.equal(actsHtml(b), actsHtml(b));
  assert.equal(patch(b, {cardDensity: "comfortable"}).ok, true);
  renderWord(T, i, true);
  assert.ok(!b.card.classList.contains("card-compact"));
  T.setCur(null);
  assert.ok(!b.card.classList.contains("card-compact"), "完成页/空页不带卡片密度 class");
});

/* ---------------- 4. 固定次级动作与「更多操作」 ---------------- */
const secondaryButtonIds = {undo: "undoBtn", proficient: "markProficient", speak: "actsSpeak", star: "actsStar"};
test('F1 默认固定撤销+熟练仍占第三行，不出现更多操作；回忆态熟练入口保留', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  const h = actsHtml(b);
  assert.match(h, /id="actsSecondary" data-secondary-count="2"/);
  assert.equal(countId(h, "undoBtn"), 1);
  assert.equal(countId(h, "markProficient"), 1);
  assert.ok(h.indexOf('id="undoBtn"') < h.indexOf('id="markProficient"'), "默认顺序撤销在前");
  assert.ok(!h.includes('id="actsMore"'), "默认两项都已固定，无需更多操作");
  assert.ok(h.indexOf('id="actsSecondary"') < h.indexOf('id="undoBtn"'), "固定动作位于第三行容器");
  renderWord(T, i, false);
  assert.ok(actsHtml(b).includes('id="markProficient"'), "回忆态仍有熟练入口");
  assert.ok(!actsHtml(b).includes('id="undoBtn"'), "回忆态没有撤销入口（无可撤销判定）");
});

test('F1 secondaryActions 全部组合：固定项占第三行，撤销/熟练始终可达且各只有一个实例', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  const combos = [["undo","proficient"],["undo"],["proficient"],[],["speak","star"],["undo","speak"],
    ["proficient","star"],["speak"],["star"],["undo","star"],["proficient","speak"],["star","proficient"]];
  for (const combo of combos) {
    assert.equal(patch(b, {secondaryActions: combo}).ok, true, JSON.stringify(combo));
    renderWord(T, i, true);
    const h = actsHtml(b);
    assert.equal(countId(h, "undoBtn"), 1, JSON.stringify(combo) + " 撤销入口唯一");
    assert.equal(countId(h, "markProficient"), 1, JSON.stringify(combo) + " 熟练入口唯一");
    assert.match(h, new RegExp('data-secondary-count="' + combo.length + '"'));
    const more = h.indexOf('id="actsMore"');
    for (const id of combo) {
      const btnId = secondaryButtonIds[id];
      const at = h.indexOf('id="' + btnId + '"');
      assert.ok(at >= 0, id + " 固定后可见");
      if (more >= 0) assert.ok(at < more, id + " 固定项在更多操作之前（第三行槽位）");
    }
    for (const id of ["undo","proficient"]) {
      if (combo.includes(id)) continue;
      const at = h.indexOf('id="' + secondaryButtonIds[id] + '"');
      assert.ok(more >= 0 && at > more, id + " 未固定时必须在更多操作内可达");
    }
  }
});

test('F1 固定 2 项且仍需更多操作时：更多触发缩为同行紧凑按钮，不新增行（151/156/146 契约）', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  assert.equal(patch(b, {secondaryActions: ["speak", "star"]}).ok, true);
  renderWord(T, i, true);
  const h = actsHtml(b);
  assert.match(h, /data-secondary-count="2" data-has-more="1"/, "2 项固定 + 更多时标记 has-more");
  const summary = h.slice(h.indexOf('id="actsMore"'), h.indexOf('id="actsMore"') + 220);
  assert.match(summary, /aria-label="更多操作"/);
  assert.match(summary, /<span aria-hidden="true">⋯<\/span>/, "紧凑触发只显示图标，避免挤宽本行");
  assert.equal(summary.includes("更多操作<span"), false, "紧凑触发不再显示完整文字");
  // 1 项或 0 项固定时仍用可读的完整“更多操作”文案，且都在同一行。
  assert.equal(patch(b, {secondaryActions: ["undo"]}).ok, true);
  renderWord(T, i, true);
  assert.match(actsHtml(b), /data-secondary-count="1" data-has-more="1"/);
  assert.match(actsHtml(b), />更多操作<span/);
});

test('F1 固定发音/收藏时卡片图标仍保留；未固定项仍在更多操作', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  assert.equal(patch(b, {secondaryActions: ["speak", "star"]}).ok, true);
  renderWord(T, i, true);
  const h = cardHtml(b);
  assert.equal(countId(h, "spk"), 1);
  assert.equal(countId(h, "star"), 1);
  assert.ok(/id="star"[^>]*aria-pressed=/.test(h), "卡片收藏图标仍有无障碍状态");
  const a = actsHtml(b);
  assert.ok(a.indexOf('id="actsSpeak"') < a.indexOf('id="actsStar"'), "固定顺序与设置一致");
  assert.ok(a.indexOf('id="actsMore"') >= 0);
  assert.ok(a.indexOf('id="undoBtn"') > a.indexOf('id="actsMore"'));
  assert.ok(a.indexOf('id="markProficient"') > a.indexOf('id="actsMore"'));
});

test('F1 actionLayout left/right 只换第三行顺序，与视觉槽位/DOM 顺序一致', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  assert.equal(patch(b, {actionLayout: "left"}).ok, true);
  renderWord(T, i, true);
  let h = actsHtml(b);
  assert.equal(b.query("#acts").dataset.layout, "left");
  // 真实 DOM 的 nx/fix 换位由 applyActionLayout 的 insertBefore 完成（DOM 桩无真实子节点，
  // 由 tests/browser/check-input-preferences.mjs 做真实几何/DOM 顺序断言）。
  assert.ok(h.indexOf('id="fix"') >= 0 && h.indexOf('id="nx"') >= 0);
  assert.ok(h.indexOf('id="markProficient"') < h.indexOf('id="undoBtn"'), "left：熟练/撤销换位");
  assert.equal(patch(b, {actionLayout: "right"}).ok, true);
  renderWord(T, i, true);
  h = actsHtml(b);
  assert.ok(h.indexOf('id="undoBtn"') < h.indexOf('id="markProficient"'), "right：撤销仍在左");
  assert.equal(patch(b, {actionLayout: "left", secondaryActions: ["speak", "star"]}).ok, true);
  renderWord(T, i, true);
  h = actsHtml(b);
  assert.ok(h.indexOf('id="actsStar"') < h.indexOf('id="actsSpeak"'), "left 时固定项顺序随布局反转");
  assert.equal(patch(b, {actionLayout: "standard", secondaryActions: ["undo", "proficient"]}).ok, true);
});

/* ---------------- 5. 改呈现不改学习现场 ---------------- */
test('F1 所有 F1 设置即时生效但不 startSession：Q/cur/verdict/Qi/answered/undo/plan/预算/快照不变', () => {
  const b = browser(), T = setup(b, {due: 1, cap: 10}), P = prefs(b);
  T.judge(true);                                       // 产生撤销栈 + 台账消费 + 会话快照
  const before = scene(T), qBefore = group(T), sig = T.getPlan().scopeSig;
  const snapshotKey = T.getSessionSnapshotKey(T.getBook());
  const snapshotBefore = b.storage.get(snapshotKey) || null;
  const diskBefore = b.storage.get(KEY);
  const r = P.applySettingsPatch({cardDensity: "compact", readingOrder: ["example", "meaning", "forms"],
    showCardMeta: false, showCardStage: false, showCardPos: false,
    secondaryActions: ["speak", "star"], actionLayout: "left"});
  assert.equal(r.ok, true);
  assert.equal(scene(T), before, "学习现场与冻结计划完全不变");
  assert.equal(group(T), qBefore);
  assert.equal(T.getPlan().scopeSig, sig, "scopeSig 不含呈现偏好");
  assert.equal(T.hasPendingScopeSettings(), false, "呈现偏好不产生下一组待应用");
  assert.equal(b.storage.get(snapshotKey) || null, snapshotBefore, "会话快照不被呈现偏好重写");
  assert.ok(!sig.includes("readingOrder") && !sig.includes("cardDensity") && !sig.includes("secondaryActions"));
  assert.equal(T.getS().reviewDay.used, JSON.parse(before).review.used, "复习预算不被消费");
  assert.notEqual(b.storage.get(KEY), diskBefore, "设置随主记录保存（savedStateSignature 保护未保存变动）");
  T.undo();
  assert.equal(T.verdict, null, "撤销栈仍可用（呈现设置未清撤销）");
  assert.equal(T.answered, JSON.parse(before).group.answered - 1);
});

test('F1 保存失败时保留原设置、报告错误且不破坏现场', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  const beforeSettings = JSON.stringify(T.getS().settings), before = scene(T);
  b.setFailWrites(true);
  const r = patch(b, {cardDensity: "compact", readingOrder: ["forms", "meaning", "example"]});
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(T.getS().settings), beforeSettings);
  assert.equal(scene(T), before);
  b.setFailWrites(false);
  assert.equal(patch(b, {cardDensity: "compact"}).ok, true);
});

test('F1 按类恢复外观同时恢复六个 F1 字段，不重建当前组', () => {
  const b = browser(), T = setup(b);
  const qBefore = group(T);
  assert.equal(patch(b, {cardDensity: "compact", readingOrder: ["forms", "example", "meaning"],
    showCardMeta: false, showCardStage: false, showCardPos: false,
    secondaryActions: ["speak"], actionLayout: "left"}).ok, true);
  const r = T.resetSettingsClass("appearance");
  assert.equal(r.ok, true);
  const s = T.getS().settings;
  assert.equal(s.cardDensity, "comfortable");
  assert.deepEqual(clone(s.readingOrder), ["meaning", "example", "forms"]);
  assert.equal(s.showCardMeta, true); assert.equal(s.showCardStage, true); assert.equal(s.showCardPos, true);
  assert.deepEqual(clone(s.secondaryActions), ["undo", "proficient"]);
  assert.equal(group(T), qBefore, "恢复外观不重建当前组");
});

test('F1 六字段进入 v3 备份/归一化；切书后各书取值仍是严格合法值（跨书归属由 O1 解析）', () => {
  const b = browser(), T = setup(b);
  assert.equal(patch(b, {cardDensity: "compact", readingOrder: ["example", "forms", "meaning"],
    showCardMeta: false, showCardStage: false, showCardPos: false, secondaryActions: ["undo"]}).ok, true);
  const exp = T.buildExport();
  assert.equal(exp.version, 3);
  assert.equal(exp.books.kaoyan.settings.cardDensity, "compact");
  assert.deepEqual(clone(exp.books.kaoyan.settings.readingOrder), ["example", "forms", "meaning"]);
  assert.deepEqual(clone(exp.books.kaoyan.settings.secondaryActions), ["undo"]);
  const n = T.normalizeState(exp.books.kaoyan, "kaoyan").settings;
  assert.deepEqual(clone(n.readingOrder), ["example", "forms", "meaning"]);
  assert.equal(n.showCardMeta, false);
  // O1：切书按「设备通用 + 本书覆盖」解析，F1 只负责字段严格合法、不被解析破坏；
  // 具体沿用/继承规则由 O1 专项验证，这里不把旧的「无条件携带」当契约。
  T.switchBook("cet4");
  const layout4 = clone(T.getReadingLayout());
  assert.ok(["comfortable", "compact"].includes(layout4.cardDensity));
  assert.deepEqual(layout4.readingOrder.slice().sort(), ["example", "forms", "meaning"]);
  assert.equal(typeof layout4.showCardMeta, "boolean");
  assert.ok(layout4.secondaryActions.length <= 2 && new Set(layout4.secondaryActions).size === layout4.secondaryActions.length);
  assert.equal(patch(b, {cardDensity: "compact", secondaryActions: ["proficient", "speak"]}).ok, true);
  assert.equal(T.getS().settings.secondaryActions.join(","), "proficient,speak");
  assert.ok(!JSON.stringify(T.buildExport()).includes('"bad"'), "导出结构仍是合法 v3");
});

/* ---------------- 6. 同卡重绘保留词形展开与卡内滚动 ---------------- */
test('F1 同卡重绘保留已展开的词形 details 与卡内滚动；换词回默认', () => {
  const b = browser(), T = setup(b), i = richIndex(T);
  renderWord(T, i, true);
  b.card.scrollTop = 42;
  b.answerExtra.open = true;
  b.resetFmWrites();
  assert.equal(patch(b, {cardDensity: "compact"}).ok, true);
  assert.equal(b.answerExtra.open, true, "同一张卡重绘后词形仍展开");
  assert.ok(b.fmOpenWrites() >= 1, "确实写了 open 状态");
  assert.equal(b.card.scrollTop, 42, "卡内滚动位置保留");
  b.answerExtra.open = false;
  b.resetFmWrites();
  renderWord(T, i + 1, true);
  assert.equal(b.fmOpenWrites(), 0, "换词后不沿用上一张卡的展开状态");
  assert.equal(b.card.scrollTop, 0, "换词回到卡片顶部");
});

test('U3 同词同组暂离设置后恢复主区阅读位置；换词后不沿用旧位置', () => {
  const b = browser(), T = setup(b), i = richIndex(T), main = b.query("#main");
  renderWord(T, i, true);
  main.scrollTop = 215;
  const before = scene(T);
  T.show("set");
  assert.equal(main.scrollTop, 0, "设置页有独立起点");
  main.scrollTop = 900;
  T.show("study");
  assert.equal(main.scrollTop, 215, "返回同词恢复原阅读位置，不沿用设置页位置");
  assert.equal(scene(T), before, "切页与恢复滚动不改变学习现场");
  T.show("set");
  renderWord(T, i + 1, true);
  T.show("study");
  assert.equal(main.scrollTop, 0, "新词不使用上一个词的阅读位置");
});

/* ---------------- 7. 设置控件接线（摘要/按钮/复选上限） ---------------- */
test('F1 外观控件接线：密度 aria-pressed、阅读顺序摘要与移动、次级动作上限与同步', () => {
  const b = browser(), T = setup(b), P = prefs(b);
  const density = b.queryAll("#cardDensitySeg [data-card-density]");
  assert.equal(density.length, 2);
  assert.equal(density[0].getAttribute("aria-pressed"), "true");
  density[1].click();
  assert.equal(T.getS().settings.cardDensity, "compact");
  assert.equal(density[1].getAttribute("aria-pressed"), "true");
  assert.equal(density[0].getAttribute("aria-pressed"), "false");
  const summary = () => b.query("#readingOrderSummary").textContent;
  assert.equal(summary(), "当前顺序：释义 → 例句 → 词形变化。单词词头始终显示在答案之前；未显示的内容（如关闭例句）自动跳过。");
  const list = b.query("#readingOrderList");
  assert.match(list.innerHTML, /上移例句/);
  list.onclick({target: orderButton("example", -1)});
  assert.deepEqual(clone(T.getS().settings.readingOrder), ["example", "meaning", "forms"]);
  assert.equal(summary().startsWith("当前顺序：例句 → 释义 → 词形变化"), true);
  // 边界：第一位再上移无效
  list.onclick({target: orderButton("example", -1)});
  assert.deepEqual(clone(T.getS().settings.readingOrder), ["example", "meaning", "forms"]);
  // 复选：默认两个已固定，再选第三个拒绝并回退
  const checks = b.queryAll("#secondaryActionChoices [data-secondary-action]");
  const byId = id => checks.find(c => c.dataset.secondaryAction === id);
  assert.equal(byId("undo").checked, true);
  assert.equal(byId("proficient").checked, true);
  assert.equal(byId("speak").checked, false);
  const choices = b.query("#secondaryActionChoices");
  byId("speak").checked = true;
  choices.onchange({target: byId("speak")});
  assert.deepEqual(clone(T.getS().settings.secondaryActions), ["undo", "proficient"], "最多两个固定动作");
  assert.equal(byId("speak").checked, false, "超限选择被回退");
  byId("undo").checked = false;
  choices.onchange({target: byId("undo")});
  assert.deepEqual(clone(T.getS().settings.secondaryActions), ["proficient"]);
  byId("speak").checked = true;
  choices.onchange({target: byId("speak")});
  assert.deepEqual(clone(T.getS().settings.secondaryActions), ["proficient", "speak"]);
  assert.match(b.query("#secondaryActionsSummary").textContent, /已固定：熟练、发音/);
  // 开关：showCardMeta 的 onchange 即时保存并重绘学习卡
  const meta = b.query("#showCardMeta");
  meta.checked = false;
  meta.onchange();
  assert.equal(T.getS().settings.showCardMeta, false);
  assert.equal(patch(b, {showCardMeta: true}).ok, true);
});

/* ---------------- 8. 统计页 6 个 details 记住展开偏好 ---------------- */
const STATS_KEY = "vocab_stats_panels_v1";
test('统计面板默认展开，收起写入设备键，刷新保持用户选择与卡片顺序', () => {
  const b = browser(), T = setup(b);
  for (const panel of b.queryAll("#v-stats details.stats-details")) assert.equal(panel.open, true);
  assert.equal(b.storage.has(STATS_KEY), false, "默认不写偏好键");
  const forecast = b.query("#statsForecastPanel");
  forecast.open = false; forecast.fire("toggle");
  assert.deepEqual(JSON.parse(b.storage.get(STATS_KEY)), {version: 1, open: clone(T.statsPanelIds).filter(id => id !== forecast.id), order: clone(T.statsCardIds)});
  const days = b.query("#statsDaysPanel");
  days.open = false; days.fire("toggle");
  forecast.open = true; forecast.fire("toggle");
  assert.deepEqual(JSON.parse(b.storage.get(STATS_KEY)).open, clone(T.statsPanelIds).filter(id => id !== days.id));
  // 刷新恢复：新页面共享同一设备存储
  const shared = new Map(b.storage);
  const b2 = browser({sharedStorage: shared});
  setup(b2);
  assert.equal(b2.query("#statsDaysPanel").open, false);
  assert.equal(b2.query("#statsForecastPanel").open, true);
  assert.equal(b2.query("#statsFreqPanel").open, true);
  assert.equal(shared.get(STATS_KEY), b.storage.get(STATS_KEY), "恢复读取不回写原文");
  assert.equal(T.getS().settings.cardDensity, "comfortable", "统计键与设置无关");
});

test('F1 统计偏好损坏原文保留且不覆写；未知 id 拒绝；写失败不影响页面', () => {
  const badRaw = "{oops not json";
  const shared = new Map([[STATS_KEY, badRaw]]);
  const b = browser({sharedStorage: shared});
  setup(b);
  for (const panel of b.queryAll("#v-stats details.stats-details")) assert.equal(panel.open, true);
  assert.equal(shared.get(STATS_KEY), badRaw, "损坏原文保留");
  assert.equal(b.T.readStatsPanelPrefs().ok, false);
  const unknownRaw = JSON.stringify({version: 1, open: ["statsForecastPanel", "unknownPanel"]});
  const shared2 = new Map([[STATS_KEY, unknownRaw]]);
  const b2 = browser({sharedStorage: shared2});
  setup(b2);
  assert.equal(b2.T.readStatsPanelPrefs().ok, false);
  assert.equal(shared2.get(STATS_KEY), unknownRaw);
  assert.equal(b2.query("#statsForecastPanel").open, true, "整体回默认展开，不回写");
  b2.query("#statsForecastPanel").open = false;
  b2.query("#statsForecastPanel").fire("toggle");
  assert.equal(shared2.get(STATS_KEY), unknownRaw, "用户收起也不得覆写损坏原文");
  // 写失败：内存展开仍生效，不抛异常
  const b3 = browser(), T3 = setup(b3);
  b3.setFailWrites(true);
  const panel = b3.query("#statsHeatmapPanel");
  panel.open = false;
  panel.fire("toggle");
  assert.equal(panel.open, false);
  assert.equal(b3.storage.has(STATS_KEY), false);
  b3.setFailWrites(false);
  assert.equal(T3.statsPanelsKey, STATS_KEY);
  assert.equal(T3.statsPanelIds.length, 6);
});

test('统计旧v1只有open的记录继续可读，不因新增排序字段覆写原文', () => {
  const oldRaw = JSON.stringify({version: 1, open: ["statsDaysPanel"]});
  const shared = new Map([[STATS_KEY, oldRaw]]), b = browser({sharedStorage: shared}), T = setup(b);
  assert.equal(T.readStatsPanelPrefs().ok, true);
  assert.deepEqual(clone(T.readStatsPanelPrefs().order), clone(T.statsCardIds));
  assert.equal(b.query("#statsDaysPanel").open, true);
  assert.equal(b.query("#statsForecastPanel").open, false);
  assert.equal(shared.get(STATS_KEY), oldRaw);
});

test('旧九卡顺序迁移只移除备份卡，保留八卡顺序与展开且不覆写原文', () => {
  const probe = browser(), ids = clone(probe.T.statsCardIds).reverse();
  const oldOrder = ids.slice(); oldOrder.splice(3, 0, "statsStoragePanel");
  const raw = JSON.stringify({version: 1, open: ["statsDaysPanel"], order: oldOrder});
  const shared = new Map([[STATS_KEY, raw]]), b = browser({sharedStorage: shared}), T = setup(b);
  assert.equal(T.readStatsPanelPrefs().ok, true);
  assert.deepEqual(clone(T.readStatsPanelPrefs().order), ids);
  assert.equal(b.query("#statsDaysPanel").open, true);
  assert.equal(shared.get(STATS_KEY), raw);
});

test('统计8张卡可独立排序，刷新恢复，边界/未知方向拒绝且不改变当前组', () => {
  const b = browser(), T = setup(b), before = scene(T), mainRaw = b.storage.get(KEY);
  assert.equal(T.moveStatsPanel("statsPlanPanel", "up"), false);
  assert.equal(T.moveStatsPanel("statsHeatmapPanel", "down"), false);
  assert.equal(T.moveStatsPanel("missing", "up"), false);
  assert.equal(T.moveStatsPanel("statsForecastPanel", "sideways"), false);
  assert.equal(T.moveStatsPanel("statsHeatmapPanel", "up"), true);
  assert.equal(T.moveStatsPanel("statsOverviewPanel", "up"), true);
  const order = b.query("#v-stats").children.map(x => x.id);
  assert.equal(order[0], "statsOverviewPanel");
  assert.equal(order[6], "statsHeatmapPanel");
  assert.deepEqual(JSON.parse(b.storage.get(STATS_KEY)).order, order);
  assert.equal(scene(T), before); assert.equal(b.storage.get(KEY), mainRaw);
  const b2 = browser({sharedStorage: new Map(b.storage)}); setup(b2);
  assert.deepEqual(b2.query("#v-stats").children.map(x => x.id), order);
  assert.equal(JSON.stringify(T.buildExport()).includes("statsOverviewPanel"), false);
});

test('统计排序损坏/重复/缺失id保留原文，存储失败仅保留页面排序', () => {
  const probe = browser(), ids = clone(probe.T.statsCardIds);
  for (const order of [ids.slice(1), ids.map((id, i) => i ? id : ids[1]), ids.map((id, i) => i ? id : "unknown")]) {
    const raw = JSON.stringify({version: 1, open: [], order}), shared = new Map([[STATS_KEY, raw]]);
    const b = browser({sharedStorage: shared}); setup(b);
    assert.equal(b.T.readStatsPanelPrefs().ok, false);
    assert.deepEqual(b.query("#v-stats").children.map(x => x.id), ids);
    assert.equal(b.T.moveStatsPanel("statsOverviewPanel", "up"), true);
    assert.equal(shared.get(STATS_KEY), raw);
  }
  const b = browser(); setup(b); b.setFailWrites(true);
  assert.equal(b.T.moveStatsPanel("statsOverviewPanel", "up"), true);
  assert.equal(b.query("#v-stats").children[0].id, "statsOverviewPanel");
  assert.equal(b.storage.has(STATS_KEY), false);
});

test('统计长按420ms才拖动，提前移动取消、Esc取消恢复原顺序、松开保存', () => {
  const b = browser(), T = setup(b); T.show("stats");
  const root = b.query("#v-stats"), ids = root.children.map(x => x.id);
  const panel = b.query("#statsOverviewPanel"), heading = panel.querySelector(".panel-heading");
  const tools = heading.children[0], handle = tools.querySelector(".stats-drag-handle");
  const begin = () => handle.fire("pointerdown", {pointerId: 7, button: 0, isPrimary: true, clientX: 100, clientY: 20});
  begin(); b.fireDocument("pointermove", {pointerId: 7, clientX: 100, clientY: 31}); b.runTimeout(420);
  assert.equal(panel.classList.contains("stats-dragging"), false, "提前移动取消长按");
  begin(); b.runTimeout(420); assert.equal(panel.classList.contains("stats-dragging"), true);
  b.fireDocument("pointermove", {pointerId: 7, clientX: 100, clientY: -20});
  assert.equal(root.children[0].id, panel.id);
  b.key({key: "Escape"});
  assert.deepEqual(root.children.map(x => x.id), ids);
  assert.equal(b.storage.has(STATS_KEY), false, "取消不保存");
  begin(); b.runTimeout(420); b.fireDocument("pointermove", {pointerId: 7, clientX: 100, clientY: -20});
  const edgeScroll = b.intervals.findLast(timer => timer.ms === 40);
  assert.ok(edgeScroll, "拖动有独立的边缘连续滚动采样");
  const scrollBefore = b.query("#main").scrollTop;
  edgeScroll.fn(); edgeScroll.fn();
  assert.equal(b.query("#main").scrollTop, scrollBefore - 36, "停在边缘仍持续滚动");
  b.fireDocument("pointerup", {pointerId: 7});
  assert.equal(root.children[0].id, panel.id);
  assert.equal(JSON.parse(b.storage.get(STATS_KEY)).order[0], panel.id);
  assert.equal(panel.classList.contains("stats-dragging"), false);
  assert.equal(edgeScroll.cleared, true, "释放后停止自动滚动");
  begin(); b.runTimeout(420);
  b.fireDocument("pointerdown", {pointerId: 8});
  assert.equal(panel.classList.contains("stats-dragging"), false, "第二指针取消拖动");
  begin(); b.runTimeout(420); b.setHidden();
  assert.equal(panel.classList.contains("stats-dragging"), false, "切后台取消拖动");
});

test('F1 统计展开偏好不进备份 v3/进度/设置目录/scopeSig，也不改主记录', () => {
  const b = browser(), T = setup(b, {due: 1, cap: 10});
  T.judge(true);
  const plan = T.getPlan(), mainBefore = b.storage.get(KEY);
  const panel = b.query("#statsForecastPanel");
  panel.open = true; panel.fire("toggle");
  assert.equal(b.storage.get(KEY), mainBefore, "只写设备键，不写学习主记录");
  assert.equal(JSON.stringify(T.getPlan()), JSON.stringify(plan));
  assert.equal(T.hasPendingScopeSettings(), false);
  const catalog = prefs(b).getCatalog();
  assert.ok(!catalog.some(x => /stats.*panel|statsPanel/i.test(x.key)), "展开偏好不在设置目录");
  assert.ok(!Object.prototype.hasOwnProperty.call(T.getS().settings, "statsPanels"));
  assert.equal(JSON.stringify(T.buildExport()).includes(STATS_KEY), false);
  assert.equal(JSON.stringify(T.buildExport()).includes("statsForecastPanel"), false);
  const n = T.normalizeState(T.getS());
  assert.ok(!Object.keys(n.settings).some(k => /statsPanel/i.test(k)));
});

/* ---------------- 9. 结构与样式静态门（320 首屏层级、动作区常量） ---------------- */
test('F1 index.html 外观控件与统计 details 结构完整，统计面板默认展开', () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const id of ["cardDensitySeg", "readingOrderControls", "readingOrderList", "readingOrderSummary",
    "showCardMeta", "showCardStage", "showCardPos", "secondaryActionsControls", "secondaryActionChoices",
    "secondaryActionsSummary"]) {
    assert.ok(html.includes('id="' + id + '"'), "缺少外观控件 #" + id);
  }
  const details = [...html.matchAll(/<details class="panel stats-details"[^>]*>/g)].map(m => m[0]);
  assert.equal(details.length, 6);
  for (const tag of details) assert.ok(/ open[ >]/.test(tag), "统计面板默认展开，用户收起状态由设备键恢复");
});

test('F1 样式保留动作区高度常量、无嵌套 :has，并含 320 大字首屏压缩与 F1 控件样式', () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  assert.ok(css.includes("#card:has(.word-face) + #acts { min-height: 156px; }"));
  assert.ok(css.includes("#card:has(.word-face) + #acts { min-height: 146px; }"));
  assert.ok(css.includes("#card:has(.word-face) + #acts { min-height: 151px; }"));
  assert.ok(css.includes("#v-study > #hint { min-height: 40px; }"));
  assert.ok(!/:has\([^)]*:has\(/.test(css), "禁止嵌套 :has（A-40）");
  assert.ok(css.includes("#acts.revealed > .acts-secondary"), "缺少固定次级动作容器样式");
  assert.ok(css.includes('[data-secondary-count="2"][data-has-more="1"]'), "2 固定 + 更多需要同一行的 3 列布局");
  assert.ok(css.includes("position: absolute") && css.includes(".acts-more-menu"), "更多操作菜单必须是绝对定位浮层，不占行高");
  assert.ok(!/data-secondary-count="2"\] > \.acts-more \{ grid-column: 1 \/ -1/.test(css), "2 固定时不得让更多操作单独占下一行");
  assert.ok(css.includes(".reading-order-row") && css.includes(".secondary-action-choice"));
  const narrow = css.slice(css.indexOf("@media (max-width: 400px)"));
  assert.ok(narrow.includes("#card.has-answer .answer"), "320 首屏层级需要压缩揭示态留白");
  assert.ok(css.includes("#card.card-compact"), "缺少卡片密度样式");
});

console.log(`\nF1 阅读布局回归：${passed} 组通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
