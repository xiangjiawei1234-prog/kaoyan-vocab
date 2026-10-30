/**
 * 背诵显示模式：真实index DOM桩 + app.js，小词库夹具；不复制业务逻辑。
 * 校验偏好迁移、存储、备份与切换不改变学习现场，几何/隐藏内容由浏览器专项验证。
 * node --max-old-space-size=512 js/test-study-modes.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const fixtureRows = [
  ["remember", "rɪˈmembə", "v. 记得", 1, 1, 72, 20, "I remember the first day.", "自编", 1, "remembers, remembering, remembered, remembered"],
  ["paper", "ˈpeɪpə", "n. 纸；试卷", 0, 2, 64, 18, "Write it on paper.", "自编", 1, "papers"],
  ["quiet", "ˈkwaɪət", "adj. 安静的", 2, 3, 51, 15, "It was a quiet room.", "自编", 1, ""],
  ["focus", "ˈfəʊkəs", "v. 集中注意力", 1, 4, 43, 12, "Focus on one word.", "自编", 1, "focuses, focusing, focused, focused"],
  ["learn", "lɜːn", "v. 学习", 1, 5, 32, 11, "We learn every day.", "自编", 1, "learns, learning, learned, learned"],
  ["rest", "rest", "n. 休息", 0, 6, 20, 8, "Take a short rest.", "自编", 1, "rests"],
  ["page", "peɪdʒ", "n. 页", 0, 7, 12, 5, "Turn the page.", "自编", 1, "pages"],
  ["book", "bʊk", "n. 书", 0, 8, 9, 4, "This is my book.", "自编", 1, "books"]
];
const words = `window.WORDS_RAW=${JSON.stringify(fixtureRows)};
window.WORDS_CET4=window.WORDS_RAW.map(x=>x.slice());
window.WORDS_CET6=window.WORDS_RAW.map(x=>x.slice());
window.WORDS_COMBINED=window.WORDS_RAW.map(x=>x.slice());
window.WORD_BOOK_META=Object.fromEntries(['kaoyan','cet4','cet6','combined'].map(id=>[id,{dataVersion:1,paperCount:20}]));`;
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

const DEVICE_KEY = "vocab_device_preferences_v1";
const JOURNAL_KEY = "vocab_preferences_journal_v1";
const DEFAULT_BOOK_KEY = "vocab_default_book_v1";
const PAGE_BOOK_KEY = "vocab_page_book_v1";
const PAGE_MODE_KEY = "vocab_page_book_mode_v1";
const ACTIVE_KEY = "vocab_active_book_v1";
const BOOK_KEYS = { kaoyan: "kaoyan_vocab_v1", cet4: "cet4_vocab_v1", cet6: "cet6_vocab_v1", combined: "combined_vocab_v1" };
const BOOK_NAMES = { kaoyan: "考研英语", cet4: "英语四级", cet6: "英语六级", combined: "综合词书" };
const PREFERENCE_FIELDS = ["theme", "keys", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys",
  "fontSize", "voiceURI", "speechRate", "actionKeys", "gestures", "actionLayout",
  "cardDensity", "readingOrder", "showCardMeta", "showCardStage", "showCardPos", "secondaryActions"];

const clone = value => JSON.parse(JSON.stringify(value));

/* ------------------------------------------------------------------ DOM 桩 */
function browser(opts = {}) {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {
        setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] || ''; },
        removeProperty(name) { const value = this[name] || ''; delete this[name]; return value; }
      }; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.hidden = false; this.disabled = false; this.files = []; this.placeholder = '';
      this.offsetWidth = 240; this.offsetHeight = 120; this.tabIndex = 0; this.selectedIndex = 0;
      const classes = () => (this.attrs.class || '').split(/\s+/).filter(Boolean);
      this.classList = {
        contains: c => classes().includes(c),
        add: (...cs) => { this.attrs.class = [...new Set(classes().concat(cs))].join(' '); },
        remove: (...cs) => { this.attrs.class = classes().filter(c => !cs.includes(c)).join(' '); },
        toggle: (c, force) => { const yes = force === undefined ? !classes().includes(c) : !!force;
          if (yes) this.classList.add(c); else this.classList.remove(c); return yes; }
      };
    }
    get id() { return this.attrs.id || ''; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set textContent(value) { this.detachChildren(); this._html = ''; this._text = String(value); }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this.detachChildren(); this._text = ''; this._html = String(value);
      parse(this._html, this);
    }
    detachChildren() {
      if (doc?.activeElement !== this && this.contains(doc?.activeElement)) doc.activeElement = doc.body;
      for (const n of this.children) n.parentNode = null;
      this.children = [];
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (['hidden', 'disabled', 'checked'].includes(name)) this[name] = true;
      if (name === 'value') this.value = String(value);
    }
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
    removeAttribute(name) { delete this.attrs[name]; if (['hidden', 'disabled', 'checked'].includes(name)) this[name] = false; }
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    closest(selector) { for (let n = this; n && n !== doc; n = n.parentNode) if (matches(n, selector)) return n; return null; }
    querySelectorAll(selector) { const out = []; const walk = node => { for (const n of node.children) { if (matches(n, selector)) out.push(n); walk(n); } }; walk(this); return out; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    removeEventListener() {}
    focus() { doc.activeElement = this; }
    get isConnected() { return !!(doc && doc.contains(this)); }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 52, bottom: 52, right: 100 }; }
    getClientRects() { return [{ left: 0, top: 0, width: 100, height: 52 }]; }
    scrollIntoView() {}
    setPointerCapture() {} releasePointerCapture() {}
    dispatch(type, data = {}) {
      const event = { target: this, key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
        repeat: false, isComposing: false, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...data };
      for (let n = this; n; n = n.parentNode) {
        event.currentTarget = n;
        if (n['on' + type]) n['on' + type](event);
        for (const fn of n.events.get(type) || []) fn(event);
        if (event.stopped) break;
      }
      return event;
    }
    click() { if (!this.disabled) return this.dispatch('click', { detail: 1 }); }
  }
  function simple(n, selector) {
    if (n.tagName === '#TEXT') return false;
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
    return selector.split(',').some(part => {
      const bits = part.trim().split(/\s+(?![^\[]*\])/); let current = n;
      if (!simple(current, bits.pop())) return false;
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
      if (m[0].startsWith('<!')) continue;
      if (m[3] !== undefined) { stack.at(-1).appendChild(new Node('#text', decode(m[3]))); continue; }
      const tag = m[1].toLowerCase();
      if (m[0].startsWith('</')) { while (stack.length > 1) { const n = stack.pop(); if (n.tagName.toLowerCase() === tag) break; } continue; }
      const n = new Node(tag);
      for (const a of m[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) n.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      stack.at(-1).appendChild(n);
      if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) stack.push(n);
    }
  }
  doc = new Node('#document'); parse(html, doc);
  doc.body = doc.querySelector('body'); doc.documentElement = doc.querySelector('html');
  doc.documentElement.dataset = {};
  for (const select of doc.querySelectorAll('select')) {
    const option = select.querySelector('[selected]') || select.querySelector('option');
    select.value = option?.getAttribute('value') ?? option?.textContent ?? '';
  }
  doc.activeElement = doc.body; doc.visibilityState = 'visible';
  doc.createElement = tag => new Node(tag);
  doc.createTextNode = text => new Node('#text', text);
  const fullscreen = { entered: 0, exited: 0 };
  if (opts.fullscreen) {
    doc.fullscreenEnabled = true;
    doc.fullscreenElement = null;
    doc.documentElement.requestFullscreen = async () => {
      fullscreen.entered++;
      if (opts.fullscreenReject) throw new Error('fullscreen permission denied');
      doc.fullscreenElement = doc.documentElement;
      doc.dispatch('fullscreenchange');
    };
    doc.exitFullscreen = async () => {
      fullscreen.exited++;
      doc.fullscreenElement = null;
      doc.dispatch('fullscreenchange');
    };
  }

  const storage = opts.storage || new Map();
  const session = opts.session || new Map();
  const failWrite = opts.failWrite || new Set();
  const failRead = opts.failRead || new Set();
  const failRemove = opts.failRemove || new Set();
  if (opts.initial) for (const [k, v] of Object.entries(opts.initial)) storage.set(k, typeof v === "string" ? v : JSON.stringify(v));
  if (opts.initialSession) for (const [k, v] of Object.entries(opts.initialSession)) session.set(k, String(v));
  const intervals = [], winHandlers = new Map(), blobs = [];
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [opts.now || new Date(2026, 9, 24, 12, 0, 0).getTime()])); }
    static now() { return opts.now || new Date(2026, 9, 24, 12, 0, 0).getTime(); }
  }
  const localStorageStub = {
    getItem: k => { if (failRead.has(k)) throw new Error("read blocked"); return storage.has(k) ? storage.get(k) : null; },
    setItem: (k, v) => { if (failWrite.has(k)) throw new Error("quota"); storage.set(k, String(v)); },
    removeItem: k => { if (failRemove.has(k)) throw new Error("remove blocked"); storage.delete(k); },
    clear: () => storage.clear()
  };
  const sessionStorageStub = {
    getItem: k => session.has(k) ? session.get(k) : null,
    setItem: (k, v) => { if (opts.sessionFails) throw new Error("session disabled"); session.set(k, String(v)); },
    removeItem: k => session.delete(k),
    clear: () => session.clear()
  };
  const window = {
    document: doc, location: { protocol: 'https:', href: 'https://vocab.test/' },
    sessionStorage: sessionStorageStub, localStorage: localStorageStub,
    addEventListener(type, fn) { if (!winHandlers.has(type)) winHandlers.set(type, []); winHandlers.get(type).push(fn); },
    removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getSelection: () => ({ toString: () => '' }),
    getComputedStyle: () => ({ fontSize: '32px' }), innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame: fn => { fn(); return 0; }, cancelAnimationFrame() {},
    scrollTo() {}, print() {}, navigator: { language: "zh-CN" },
    speechSynthesis: { cancel() {}, speak() {}, getVoices() { return []; } },
    SpeechSynthesisUtterance: class {}
  };
  const context = vm.createContext({
    window, document: doc, console, Date: ClockDate,
    localStorage: localStorageStub, sessionStorage: sessionStorageStub,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class { constructor(parts) { this.parts = parts || []; blobs.push(this); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, FileReader: class {},
    performance: { now: () => ClockDate.now() }, structuredClone: clone,
    navigator: window.navigator, alert() {}, prompt() {}, SpeechSynthesisUtterance: class {},
    speechSynthesis: window.speechSynthesis
  });
  vm.runInContext(words, context, { filename: 'words-data.js' });
  vm.runInContext(app, context, { filename: 'app.js' });
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, window, doc, storage, session, failWrite, failRead, failRemove, intervals, blobs, fullscreen,
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    text: s => (doc.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim(),
    device() { const raw = storage.get(DEVICE_KEY); return raw ? JSON.parse(raw) : null; },
    deviceRaw() { return storage.get(DEVICE_KEY); },
    journal() { const raw = storage.get(JOURNAL_KEY); return raw ? JSON.parse(raw) : null; },
    stateRaw(bookId) { return storage.get(BOOK_KEYS[bookId]); },
    stateOf(bookId) { const raw = storage.get(BOOK_KEYS[bookId]); return raw ? JSON.parse(raw) : null; },
    storageEvent(key) {
      const value = storage.has(key) ? storage.get(key) : null;
      for (const fn of winHandlers.get("storage") || []) {
        fn({ key, newValue: value, oldValue: null, storageArea: localStorageStub, url: window.location.href });
      }
    },
    answerAllKnown(limit = 200) {
      let guard = 0;
      while (T.cur != null && guard++ < limit) { T.judge(true); T.tryNext(); }
      return guard;
    }
  };
}

/* ---------------- 模式合同：只改变呈现，不改变学习 ---------------- */
const MODES = ['immersive', 'simple', 'standard'];
const DEFAULT_MODE = 'standard';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (error) { failed++; console.error('FAIL  ' + name + ': ' + (error.stack || error)); }
}
async function asyncTest(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (error) { failed++; console.error('FAIL  ' + name + ': ' + (error.stack || error)); }
}
function setup(b, {due = 0, cap = 100, groupSize = 4} = {}) {
  const T = b.T, s = T.getS(), now = b.window.Date?.now?.() || new Date(2026, 9, 24, 12).getTime();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {}; s.extraDay = {}; s.reviewDay = {};
  Object.assign(s.settings, {dailyNew: 4, groupSize, fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: 'primary', order: 'freq', backlogGuard: false, autoSpk: false});
  for (let i = 0; i < due; i++) s.progress[i] = [1, now - 1000, 1, 0, now - 86400000];
  T.setReviewCap(cap); T.startSession('main'); T.show('study'); return T;
}
const scene = T => {
  const s = clone(T.getS()), settings = {...s.settings}; delete settings.studyMode;
  return JSON.stringify({Q: T.Q, qi: T.qi, cur: T.cur, phase: T.phase, verdict: T.verdict,
    answered: T.answered, answerChanges: T.answerChanges, plan: T.getPlan(),
    progress: s.progress, days: s.days, stars: s.stars, proficient: s.proficient,
    review: s.reviewDay, extra: s.extraDay, time: s.timeSec, settings});
};
const profileApi = b => b.window.__vocabSettingsProfiles;
const assertMode = (b, mode) => {
  assert.equal(b.T.getStudyMode(), mode);
  assert.equal(b.T.getS().settings.studyMode, mode);
  assert.equal(b.doc.documentElement.dataset.studyMode, mode);
};

