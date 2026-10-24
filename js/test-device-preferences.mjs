/**
 * O1 设备通用 / 本书覆盖偏好归属 + 本页词书 / 下次默认 / 跨页跟随（真实 app.js + DOM 桩）
 *
 * 依据：docs/输入与偏好下一步规格-2026-10-24.md §6、§7、§8.1；task-1。
 * 做法：解析真实 index.html 建 DOM 桩，vm 沙箱载入真实四词书数据与真实 js/app.js；
 * 断言只走真实业务入口（window.__vocab / 真实 DOM 控件），不复制实现。
 *
 * 覆盖：
 *  - 一次性迁移：四书旧值全部保留为本书覆盖；shared=DEF；写失败安全降级 + 重试；
 *  - 设备键损坏/高版本保留原文禁写；旧 version:1 缺 F1 字段兼容解码；
 *  - shared 编辑跨书生效 / 本书覆盖保留 / 跟随设备立即生效 / “设为设备通用”不动其他书覆盖；
 *  - 小事务：设备键+主键全成功才提交，失败整份回滚；回滚失败保留日志并启动提示恢复；
 *  - 跨标签：设备键事件只重解析未覆盖字段（不换书/不清撤销/不关浮层），主记录设置采纳；
 *  - 备份 v3：导出每书实际有效偏好且只读；导入把被导入书标本书覆盖、shared 不变、失败整份回滚；
 *  - 本页词书 / 刷新保留 / 下次默认 / 旧 ACTIVE 迁移 / local 忽略 / follow 有现场只提示；
 *  - 设置页归属控件动态注入与切换；词书浮层“仅本页/同步到跟随页面/设为下次默认”。
 *
 * 运行：node --max-old-space-size=512 js/test-device-preferences.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const words = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");
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
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
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
  for (const file of ['cet-words-data.js', 'combined-words-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), context, { filename: file });
  }
  vm.runInContext(app, context, { filename: 'app.js' });
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, window, doc, storage, session, failWrite, failRead, failRemove, intervals, blobs,
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

/* ------------------------------------------------------------------ 断言辅助 */
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (error) {
    failed++; failures.push({ name, message: error && error.message || String(error) });
    console.log(`FAIL  ${name}: ${error && error.stack || error}`);
  }
}
function oldState(settings, extra = {}) {
  return Object.assign({ settings: settings || {}, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 }, extra);
}
const themeOf = (b, book) => (book === b.T.getBook() ? b.T.getS().settings.theme : b.T.getBookState(book).settings.theme);

/* ================================================================== 1. 迁移 */
test("迁移：四书旧偏好全部保留为本书覆盖，shared=DEF，不改已有主记录", () => {
  const raw4 = JSON.stringify(oldState({ dailyNew: 9, theme: "dark", fontSize: "large" }));
  const raw6 = JSON.stringify(oldState({ dailyNew: 3, theme: "light", showPh: false }));
  const initial = {
    [BOOK_KEYS.kaoyan]: raw4, [BOOK_KEYS.cet4]: raw6,
    [BOOK_KEYS.cet6]: oldState({ order: "wrong" }), [BOOK_KEYS.combined]: oldState({ kyOnly: true })
  };
  const b = browser({ initial });
  const dev = b.device();
  assert.ok(dev, "应创建设备偏好键");
  assert.equal(dev.kind, "vocab-device-preferences");
  assert.equal(dev.version, 1);
  assert.deepEqual(Object.keys(dev.shared).sort(), PREFERENCE_FIELDS.slice().sort(), "shared 覆盖全部偏好字段");
  assert.equal(dev.shared.theme, "light", "shared 使用 DEF 默认，不选任何书作基准");
  assert.equal(dev.shared.fontSize, "standard");
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) {
    assert.deepEqual(dev.overrides[id], PREFERENCE_FIELDS, `${id} 已有旧主记录 → 19 项全部本书覆盖`);
    const seeded = initial[BOOK_KEYS[id]];
    const expected = typeof seeded === "string" ? seeded : JSON.stringify(seeded);
    assert.equal(b.stateRaw(id), expected, `${id} 主记录原文不得被迁移改写`);
  }
  assert.equal(b.T.getS().settings.theme, "dark", "考研旧主题保留");
  assert.equal(b.T.getS().settings.fontSize, "large");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.theme, "light", "四级保留自己的浅色");
  assert.equal(b.T.getS().settings.showPh, false);
  assert.equal(b.T.getS().settings.fontSize, "standard", "四级旧记录缺字号 → 自己的兼容默认，不被考研覆盖");
  b.T.switchBook("cet6");
  assert.equal(b.T.getS().settings.order, "wrong", "六级自己的学习设置保留");
});

test("新用户迁移：无旧记录 → shared=DEF、无本书覆盖，编辑偏好跨书共享", () => {
  const b = browser();
  const dev = b.device();
  assert.equal(dev.shared.theme, "light");
  for (const id of ["kaoyan", "cet4", "cet6", "combined"]) assert.deepEqual(dev.overrides[id], [], `${id} 无覆盖`);
  const own = b.T.getPreferenceOwnership();
  assert.equal(own.usable, true);
  assert.deepEqual(clone(own.currentOverrides), []);
  const result = b.T.applyPreferencePatch({ theme: "dark", fontSize: "large" }, { target: "device" });
  assert.equal(result.ok, true, result.error);
  assert.equal(b.device().shared.theme, "dark");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.theme, "dark", "设备通用值跨书生效");
  assert.equal(b.T.getS().settings.fontSize, "large");
});

test("迁移写失败：保留本页旧值、明确提示归属未保存、安全降级每书独立，可重试", () => {
  const initial = { [BOOK_KEYS.kaoyan]: oldState({ theme: "dark" }), [BOOK_KEYS.cet4]: oldState({ theme: "auto" }) };
  const failWrite = new Set([DEVICE_KEY]);
  const b = browser({ initial, failWrite });
  const dev = b.T.getPreferenceOwnership();
  assert.equal(dev.status, "write-failed");
  assert.equal(dev.usable, true, "内存镜像仍可用于解析旧书各自的值");
  assert.equal(b.T.getS().settings.theme, "dark", "当前书保留自己的旧值");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.theme, "auto", "安全降级为每书独立，不执行覆盖式 carry");
  failWrite.delete(DEVICE_KEY);
  const retried = b.T.retryDevicePreferenceWrite();
  assert.equal(retried.ok, true, retried.error);
  assert.equal(b.device().shared.theme, "light", "重试后写入 shared=DEF，旧书覆盖仍保留各自旧值");
  assert.deepEqual(b.device().overrides.kaoyan, PREFERENCE_FIELDS);
});

test("设备键缺原有必填偏好必须拒绝，只允许明确F1新增字段补缺", () => {
  const valid=browser().device(),f1=['cardDensity','readingOrder','showCardMeta','showCardStage','showCardPos','secondaryActions'];
  for(const field of PREFERENCE_FIELDS.filter(x=>!f1.includes(x))){
    const damaged=clone(valid);delete damaged.shared[field];const raw=JSON.stringify(damaged);
    const b=browser({initial:{[DEVICE_KEY]:raw,[BOOK_KEYS.kaoyan]:oldState({theme:'dark'})}});
    assert.equal(b.T.getPreferenceOwnership().status,'damaged','缺少原字段'+field+'不能当成旧版本');
    assert.equal(b.deviceRaw(),raw,'损坏原文不被默认值覆盖');
    assert.equal(b.T.getS().settings.theme,'dark','安全使用已有本书偏好');
  }
});

test("设备键损坏/高版本：保留原文禁写，各书回退自己的 settings", () => {
  for (const raw of ['{broken', JSON.stringify({ kind: "vocab-device-preferences", version: 9, shared: {}, overrides: {} })]) {
    const b = browser({ initial: {
      [DEVICE_KEY]: raw,
      [BOOK_KEYS.kaoyan]: oldState({ theme: "dark", fontSize: "large" }),
      [BOOK_KEYS.cet4]: oldState({ theme: "auto" })
    }});
    const own = b.T.getPreferenceOwnership();
    assert.ok(["damaged", "unsupported"].includes(own.status), `状态应为损坏/高版本，实际 ${own.status}`);
    assert.equal(b.deviceRaw(), raw, "损坏/高版本原文必须保留");
    assert.equal(b.T.getS().settings.theme, "dark", "当前书仍读自己的 settings");
    b.T.switchBook("cet4");
    assert.equal(b.T.getS().settings.theme, "auto", "另一书同样读自己的 settings");
    const changed = b.T.applyPreferencePatch({ theme: "light" }, { target: "device" });
    assert.equal(changed.ok, true, "归属不可用时降级为只改本书");
    assert.equal(changed.fallback, true);
    assert.equal(b.deviceRaw(), raw, "禁写设备键：原文一字不改");
    assert.equal(b.stateOf("cet4").settings.theme, "light", "降级后本书偏好已落盘");
  }
});

test("旧 version:1 键缺 F1 新增字段：兼容补 DEF，原 shared/覆盖标记完整保留，不写回原文", () => {
  const legacy = {
    kind: "vocab-device-preferences", version: 1,
    shared: { theme: "dark", keys: { know: "f", dont: "j", next: " ", speak: "s", star: "b", proficient: "m" },
      showPh: true, showEx: false, showFm: true, autoSpk: false, singleCharKeys: true,
      fontSize: "large", voiceURI: "", speechRate: 0.92,
      actionKeys: { continue: null, wait: null, return: null, listSearch: null },
      gestures: { enabled: true, recall: { left: "dont", right: "know" }, revealed: { left: "none", right: "none" } },
      actionLayout: "standard" },
    overrides: { kaoyan: ["theme"], cet4: [], cet6: [], combined: [] }
  };
  const raw = JSON.stringify(legacy);
  const b = browser({ initial: { [DEVICE_KEY]: raw, [BOOK_KEYS.kaoyan]: oldState({ theme: "light", cardDensity: "compact" }) } });
  const own = b.T.getPreferenceOwnership();
  assert.equal(own.status, "ok");
  assert.equal(own.legacy, true, "应标记为兼容解码");
  assert.equal(b.deviceRaw(), raw, "读取旧键本身不写回原文");
  assert.equal(b.T.getS().settings.theme, "light", "本书覆盖 theme 仍用主记录值");
  assert.equal(b.T.getS().settings.cardDensity, "comfortable", "缺失的 F1 字段按 DEF 补，不判损坏");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.showEx, false, "shared 原有字段继续生效");
});

/* ================================================================== 2. 归属切换 */
test("逐字段归属：本书单独冻结当前值；shared 变化不影响覆盖书；跟随设备立即生效", () => {
  const b = browser();
  b.T.applyPreferencePatch({ theme: "auto" }, { target: "device" });
  assert.equal(b.T.getS().settings.theme, "auto");
  const frozen = b.T.setPreferenceInheritance(["theme"]);
  assert.equal(frozen.ok, true, frozen.error);
  assert.deepEqual(b.device().overrides.kaoyan, ["theme"]);
  assert.equal(b.T.getS().settings.theme, "auto", "冻结值即当前有效值");
  // 设备通用值继续变化，但考研已覆盖 → 保留 auto
  b.T.applyPreferencePatch({ theme: "dark" }, { target: "device" });
  assert.equal(b.T.getS().settings.theme, "auto", "本书覆盖不被 shared 改动抹平");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.theme, "dark", "未覆盖的四级跟随设备");
  b.T.switchBook("kaoyan");
  const followed = b.T.setPreferenceInheritance(["theme"], true);
  assert.equal(followed.ok, true, followed.error);
  assert.deepEqual(b.device().overrides.kaoyan, []);
  assert.equal(b.T.getS().settings.theme, "dark", "跟随设备立即使用 shared");
  assert.equal(b.T.getS().settings.fontSize, "standard");
});