test('新用户与旧记录缺字段均默认标准，保留原有页面信息与其他偏好', () => {
  const b = browser(); assertMode(b, DEFAULT_MODE);
  const old = clone(b.T.getS()); delete old.settings.studyMode;
  old.settings.fontSize = 'large'; old.settings.dailyNew = 37;
  const normalized = b.T.normalizeState(old, 'kaoyan');
  assert.equal(normalized.settings.studyMode, DEFAULT_MODE);
  assert.equal(normalized.settings.fontSize, 'large'); assert.equal(normalized.settings.dailyNew, 37);
});

test('三个合法模式规范化保留，非法字段只修自身', () => {
  const b = browser();
  for (const mode of MODES) {
    const state = clone(b.T.getS()); state.settings.studyMode = mode;
    assert.equal(b.T.normalizeState(state, 'kaoyan').settings.studyMode, mode);
  }
  for (const value of ['compact', '', null, 1, true, {}, []]) {
    const state = clone(b.T.getS()); state.settings.studyMode = value; state.settings.showEx = false;
    const normalized = b.T.normalizeState(state, 'kaoyan');
    assert.equal(normalized.settings.studyMode, DEFAULT_MODE); assert.equal(normalized.settings.showEx, false);
  }
});

test('模式即时切换不改未揭示组、配额、冻结计划或原有卡片偏好', () => {
  const b = browser(), T = setup(b), before = scene(T);
  for (const mode of MODES) {
    const r = T.setStudyMode(mode); assert.equal(r.ok, true, r.error); assertMode(b, mode);
    assert.equal(scene(T), before); assert.equal(T.hasPendingScopeSettings(), false);
  }
});

test('非法模式写入拒绝且整份内存与存储保持', () => {
  const b = browser(), T = setup(b), before = JSON.stringify(T.getS()), disk = [...b.storage];
  for (const value of ['quiet', '', null, 7, {}, []]) {
    assert.equal(T.setStudyMode(value).ok, false);
    assert.equal(JSON.stringify(T.getS()), before); assert.deepEqual([...b.storage], disk);
  }
});

test('已揭示态切换保留判定、一次改判保护和撤销能力', () => {
  const b = browser(), T = setup(b);
  T.judge(false); const first = scene(T);
  for (const mode of MODES) { assert.equal(T.setStudyMode(mode).ok, true); assert.equal(scene(T), first); }
  T.judge(true); assert.equal(T.verdict, true); assert.equal(T.answerChanges, 1);
  T.setStudyMode('immersive'); const changed = scene(T); T.setStudyMode('standard'); assert.equal(scene(T), changed);
  T.undo(); assert.equal(T.verdict, false); assert.equal(T.answered, 1, '撤销改判不撤销首次判定');
});

test('首页与设置模式按钮同步aria-pressed，真实控件进入合法写入口', () => {
  const b = browser(), T = setup(b);
  for (const mode of MODES) {
    const button = b.query('#studyModeBar [data-study-mode="' + mode + '"]'); assert.ok(button);
    button.click(); assertMode(b, mode);
    for (const root of ['#studyModeBar', '#studyModeSettings']) {
      const buttons = b.all(root + ' [data-study-mode]'); assert.equal(buttons.length, 3);
      assert.equal(buttons.filter(x => x.getAttribute('aria-pressed') === 'true').length, 1);
      assert.equal(b.query(root + ' [data-study-mode="' + mode + '"]').getAttribute('aria-pressed'), 'true');
    }
  }
  T.show('set'); b.query('#studyModeSettings [data-study-mode="simple"]').click(); assertMode(b, 'simple');
  assert.equal(b.doc.documentElement.dataset.studyView, 'set');
});