test("“将当前值设为设备通用”：只改 shared，不移除其他书已有覆盖，并列出受影响书", () => {
  const b = browser();
  // 先让四级有本书覆盖
  b.T.switchBook("cet4");
  b.T.applyPreferencePatch({ theme: "light" }, { target: "book" });
  assert.deepEqual(b.device().overrides.cet4, ["theme"]);
  b.T.switchBook("kaoyan");
  b.T.getS().settings.theme = "dark";   // 模拟当前书界面已调到深色（真实控件会先写 S 再保存）
  const result = b.T.applyPreferencePatch({ theme: "dark" }, { target: "device" });
  assert.equal(result.ok, true, result.error);
  assert.equal(b.device().shared.theme, "dark", "当前值写入设备通用");
  assert.ok(result.affectedBooks.includes("考研英语"), "列出会跟随的考研书");
  assert.ok(!result.affectedBooks.includes("英语四级"), "已覆盖的四级不在受影响列表");
  assert.deepEqual(b.device().overrides.cet4, ["theme"], "不移除其他书已有覆盖");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().settings.theme, "light", "四级本书覆盖保留");
  b.T.switchBook("cet6");
  assert.equal(b.T.getS().settings.theme, "dark", "未覆盖新书共享设备值");
});

test("偏好值严格校验：非法 shared/本书值整次拒绝且内存/存储不变", () => {
  const b = browser();
  const raw = b.deviceRaw();
  for (const bad of [{ theme: "blue" }, { fontSize: "huge" }, { speechRate: 3 }, { readingOrder: ["meaning"] },
    { showPh: 1 }, { secondaryActions: ["undo", "undo"] }, { keys: { know: "f" } }]) {
    const result = b.T.applyPreferencePatch(bad, { target: "device" });
    assert.equal(result.ok, false, `应拒绝 ${JSON.stringify(bad)}`);
    assert.equal(b.deviceRaw(), raw, "失败不得半写设备键");
  }
  const own = b.T.applyPreferencePatch({ theme: "dark" }, { target: "nope" });
  assert.equal(own.ok, true, "未知 target 按本书处理");
});

/* ================================================================== 3. 事务/日志 */
test("新增覆盖事务：主键写失败整份回滚，设备键与内存都不变，无残留恢复日志", () => {
  const b = browser();
  const beforeDevice = b.deviceRaw(), beforeState = b.T.getS().settings.theme;
  b.failWrite.add(BOOK_KEYS.kaoyan);
  const result = b.T.setPreferenceInheritance(["theme"]);
  b.failWrite.delete(BOOK_KEYS.kaoyan);
  assert.equal(result.ok, false);
  assert.equal(b.deviceRaw(), beforeDevice, "设备键回滚");
  assert.equal(b.journal(), null, "恢复日志应清理");
  assert.equal(b.T.getS().settings.theme, beforeState, "内存未提交");
  assert.deepEqual(clone(b.T.getPreferenceOwnership().currentOverrides), []);
});

test("设备键写失败：整次失败且主记录不变，恢复日志清理", () => {
  const b = browser();
  const beforeState = b.stateRaw("kaoyan");
  b.failWrite.add(DEVICE_KEY);
  const result = b.T.setPreferenceInheritance(["showPh"]);
  b.failWrite.delete(DEVICE_KEY);
  assert.equal(result.ok, false);
  assert.equal(b.stateRaw("kaoyan"), beforeState, "主键不得半写");
  assert.equal(b.journal(), null);
});

test("回滚失败：保留恢复日志并持续提示，启动时恢复旧值", () => {
  const b = browser();
  b.failWrite.add(BOOK_KEYS.kaoyan);
  b.failRemove.add(JOURNAL_KEY);
  const result = b.T.setPreferenceInheritance(["theme"]);
  b.failWrite.delete(BOOK_KEYS.kaoyan);
  b.failRemove.delete(JOURNAL_KEY);
  assert.equal(result.ok, false);
  assert.ok(b.journal(), "回滚失败必须保留恢复日志");
  assert.equal(b.query("#appAlert").hidden, false, "应出现持续错误提示");
  // 启动恢复：新页面读到恢复日志后自动恢复涉及的键。
  const b2 = browser({ storage: b.storage, session: new Map() });
  assert.equal(b2.journal(), null, "启动恢复后日志清除");
  assert.equal(b2.T.getPreferenceOwnership().status, "ok");
});

/* ================================================================== 4. 跨标签 */
test("设备键 storage 事件：只重解析未覆盖字段，不换书/不 startSession/不关浮层/撤销仍可用", () => {
  const a = browser();
  const b = browser({ storage: a.storage, session: new Map() });
  b.T.show("set"); b.T.openGuide();   // 打开浮层并保留学习现场
  b.T.judge(true);
  a.storageEvent(BOOK_KEYS.kaoyan);   // 让 a 先对齐主记录（真实双标签会收到 storage 事件）
  const cur = b.T.cur, qi = b.T.qi, q = b.T.Q.slice();
  const revBefore = b.T.getInputPreferenceRevision();
  const devicePatch = a.T.applyPreferencePatch({ theme: "dark", gestures: { enabled: false, recall: { left: "dont", right: "know" }, revealed: { left: "none", right: "none" } } }, { target: "device" });
  assert.equal(devicePatch.ok, true, devicePatch.error);
  b.storageEvent(DEVICE_KEY);
  assert.equal(b.T.getS().settings.theme, "dark", "未覆盖字段即时重解析");
  assert.equal(b.T.getS().settings.gestures.enabled, false);
  assert.ok(b.T.getInputPreferenceRevision() > revBefore, "输入偏好 revision 变化（进行中手势作废）");
  assert.equal(b.T.getBook(), "kaoyan", "不换书");
  assert.equal(b.T.cur, cur);
  assert.equal(b.T.qi, qi);
  assert.deepEqual(b.T.Q.slice(), q, "不重建当前组");
  assert.equal(b.query("#guideSheet").hidden, false, "不关闭已打开浮层");
  b.T.undo();
  assert.equal(b.T.verdict, null, "撤销链仍可用");
});