test('模式只在背诵页生效：跨视图反映活动页面且不改设置/词表现场', () => {
  const b = browser(), T = setup(b); T.setStudyMode('immersive'); const before = scene(T);
  for (const view of ['list', 'stats', 'set', 'study']) {
    T.show(view); assert.equal(b.doc.documentElement.dataset.studyView, view); assertMode(b, 'immersive');
    assert.equal(scene(T), before);
  }
});

test('旧设备偏好目录缺模式兼容读取，不判损坏、不覆写原文', () => {
  const first = browser(), legacy = clone(first.device()); delete legacy.shared.studyMode;
  legacy.shared.theme = 'dark'; const raw = JSON.stringify(legacy);
  const b = browser({initial: {[DEVICE_KEY]: raw}});
  assert.equal(b.T.getPreferenceOwnership().status, 'ok'); assertMode(b, DEFAULT_MODE);
  assert.equal(b.T.getS().settings.theme, 'dark'); assert.equal(b.deviceRaw(), raw);
});

test('模式支持设备通用、本书覆盖与恢复跟随', () => {
  const b = browser(), T = setup(b);
  assert.equal(T.applyPreferencePatch({studyMode: 'simple'}, {target: 'device'}).ok, true);
  T.switchBook('cet4'); assertMode(b, 'simple');
  assert.equal(T.applyPreferencePatch({studyMode: 'immersive'}, {target: 'book'}).ok, true);
  T.switchBook('kaoyan'); assertMode(b, 'simple');
  assert.equal(T.applyPreferencePatch({studyMode: 'standard'}, {target: 'device'}).ok, true);
  T.switchBook('cet4'); assertMode(b, 'immersive');
  assert.equal(T.setPreferenceInheritance(['studyMode'], true).ok, true); assertMode(b, 'standard');
});