test("设备键事件不覆盖本书覆盖字段；主记录设置事件采纳为设备通用", () => {
  const a = browser();
  const b = browser({ storage: a.storage, session: new Map() });
  b.T.applyPreferencePatch({ theme: "auto" }, { target: "book" });   // 当前书 theme 覆盖
  assert.deepEqual(b.device().overrides.kaoyan, ["theme"]);
  a.T.applyPreferencePatch({ theme: "dark" }, { target: "device" });
  b.storageEvent(DEVICE_KEY);
  assert.equal(b.T.getS().settings.theme, "auto", "本书覆盖字段不跟随设备事件");
  // 另一页把“有效快照”写进主记录（模拟旧路径/延迟合并）：未覆盖字段采纳为 shared。
  const incoming = JSON.parse(b.stateRaw("kaoyan"));
  incoming.settings.fontSize = "large";
  b.storage.set(BOOK_KEYS.kaoyan, JSON.stringify(incoming));
  b.storageEvent(BOOK_KEYS.kaoyan);
  assert.equal(b.T.getS().settings.fontSize, "large", "主记录里另一页的有效偏好被采纳");
  assert.equal(b.device().shared.fontSize, "large");
});

test("save 不拿本页旧缓存覆盖另一页刚写入的设备键", () => {
  const a = browser();
  const b = browser({ storage: a.storage, session: new Map() });
  const baseline = b.device();
  b.T.getS().settings.fontSize = "large";   // 本页未保存的偏好编辑
  // 另一页直接更新设备键（不改主记录）：浏览器存储改变但本页尚未收到 storage 事件
  const remote = clone(baseline);
  remote.shared.fontSize = "standard";
  remote.shared.theme = "dark";
  b.storage.set(DEVICE_KEY, JSON.stringify(remote));
  const remoteRaw = b.deviceRaw();
  b.T.judge(true);                          // 触发普通 save → 偏好写回路径
  const merged = b.device();
  assert.equal(merged.shared.theme, "dark", "远端其他字段保持，不被本页旧缓存整份覆盖");
  assert.equal(merged.shared.fontSize, "large", "本页显式编辑的字段写入（保留输入）");
  // 学习判定本身仍成功落盘（不因偏好归属写回而丢进度）
  const saved = b.stateOf("kaoyan");
  assert.ok(saved && Object.keys(saved.progress).length >= 1, "学习进度仍保存");
});

/* 设备通用与本书覆盖组合后的按键冲突：真实归属事务与保存路径共用校验。 */
test('设备额外动作不能与另一书保留的六键覆盖冲突，拒绝前不写设备/主键/日志', () => {
  const b=browser(),T=b.T;
  assert.equal(T.setPreferenceInheritance(['keys'],false).ok,true);
  T.switchBook('cet4');
  const keys=clone(T.getS().settings.keys);keys.know='g';
  assert.equal(T.applyPreferencePatch({keys},{target:'device'}).ok,true);
  const beforeDevice=b.deviceRaw(),beforeMain=b.stateRaw('cet4'),beforeKeys=clone(T.getS().settings.keys);
  const actions=clone(T.getS().settings.actionKeys);actions.listSearch='f';
  const rejected=T.applyPreferencePatch({actionKeys:actions},{target:'device'});
  assert.equal(rejected.ok,false);assert.match(rejected.error,/考研英语.*会.*词表搜索.*F/);
  assert.equal(b.deviceRaw(),beforeDevice);assert.equal(b.stateRaw('cet4'),beforeMain);
  assert.deepEqual(clone(T.getS().settings.keys),beforeKeys);assert.equal(b.journal(),null);
  T.switchBook('kaoyan');assert.equal(T.getS().settings.keys.know,'f');assert.equal(T.getS().settings.actionKeys.listSearch,null);
});

test('设备六键不能与另一书额外动作覆盖冲突，已有本书值不被静默删除', () => {
  const b=browser(),T=b.T;const sharedKeys=clone(T.getS().settings.keys);sharedKeys.know='g';
  assert.equal(T.applyPreferencePatch({keys:sharedKeys},{target:'device'}).ok,true);
  T.switchBook('cet4');const actions=clone(T.getS().settings.actionKeys);actions.listSearch='f';
  assert.equal(T.applyPreferencePatch({actionKeys:actions},{target:'book'}).ok,true);
  const cet4Raw=b.stateRaw('cet4');T.switchBook('kaoyan');
  const before=b.deviceRaw(),keys=clone(T.getS().settings.keys);keys.know='f';
  const rejected=T.applyPreferencePatch({keys},{target:'device'});
  assert.equal(rejected.ok,false);assert.match(rejected.error,/英语四级.*会.*词表搜索/);
  assert.equal(b.deviceRaw(),before);assert.equal(b.stateRaw('cet4'),cet4Raw);
  assert.equal(T.getS().settings.keys.know,'g');assert.equal(b.journal(),null);
});