test('v3备份包含每书有效模式，导出仍只读', () => {
  const b = browser(), T = setup(b); T.setStudyMode('simple');
  const before = JSON.stringify(T.getS()), raw = b.stateRaw('kaoyan'), out = T.buildExport();
  assert.equal(out.version, 3); assert.equal(out.books.kaoyan.settings.studyMode, 'simple');
  for (const book of Object.values(out.books)) assert.ok(MODES.includes(book.settings.studyMode));
  assert.equal(JSON.stringify(T.getS()), before); assert.equal(b.stateRaw('kaoyan'), raw);
});

test('外观方案保存模式，旧方案缺模式仍可合法预览', () => {
  const b = browser(), T = setup(b), P = profileApi(b); T.setStudyMode('immersive');
  assert.equal(P.saveSettingsProfile('专注阅读', ['appearance']).ok, true);
  const out = P.exportSettingsProfiles(); assert.equal(out.ok, true);
  const current = out.envelope.profiles[0]; assert.equal(current.settings.studyMode, 'immersive');
  const legacy = clone(current); delete legacy.settings.studyMode;
  assert.equal(P.previewSettingsProfile(legacy, ['appearance']).ok, true);
  const invalid = clone(current); invalid.settings.studyMode = 'ultra';
  assert.equal(P.previewSettingsProfile(invalid, ['appearance']).ok, false);
});

test('保存失败不改变已接受模式、原组与存储；重试可成功', () => {
  const b = browser(), T = setup(b); T.setStudyMode('simple');
  const before = scene(T), mode = T.getStudyMode(), disk = b.stateRaw('kaoyan'), prefs = b.deviceRaw();
  b.failWrite.add(BOOK_KEYS.kaoyan);
  assert.equal(T.setStudyMode('immersive').ok, false); assertMode(b, mode); assert.equal(scene(T), before);
  assert.equal(b.stateRaw('kaoyan'), disk); assert.equal(b.deviceRaw(), prefs);
  b.failWrite.delete(BOOK_KEYS.kaoyan); assert.equal(T.setStudyMode('immersive').ok, true); assertMode(b, 'immersive');
});

test('刷新保留模式与当前合法未完成组，不重复提交判定或额度', () => {
  const b = browser(), T = setup(b); T.judge(true); T.setStudyMode('immersive'); T.persistSessionSnapshot();
  const before = scene(T), reloaded = browser({storage: b.storage, session: b.session});
  assertMode(reloaded, 'immersive'); assert.equal(scene(reloaded.T), before);
  assert.ok(reloaded.T.getResumeNotice(), '合法刷新恢复提供现场提示');
});

test('额度暂停时切换模式保留暂停原因与现场', () => {
  const b = browser(), T = setup(b, {due: 2, cap: 1, groupSize: 2});
  T.judge(true); T.tryNext(); assert.equal(T.isCapPaused(), true); const before = scene(T);
  for (const mode of MODES) { assert.equal(T.setStudyMode(mode).ok, true); assert.equal(T.isCapPaused(), true); assert.equal(scene(T), before); }
});

test('休息、完成页切换仍保持各自状态，显式继续不被模式阻断', () => {
  const b = browser(), T = setup(b); T.judge(true); T.saveAndRest(); const rested = scene(T);
  for (const mode of MODES) { assert.equal(T.setStudyMode(mode).ok, true); assert.equal(T.isResting(), true); assert.equal(scene(T), rested); }
  assert.equal(T.resumeFromRest(), true); assert.equal(T.isResting(), false);
  b.answerAllKnown(); assert.equal(T.cur, null); const completed = scene(T);
  T.setStudyMode('immersive'); assert.equal(scene(T), completed);
  assert.ok(b.query('#again'), '完成页明确继续入口保留');
});

test('按类恢复外观只恢复标准模式，不重建当前组或恢复已关闭快捷键', () => {
  const b = browser(), T = setup(b);
  T.applyPreferencePatch({singleCharKeys: false}, {target: 'book'}); T.setStudyMode('immersive');
  const before = JSON.stringify({Q:T.Q,cur:T.cur,qi:T.qi,plan:T.getPlan(),progress:T.getS().progress});
  assert.equal(T.resetSettingsClass('appearance').ok, true); assertMode(b, DEFAULT_MODE);
  assert.equal(T.getS().settings.singleCharKeys, false);
  assert.equal(JSON.stringify({Q:T.Q,cur:T.cur,qi:T.qi,plan:T.getPlan(),progress:T.getS().progress}), before);
});

test('工具菜单展开时F/J/空格与CtrlZ不穿透，Esc关闭后F可正常判定', () => {
  const b = browser(), T = setup(b); T.judge(true); T.tryNext(); T.setStudyMode('immersive');
  const tools = b.query('#studyTools'), summary = tools.querySelector('summary');
  tools.open = true; tools.ontoggle?.(); summary.focus(); const before = scene(T);
  for (const [key, code] of [['f', 'KeyF'], ['j', 'KeyJ'], [' ', 'Space']]) {
    b.doc.dispatch('keydown', {key, code, target: summary}); assert.equal(scene(T), before);
  }
  b.doc.dispatch('keydown', {key: 'z', code: 'KeyZ', ctrlKey: true, target: summary});
  assert.equal(scene(T), before, '存在可撤销判定时菜单CtrlZ仍不能撤销学习');
  b.doc.dispatch('keydown', {key: 'Escape', code: 'Escape', target: summary});
  assert.equal(tools.open, false); assert.equal(scene(T), before);
  b.doc.dispatch('keydown', {key: 'f', code: 'KeyF', target: summary});
  assert.equal(T.verdict, true);
});