test('只改一组按键的继承或本书值也核对最终有效组合，冲突不半改归属', () => {
  const b=browser(),T=b.T;const ownKeys=clone(T.getS().settings.keys),ownActions=clone(T.getS().settings.actionKeys);ownActions.listSearch='g';
  assert.equal(T.applyPreferencePatch({keys:ownKeys,actionKeys:ownActions},{target:'book'}).ok,true);
  const sharedKeys=clone(ownKeys);sharedKeys.know='g';
  assert.equal(T.applyPreferencePatch({keys:sharedKeys},{target:'device'}).ok,true);
  const sharedActions=clone(ownActions);sharedActions.listSearch='f';
  assert.equal(T.applyPreferencePatch({actionKeys:sharedActions},{target:'device'}).ok,true);
  const before=b.deviceRaw(),main=b.stateRaw('kaoyan');
  const inherit=T.setPreferenceInheritance(['actionKeys'],true);
  assert.equal(inherit.ok,false);assert.match(inherit.error,/考研英语.*会.*词表搜索/);
  assert.equal(b.deviceRaw(),before);assert.equal(b.stateRaw('kaoyan'),main);
  const badKeys=clone(ownKeys);badKeys.know='g';
  assert.equal(T.applyPreferencePatch({keys:badKeys},{target:'book'}).ok,false);
  assert.equal(b.deviceRaw(),before);assert.equal(b.stateRaw('kaoyan'),main);
});

test('旧保存入口拒绝跨书组合冲突并还原未接受按键，学习判定仍保存且后续保存不重试坏值', () => {
  const b=browser(),T=b.T;const sharedKeys=clone(T.getS().settings.keys);sharedKeys.know='g';
  assert.equal(T.applyPreferencePatch({keys:sharedKeys},{target:'device'}).ok,true);
  T.switchBook('cet4');const ownActions=clone(T.getS().settings.actionKeys);ownActions.listSearch='f';
  assert.equal(T.applyPreferencePatch({actionKeys:ownActions},{target:'book'}).ok,true);
  T.switchBook('kaoyan');const before=b.deviceRaw();
  T.getS().settings.keys.know='f';T.judge(true);
  assert.equal(b.deviceRaw(),before);assert.equal(T.getS().settings.keys.know,'g');
  assert.equal(T.getPreferenceOwnership().status,'ok','配置冲突不是存储故障');
  assert.ok(Object.keys(b.stateOf('kaoyan').progress).length>0,'学习判定照常保存');
  assert.match(b.text('#preferenceOwnershipStatus'),/英语四级.*会.*词表搜索/);
  T.tryNext();assert.equal(b.deviceRaw(),before,'后续翻页保存不再次提交被拒绝的按键');
});

test('远端主记录物化快照不得经旧同步旁路引入跨书按键冲突', () => {
  const b=browser(),T=b.T;const sharedKeys=clone(T.getS().settings.keys);sharedKeys.know='g';
  assert.equal(T.applyPreferencePatch({keys:sharedKeys},{target:'device'}).ok,true);
  T.switchBook('cet4');const ownActions=clone(T.getS().settings.actionKeys);ownActions.listSearch='f';
  assert.equal(T.applyPreferencePatch({actionKeys:ownActions},{target:'book'}).ok,true);
  T.switchBook('kaoyan');const before=b.deviceRaw(),cur=T.cur;
  const incoming=b.stateOf('kaoyan');incoming.settings.keys.know='f';
  b.storage.set(BOOK_KEYS.kaoyan,JSON.stringify(incoming));b.storageEvent(BOOK_KEYS.kaoyan);
  assert.equal(b.deviceRaw(),before);assert.equal(T.getS().settings.keys.know,'g');assert.equal(T.cur,cur);
});

test('已存在的混合冲突保留用户原值并提示，无关主题修改不被阻止', () => {
  const fixture=browser(),prefs=fixture.device();prefs.shared.keys.know='g';prefs.shared.actionKeys.listSearch='f';prefs.overrides.kaoyan=['keys'];
  const state=clone(fixture.T.getS());state.settings.keys.know='f';state.settings.actionKeys.listSearch=null;
  const b=browser({initial:{[DEVICE_KEY]:prefs,[BOOK_KEYS.kaoyan]:state}}),T=b.T;
  assert.equal(T.getS().settings.keys.know,'f');assert.equal(T.getS().settings.actionKeys.listSearch,'f');
  assert.match(b.text('#keyBindingStatus'),/会.*词表搜索.*F/);
  assert.equal(T.applyPreferencePatch({theme:'dark'},{target:'device'}).ok,true);
  assert.equal(T.getS().settings.keys.know,'f');assert.equal(T.getS().settings.actionKeys.listSearch,'f');
  assert.deepEqual(b.device().overrides.kaoyan,['keys']);assert.equal(b.device().shared.actionKeys.listSearch,'f');
});

test('旧存储的歧义按键在重叠场景拒绝执行，按钮可用且完成页单一匹配仍可用', () => {
  const fixture=browser(),prefs=fixture.device();prefs.shared.keys.know='g';prefs.shared.actionKeys.listSearch='f';prefs.overrides.kaoyan=['keys'];
  const state=clone(fixture.T.getS());state.settings.keys.know='f';state.settings.actionKeys.listSearch=null;
  const b=browser({initial:{[DEVICE_KEY]:prefs,[BOOK_KEYS.kaoyan]:state}}),T=b.T;
  T.show('study');const card=b.query('#card');card.focus();
  const before=JSON.stringify({cur:T.cur,Q:T.Q,phase:T.phase,verdict:T.verdict,answered:T.answered,progress:T.getS().progress});
  const event=card.dispatch('keydown',{key:'f',code:'KeyF'});
  assert.equal(event.defaultPrevented,true,'明确拦截有歧义的快捷键');
  assert.equal(JSON.stringify({cur:T.cur,Q:T.Q,phase:T.phase,verdict:T.verdict,answered:T.answered,progress:T.getS().progress}),before,'不判定、不跳转、不改学习现场');
  assert.equal(b.query('#v-study').classList.contains('on'),true);
  assert.match(b.text('#toast'),/F.*会.*词表搜索.*本次未执行/);
  assert.equal(T.getS().settings.keys.know,'f');assert.equal(T.getS().settings.actionKeys.listSearch,'f','不静默抹掉用户自定义');
  b.query('#ok').click();assert.equal(T.verdict,true,'明确点击会按钮仍可正常判定');
  b.answerAllKnown();assert.equal(T.cur,null);assert.ok(T.getGroupTotal()>0);
  card.focus();const doneProgress=JSON.stringify(T.getS().progress);
  card.dispatch('keydown',{key:'f',code:'KeyF'});
  assert.equal(b.query('#v-list').classList.contains('on'),true,'完成页没有会动作，F 的词表搜索仍有效');
  assert.equal(JSON.stringify(T.getS().progress),doneProgress);
});