test('完成页工具菜单展开时暂停自动续背资格，关闭后恢复', () => {
  const b = browser(), T = setup(b, {groupSize: 2});
  assert.equal(T.setAutoResume({enabled: true, threshold: 1, idleMs: 30000, countdownMs: 3000}).ok, true);
  b.answerAllKnown(); assert.equal(T.cur, null); assert.equal(T.getAutoResumeState().eligible, true);
  const tools = b.query('#studyTools'); tools.open = true; tools.ontoggle?.();
  assert.equal(T.getAutoResumeState().eligible, false);
  tools.open = false; assert.equal(T.getAutoResumeState().eligible, true);
});

test('模式切换不取消同词正在请求的朗读，不重建词卡DOM', () => {
  const b = browser(), T = setup(b), word = b.query('#card .word');
  assert.equal(T.speak(T.getW()[T.cur].w), true);
  const speech = JSON.stringify(T.getSpeechPlayback());
  for (const mode of MODES) {
    assert.equal(T.setStudyMode(mode).ok, true);
    assert.equal(JSON.stringify(T.getSpeechPlayback()), speech);
    assert.equal(b.query('#card .word'), word, '只改变显示方式，不重新插入词卡');
  }
});

await asyncTest('先沉浸后直接全屏、外部退出及反向顺序均同步全部入口且不改现场', async () => {
  const b = browser({fullscreen: true}), T = setup(b);
  T.setStudyMode('immersive');
  const before = scene(T), disk = [...b.storage], card = b.query('#card .word');
  const direct = b.query('#studyFullscreen'), top = b.query('#btnFullscreen');
  assert.ok(direct && !direct.hidden, '沉浸模式旁直接提供全屏按钮');
  await direct.onclick();
  assert.equal(b.fullscreen.entered, 1); assert.equal(b.doc.fullscreenElement, b.doc.documentElement);
  for (const button of [direct, top]) {
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.getAttribute('aria-label'), '退出全屏显示');
  }
  assert.equal(direct.querySelector('[data-fullscreen-label]').textContent, '退出');
  assert.equal(b.text('#studyTools [data-study-proxy="btnFullscreen"]'), '退出全屏显示');
  b.doc.fullscreenElement = null; b.doc.dispatch('fullscreenchange');
  assert.equal(direct.getAttribute('aria-pressed'), 'false', '浏览器Esc等外部退出也同步');
  assert.equal(direct.querySelector('[data-fullscreen-label]').textContent, '全屏');
  await direct.onclick(); await top.onclick();
  assert.equal(b.fullscreen.exited, 1); assert.equal(b.doc.fullscreenElement, null);
  assert.equal(scene(T), before); assert.deepEqual([...b.storage], disk); assert.equal(b.query('#card .word'), card);
  T.setStudyMode('standard'); await top.onclick(); T.setStudyMode('immersive');
  assert.equal(b.doc.fullscreenElement, b.doc.documentElement, '全屏后切沉浸保留全屏');
  assert.equal(direct.getAttribute('aria-pressed'), 'true');
  await direct.onclick(); assert.equal(b.doc.fullscreenElement, null);
});

await asyncTest('全屏能力缺失时三个入口隐藏，拒绝时提示并保留沉浸现场', async () => {
  const unsupported = browser();
  for (const selector of ['#btnFullscreen', '#studyFullscreen', '#studyTools [data-study-proxy="btnFullscreen"]']) {
    assert.equal(unsupported.query(selector).hidden, true, selector);
  }
  const b = browser({fullscreen: true, fullscreenReject: true}), T = setup(b);
  T.setStudyMode('immersive'); const before = scene(T), disk = [...b.storage];
  await b.query('#studyFullscreen').onclick();
  assert.equal(b.doc.fullscreenElement, null); assert.equal(b.query('#studyFullscreen').getAttribute('aria-pressed'), 'false');
  assert.ok(b.text('#toast').includes('未能切换全屏显示'));
  assert.equal(scene(T), before); assert.deepEqual([...b.storage], disk); assertMode(b, 'immersive');
});

console.log(`\n背诵模式：${passed} 通过 / ${failed} 失败`);
process.exitCode = failed ? 1 : 0;