/* ================================================================== 5. 备份 */
test("备份 v3 导出每书实际有效偏好，只读且不含归属元数据", () => {
  const b = browser({ initial: {
    [BOOK_KEYS.kaoyan]: oldState({ theme: "dark" }),
    [BOOK_KEYS.cet4]: oldState({ theme: "auto" })
  }});
  // shared 改成 light；kaoyan 覆盖 dark，cet4 覆盖 auto → 导出各自有效值
  b.T.applyPreferencePatch({ theme: "light" }, { target: "device" });
  const storageBefore = JSON.stringify([...b.storage.entries()].sort());
  const Sbefore = JSON.stringify(b.T.getS());
  const backup = b.T.buildExport();
  assert.equal(backup.version, 3);
  assert.equal(backup.books.kaoyan.settings.theme, "dark", "考研导出本书覆盖值");
  assert.equal(backup.books.cet4.settings.theme, "auto");
  assert.equal(backup.books.combined.settings.theme, "light", "无记录书导出设备通用值");
  assert.equal(JSON.stringify(backup).includes("vocab_device_preferences_v1"), false, "不装归属元数据");
  assert.equal(JSON.stringify(backup).includes("overrides"), false);
  assert.equal(JSON.stringify([...b.storage.entries()].sort()), storageBefore, "导出只读不改存储");
  assert.equal(JSON.stringify(b.T.getS()), Sbefore, "导出只读不改内存");
});

test("导入 v3：被导入书标本书覆盖、设备 shared 不变、未导入书覆盖不动；失败整份回滚", () => {
  const source = browser();
  const sourceBackup = source.T.buildExport();
  const importedKaoyan = clone(sourceBackup.books.kaoyan);
  importedKaoyan.settings.theme = "auto";
  importedKaoyan.settings.cardDensity = "compact";
  importedKaoyan.progress = { 0: [1, 0, 1, 0, 1] };
  const backup = { app: "kaoyan-vocab", version: 3, exportedAt: new Date().toISOString(),
    activeBook: "kaoyan", books: { kaoyan: importedKaoyan } };
  // 目标：设备 shared theme=light；cet6 已有自己的覆盖 fontSize（不在导入文件中）
  const target = browser();
  target.T.switchBook("cet6");
  target.T.applyPreferencePatch({ fontSize: "large" }, { target: "book" });
  target.T.switchBook("kaoyan");
  const sharedBefore = target.device().shared.theme;
  const cet6OverridesBefore = target.device().overrides.cet6.slice();
  target.T.importState(backup);
  assert.equal(target.device().shared.theme, sharedBefore, "导入不改设备 shared");
  assert.deepEqual(target.device().overrides.kaoyan, PREFERENCE_FIELDS, "被导入书可携带偏好全部标本书覆盖");
  assert.deepEqual(target.device().overrides.cet6, cet6OverridesBefore, "未导入书覆盖不动");
  assert.equal(target.T.getS().settings.theme, "auto", "导入值不被本机 shared 遮住");
  assert.equal(target.T.getS().settings.cardDensity, "compact");
  // 失败回滚：导入写书失败 → 设备键与覆盖表整份回滚
  const beforeDevice = target.deviceRaw();
  const beforeKaoyanState = target.stateRaw("kaoyan");
  const beforeOverrides = target.device().overrides.kaoyan.slice();
  target.failWrite.add(BOOK_KEYS.kaoyan);
  let threw = false;
  try { target.T.importState(backup); } catch (e) { threw = true; }
  target.failWrite.delete(BOOK_KEYS.kaoyan);
  assert.equal(threw, true, "写入失败应整份拒绝");
  assert.equal(target.deviceRaw(), beforeDevice, "设备键随导入 journal 整份回滚");
  assert.equal(target.stateRaw("kaoyan"), beforeKaoyanState, "被导入书主记录回滚");
  assert.deepEqual(clone(target.device().overrides.kaoyan), beforeOverrides, "覆盖表回滚到导入前");
  assert.equal(target.journal(), null);
});

test("导入 v1 旧备份：考研可携带偏好标本书覆盖（shared 不变）", () => {
  const b = browser();
  const legacy = oldState({ dailyNew: 5, theme: "auto", fontSize: "large" }, { progress: { 0: [1, 0, 1, 0, 1] } });
  b.T.importState(legacy);
  assert.deepEqual(b.device().overrides.kaoyan, PREFERENCE_FIELDS);
  assert.equal(b.device().shared.theme, "light", "v1 导入不改设备 shared");
  assert.equal(b.T.getS().settings.theme, "auto");
  assert.equal(b.T.getS().settings.fontSize, "large");
});

/* ================================================================== 6. 本页词书 */
test("本页词书：新用户默认 local；切书只写 sessionStorage；新页面按默认书打开", () => {
  const b = browser();
  const page = b.T.getPageBookState();
  assert.equal(page.mode, "local", "新页面默认仅本页");
  assert.equal(page.defaultBook, "kaoyan");
  assert.equal(page.bookId, "kaoyan");
  b.T.switchBook("cet4");
  assert.equal(b.session.get(PAGE_BOOK_KEY), "cet4", "本页词书写入 sessionStorage");
  assert.equal(b.storage.get(ACTIVE_KEY), undefined, "local 模式不写 ACTIVE");
  // 同一 sessionStorage + localStorage（刷新）：保留本页词书
  const reload = browser({ storage: b.storage, session: b.session });
  assert.equal(reload.T.getBook(), "cet4", "刷新后保留本页词书");
  assert.equal(reload.T.getPageBookState().mode, "local");
  // 新页面（新 sessionStorage，同 localStorage）：按下次默认打开
  const newPage = browser({ storage: b.storage, session: new Map() });
  assert.equal(newPage.T.getBook(), "kaoyan", "新页面按默认词书打开");
});

test("设为下次默认不切已开页面；新页面按新默认打开", () => {
  const b = browser();
  assert.equal(b.T.setDefaultBook("cet6").ok, true);
  assert.equal(b.T.getBook(), "kaoyan", "改默认不切当前页");
  assert.equal(b.storage.get(DEFAULT_BOOK_KEY), "cet6");
  const newPage = browser({ storage: b.storage, session: new Map() });
  assert.equal(newPage.T.getBook(), "cet6", "新页面按新默认书打开");
  // 新页面明确选了本页词书后，默认不再影响已开页
  newPage.T.switchBook("combined");
  assert.equal(newPage.T.getBook(), "combined");
  assert.equal(newPage.session.get(PAGE_BOOK_KEY), "combined");
});

test("旧用户迁移：旧 ACTIVE 固定为下次默认，本页模式保留 follow；开启 follow 不追历史 ACTIVE", () => {
  const b = browser({ initial: { [ACTIVE_KEY]: "cet4" } });
  assert.equal(b.T.getBook(), "cet4", "旧 ACTIVE 迁移为当前/默认词书");
  assert.equal(b.storage.get(DEFAULT_BOOK_KEY), "cet4", "首次迁移把默认书固定为旧 ACTIVE");
  assert.equal(b.T.getPageBookState().mode, "follow", "旧用户迁移保留 follow");
  // 已经存在于 ACTIVE 的历史值不会在开启 follow 时被“追赶”
  const c = browser();
  c.storage.set(ACTIVE_KEY, "cet6");
  assert.equal(c.T.setPageBookMode("follow").ok, true);
  assert.equal(c.T.getBook(), "kaoyan", "开启 follow 不立即追历史 ACTIVE");
});

test("local 页忽略 ACTIVE；follow 页无现场时 silent 跟随；有现场只提示，明确同步只切一次", () => {
  const a = browser();
  const local = browser({ storage: a.storage, session: new Map() });
  const follow = browser({ storage: a.storage, session: new Map() });
  follow.T.setPageBookMode("follow");
  follow.answerAllKnown(80);                 // 主组完成 → cur == null 的空完成页
  assert.equal(follow.T.cur, null);
  a.T.switchBook("cet4");                      // a 仍 local：不广播 ACTIVE
  local.storageEvent(ACTIVE_KEY);
  follow.storageEvent(ACTIVE_KEY);
  assert.equal(local.T.getBook(), "kaoyan", "local 页忽略 ACTIVE");
  assert.equal(follow.T.getBook(), "kaoyan", "a 未广播，follow 页也不切");
  // a 开启 follow 后再切书 → 广播；follow 页无现场 → silent 跟随
  a.T.setPageBookMode("follow");
  a.T.switchBook("cet6");
  assert.equal(a.storage.get(ACTIVE_KEY), "cet6");
  follow.storageEvent(ACTIVE_KEY);
  assert.equal(follow.T.getBook(), "cet6", "无未完成组的 follow 页可 silent 跟随");
  // 有现场：再切一个 → 只提示
  follow.T.startSession("main");
  assert.ok(follow.T.cur != null);
  const cur = follow.T.cur, q = follow.T.Q.slice();
  a.T.switchBook("combined");
  follow.storageEvent(ACTIVE_KEY);
  assert.equal(follow.T.getBook(), "cet6", "有未完成组时本页保留现场，不自动切换");
  assert.equal(follow.T.getPendingBookFollow(), "combined", "只提示待同步词书");
  assert.equal(follow.T.cur, cur);
  assert.deepEqual(follow.T.Q.slice(), q, "提示不重建当前组");
  assert.equal(follow.T.applyBookFollowNotice(), true, "用户明确点同步才切换");
  assert.equal(follow.T.getBook(), "combined");
  // 相同 ID 不重复 startSession
  const groupBefore = { cur: follow.T.cur, qi: follow.T.qi, Q: follow.T.Q.slice(), total: follow.T.getGroupTotal() };
  follow.storageEvent(ACTIVE_KEY);
  assert.equal(follow.T.cur, groupBefore.cur);
  assert.equal(follow.T.qi, groupBefore.qi);
  assert.deepEqual(follow.T.Q.slice(), groupBefore.Q);
  assert.equal(follow.T.getGroupTotal(), groupBefore.total);
});

/* ================================================================== 7. 设置页与词书浮层 UI */
test("设置页动态注入归属控件：状态文案与切换按钮真实可用", () => {
  const b = browser();
  const line = b.query("#prefOwnLine_theme");
  assert.ok(line, "应为 theme 注入归属控件");
  const state = b.query("#prefOwnState_theme");
  assert.match(state.textContent, /此设备通用/, state.textContent);
  assert.match(b.query("#preferenceOwnershipStatus").textContent, /19 项此设备通用/, b.text(" #preferenceOwnershipStatus"));
  b.query("#prefOwnBtn_theme").click();
  assert.deepEqual(b.device().overrides.kaoyan, ["theme"], "点「改为本书单独」冻结并标记");
  assert.match(b.query("#prefOwnState_theme").textContent, /本书单独/);
  assert.equal(b.query("#prefOwnDeviceBtn_theme").hidden, false, "本书单独时显示设为设备通用");
  b.query("#prefOwnBtn_theme").click();
  assert.deepEqual(b.device().overrides.kaoyan, [], "点「跟随设备」移除覆盖");
  assert.match(b.query("#prefOwnState_theme").textContent, /此设备通用/);
  // 每个偏好字段都有归属控件注入
  for (const field of PREFERENCE_FIELDS) assert.ok(b.query("#prefOwnLine_" + field), "缺少归属控件：" + field);
});

test("词书浮层：仅本页/同步到跟随页面/设为下次默认真实控件生效", () => {
  const b = browser();
  b.query("#btnBooks").click();
  assert.equal(b.query("#bookSheet").hidden, false);
  assert.match(b.query("#bookModeStatus").textContent, /仅本页/);
  b.query("#bookPageModeFollow").click();
  assert.equal(b.session.get(PAGE_MODE_KEY), "follow");
  assert.match(b.query("#bookModeStatus").textContent, /同步到跟随页面/);
  b.T.switchBook("cet4");
  assert.equal(b.storage.get(ACTIVE_KEY), "cet4", "follow 模式切书写 ACTIVE");
  b.query("#btnBooks").click();
  b.query("#bookSetDefault").click();
  assert.equal(b.storage.get(DEFAULT_BOOK_KEY), "cet4", "设为下次默认写入默认书键");
  assert.equal(b.T.getBook(), "cet4", "设为默认不切当前页");
  b.query("#bookPageModeLocal").click();
  assert.equal(b.session.get(PAGE_MODE_KEY), "local");
});

test("会话存储不可用：本页词书降为内存并明确说明，不误写其他页", () => {
  const b = browser({ sessionFails: true });
  b.T.switchBook("cet4");
  assert.equal(b.T.getBook(), "cet4", "内存降级仍能切书");
  assert.equal(b.T.getPageBookState().pageSessionAvailable, false, "状态应标为会话存储不可用");
  assert.match(b.query("#bookModeStatus").textContent || b.text("#bookModeStatus"), /内存|会话存储不可用/);
  assert.equal(b.storage.get(ACTIVE_KEY), undefined, "local 降级不写 ACTIVE");
});

test("方案应用保留设备shared，只将选中类别冻结到当前书；普通快捷编辑仍按来源保存", () => {
  const b=browser(), P=b.window.__vocabSettingsProfiles;
  const source=P.saveSettingsProfile('本书阅读方案',['appearance']);assert.equal(source.ok,true,source.error);
  const shared=clone(b.device().shared), beforeGroup=JSON.stringify({Q:b.T.Q,cur:b.T.cur,qi:b.T.qi,plan:b.T.getPlan()});
  assert.equal(P.applySettingsPatch({fontSize:'large'}).ok,true);
  assert.equal(b.device().shared.fontSize,'large','普通继承字段编辑继续更新设备通用');
  const result=P.applySettingsProfile(source.profile);assert.equal(result.ok,true,result.error);
  assert.equal(b.device().shared.fontSize,'large','应用本书方案不回写设备通用');
  assert.equal(b.T.getS().settings.fontSize,shared.fontSize);
  assert.ok(b.device().overrides.kaoyan.includes('fontSize'));
  assert.equal(b.device().overrides.kaoyan.includes('keys'),false,'未选类别不建立覆盖');
  assert.equal(JSON.stringify({Q:b.T.Q,cur:b.T.cur,qi:b.T.qi,plan:b.T.getPlan()}),beforeGroup);
  b.T.switchBook('cet4');assert.equal(b.T.getS().settings.fontSize,'large');
});

test('设置词库范围的切书入口复用同一浮层，关闭回入口且不改变当前学习现场', () => {
  const b=browser();b.T.judge(true);b.T.show('set');
  const before=JSON.stringify({cur:b.T.cur,Q:b.T.Q,phase:b.T.phase,verdict:b.T.verdict,answered:b.T.answered,plan:b.T.getPlan()});
  const button=b.query('#btnScopeBooks');assert.ok(button);
  button.focus();button.click();
  assert.equal(b.query('#bookSheet').hidden,false);
  assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.equal(b.query('#btnBooks').getAttribute('aria-expanded'),'true');
  b.query('#bookClose').click();
  assert.equal(b.query('#bookSheet').hidden,true);
  assert.equal(b.doc.activeElement.id,'btnScopeBooks');
  assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(b.query('#btnBooks').getAttribute('aria-expanded'),'false');
  assert.equal(b.query('#v-set').classList.contains('on'),true);
  assert.equal(JSON.stringify({cur:b.T.cur,Q:b.T.Q,phase:b.T.phase,verdict:b.T.verdict,answered:b.T.answered,plan:b.T.getPlan()}),before);
});

test('从词库范围切换词书后原地更新书名、词数与筛选上限，本页模式不广播', () => {
  const b=browser();b.T.judge(true);b.T.setPageBookMode('local');b.T.show('set');
  const oldProgress=clone(b.T.getS().progress),signal=b.storage.get(ACTIVE_KEY),defaultBook=b.storage.get(DEFAULT_BOOK_KEY);
  b.query('#btnScopeBooks').click();b.query('#bookList [data-book="cet4"]').click();
  assert.equal(b.T.getBook(),'cet4');
  assert.equal(b.query('#v-set').classList.contains('on'),true);
  assert.equal(b.text('#scopeBookName'),'英语四级');
  assert.ok(b.text('#scopeBookMeta').includes(String(b.T.getW().length)));
  assert.equal(b.query('#pmin').max,'80');
  assert.equal(b.query('#bookSheet').hidden,true);
  assert.equal(b.query('#btnScopeBooks').getAttribute('aria-expanded'),'false');
  assert.deepEqual(b.stateOf('kaoyan').progress,oldProgress);
  assert.equal(b.storage.get(ACTIVE_KEY),signal);
  assert.equal(b.storage.get(DEFAULT_BOOK_KEY),defaultBook);
});

/* ================================================================== 汇总 */
console.log(`\nO1 偏好归属/本页词书：${passed} 通过，${failed} 失败`);
if (failed) {
  for (const item of failures) console.log(`  - ${item.name}: ${item.message}`);
  process.exitCode = 1;
}
