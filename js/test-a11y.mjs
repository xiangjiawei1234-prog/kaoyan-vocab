/**
 * 12 大字阅读 / lang=en / 设备发音回归。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱；DOM 桩只模拟浏览器，speechSynthesis 用假对象捕获参数）。
 * 覆盖：fontSize 旧记录兼容与跨书携带、即时生效不重建当前组、长词最小可读字号与换行、
 * 英文语言标记（词头/词表/例句/浮层/义项原句，中文不误标 en）、
 * 语音/语速偏好（voices 延迟到达、失效回退、无英语语音明确拒绝、连续点击取消、autoSpk 与 S 键同步）。
 * 真实读屏与真实系统语音属设备能力，由 QA 记录未测项；本文件不伪造通过。
 * 运行：node --max-old-space-size=512 js/test-a11y.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css/app.css"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const words = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");
const cet = fs.readFileSync(path.join(ROOT, "js/cet-words-data.js"), "utf8");
const KAOYAN_KEY = "kaoyan_vocab_v1";
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

const VOICES = [
  { name: "Samantha", lang: "en-US", voiceURI: "Samantha" },
  { name: "Daniel", lang: "en-GB", voiceURI: "Daniel" },
  { name: "Tingting", lang: "zh-CN", voiceURI: "Tingting" }
];

/** 假 speechSynthesis：可切换 voices、捕获 utterance、统计 cancel。 */
function makeSpeech() {
  const listeners = new Map();
  const state = {
    voices: [],
    spoken: [],
    cancelCount: 0,
    getVoices() { return state.voices.slice(); },
    speak(u) { state.spoken.push(u); },
    cancel() { state.cancelCount++; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener() {},
    setVoices(list) { state.voices = list.slice(); },
    fireChanged() { for (const fn of listeners.get("voiceschanged") || []) fn({ type: "voiceschanged" }); }
  };
  return state;
}

function browser({ storage = new Map(), voices = VOICES.slice(), noSpeech = false } = {}) {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.hidden = false; this.disabled = false; this.placeholder = '';
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
      if (['hidden','disabled','checked'].includes(name)) this[name] = true;
      if (name === 'value') this.value = String(value);
    }
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
    removeAttribute(name) { delete this.attrs[name]; if (['hidden','disabled','checked'].includes(name)) this[name] = false; }
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    closest(selector) { for (let n = this; n && n !== doc; n = n.parentNode) if (matches(n, selector)) return n; return null; }
    querySelectorAll(selector) { const out = []; const walk = node => { for (const n of node.children) { if (matches(n, selector)) out.push(n); walk(n); } }; walk(this); return out; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    removeEventListener() {}
    focus() { if (doc.contains(this) && !this.disabled) doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    getBoundingClientRect() { return {left:0, top:0, width:100, height:52}; }
    getClientRects() { return [{left:0, top:0, width:100, height:52}]; }
    setPointerCapture() {} releasePointerCapture() {}
    dispatch(type, data = {}) {
      const event = {target:this, key:'', ctrlKey:false, altKey:false, metaKey:false, shiftKey:false,
        repeat:false, isComposing:false, defaultPrevented:false, stopped:false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...data};
      for (let n = this; n; n = n.parentNode) {
        if (n['on'+type]) n['on'+type](event);
        for (const fn of n.events.get(type) || []) fn(event);
        if (event.stopped) break;
      }
      return event;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
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
      if (tag === 'input') {
        const ph = m[2].match(/placeholder\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (ph) n.placeholder = decode(ph[1] ?? ph[2] ?? ph[3] ?? '');
      }
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
  const intervals = [], winEvents = new Map();
  const localStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  };
  const speech = noSpeech ? null : makeSpeech();
  if (speech) speech.setVoices(voices);
  class FakeUtterance {
    constructor(text) { this.text = String(text); this.lang = ""; this.rate = 1; this.voice = null; this.onerror = null; }
  }
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}), innerWidth: 1200, innerHeight: 800,
    getComputedStyle: el => ({fontSize: (el && el.style && el.style.fontSize) || '68px'})};
  if (speech) window.speechSynthesis = speech;
  const sandbox = {
    window, document: doc, console, Date, localStorage,
    setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; }, clearInterval(){},
    setTimeout(){return 0;}, clearTimeout(){}, requestAnimationFrame(fn){fn();}, cancelAnimationFrame(){},
    confirm: () => true, Blob: class {}, URL:{createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance:{now: () => Date.now()}
  };
  if (speech) {
    sandbox.speechSynthesis = speech;
    sandbox.SpeechSynthesisUtterance = FakeUtterance;
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(words, context, {filename:'words-data.js'});
  vm.runInContext(cet, context, {filename:'cet-words-data.js'});
  vm.runInContext(app, context, {filename:'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab 测试入口');
  return {
    T, doc, window, storage, intervals, speech,
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    text(selector) { const el = doc.querySelector(selector); return el ? el.textContent : null; },
    attr(selector, name) { const el = doc.querySelector(selector); return el ? el.getAttribute(name) : null; },
    createEl(tag) { return doc.createElement(tag); }
  };
}

const clone = value => JSON.parse(JSON.stringify(value));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

/** 让当前卡判定并进入释义态（显示例句、释义）。 */
function revealCurrent(b) {
  b.T.judge(true);
  return b.query('#card');
}

// ===========================================================================
// A. 阅读字号
// ===========================================================================
test('新用户默认标准字号；设置页有标准/大字分段控件', () => {
  const b = browser();
  assert.equal(b.T.getS().settings.fontSize, 'standard', '新用户默认标准字号');
  assert.equal(b.T.getFontSize(), 'standard');
  assert.equal(b.doc.documentElement.dataset.fontSize, 'standard', 'html 根节点标记当前字号');
  assert.ok(b.query('#fontSizeSeg'), '设置页应有 #fontSizeSeg');
  const standard = b.query('#fontSizeSeg [data-font-size="standard"]');
  const large = b.query('#fontSizeSeg [data-font-size="large"]');
  assert.equal(standard.getAttribute('aria-pressed'), 'true');
  assert.equal(large.getAttribute('aria-pressed'), 'false');
});

test('点「大字」立即生效：写入设置、html 标记、aria-pressed、落盘，且不重建当前组', () => {
  const b = browser();
  const S = b.T.getS();
  Object.assign(S.settings, {order: 'freq', dailyNew: 20, fmin: 1, fmax: 0, pmin: 0});
  b.T.startSession();
  const planBefore = b.T.getPlan();
  const curBefore = b.T.cur, qiBefore = b.T.qi;
  b.query('#fontSizeSeg [data-font-size="large"]').click();
  assert.equal(b.T.getS().settings.fontSize, 'large', '点击后写入设置');
  assert.equal(b.doc.documentElement.dataset.fontSize, 'large', 'html 根节点同步');
  assert.equal(b.query('#fontSizeSeg [data-font-size="large"]').getAttribute('aria-pressed'), 'true');
  assert.equal(b.query('#fontSizeSeg [data-font-size="standard"]').getAttribute('aria-pressed'), 'false');
  assert.equal(b.T.cur, curBefore, '不换当前卡');
  assert.equal(b.T.qi, qiBefore, '不重置队列位置');
  assert.equal(b.T.getPlan().startedAt, planBefore.startedAt, '不重建当前组（sessionPlan 未变）');
  const saved = JSON.parse(b.storage.get(KAOYAN_KEY));
  assert.equal(saved.settings.fontSize, 'large', '字号偏好随每书记录落盘');
  assert.equal(b.T.hasPendingScopeSettings(), false, '外观偏好不产生「待应用」范围改动');
});

test('字号旧记录兼容与非法值：缺字段→标准、large 保留、其它值→标准', () => {
  const b = browser();
  const norm = settings => b.T.normalizeState({settings, progress: {}, days: {}}).settings;
  assert.equal(norm({}).fontSize, 'standard', '旧记录缺 fontSize → standard');
  assert.equal(norm({fontSize: 'large'}).fontSize, 'large', '合法 large 保留');
  assert.equal(norm({fontSize: 'huge'}).fontSize, 'standard', '非法值只修该字段');
  assert.equal(norm({fontSize: 3}).fontSize, 'standard');
  assert.equal(norm({dailyNew: 7, fontSize: 'large'}).dailyNew, 7, '不整份重置其它设置');
  // 旧记录（含其它旧字段）整体归一化后仍兼容
  const old = b.T.normalizeState({settings: {dailyNew: 5, theme: 'dark'}, progress: {}, days: {}}).settings;
  assert.equal(old.fontSize, 'standard');
  assert.equal(old.dailyNew, 5);
});

test('字号/语音偏好按「跨书界面偏好」携带，四书学习设置仍独立', () => {
  const b = browser();
  b.T.setFontSize('large');
  b.T.setVoiceURI('Daniel');
  b.T.setSpeechRate(1.25);
  b.T.switchBook('cet4');
  const s4 = b.T.getS().settings;
  assert.equal(s4.fontSize, 'large', '大字应携带到四级');
  assert.equal(s4.voiceURI, 'Daniel', '语音偏好应携带');
  assert.equal(s4.speechRate, 1.25, '语速偏好应携带');
  assert.equal(b.doc.documentElement.dataset.fontSize, 'large', '切书后页面字号保持');
  assert.equal(s4.dailyNew, 20, '学习计划不携带（四级恢复默认）');
  b.T.switchBook('kaoyan');
  assert.equal(b.T.getS().settings.fontSize, 'large', '切回考研仍是用户选择');
  assert.equal(b.T.getS().settings.voiceURI, 'Daniel');
});

test('恢复默认外观会把字号/语音恢复默认，但不清学习计划与进度', () => {
  const b = browser();
  b.T.setFontSize('large');
  b.T.setSpeechRate(1.4);
  const S = b.T.getS();
  S.settings.dailyNew = 9;
  S.progress[0] = [1, Date.now() + 1000, 1, 0, Date.now()];
  b.T.resetSettingsClass('appearance');
  assert.equal(b.T.getFontSize(), 'standard', '外观恢复默认字号');
  assert.equal(b.T.getS().settings.speechRate, 0.92);
  assert.equal(b.T.getS().settings.dailyNew, 9, '不动学习计划');
  assert.ok(b.T.getS().progress[0], '不清学习进度');
  assert.equal(b.doc.documentElement.dataset.fontSize, 'standard');
});

test('CSS：大字只放大阅读文本，长词有最小字号与换行规则', () => {
  assert.match(css, /html\[data-font-size="large"\]/, 'CSS 应含大字档选择器');
  assert.match(css, /--fs-read:\s*17px/, '标准阅读字号变量');
  assert.match(css, /--fs-example:\s*17px/, '标准例句字号变量');
  assert.match(css, /html\[data-font-size="large"\][\s\S]{0,200}--fs-read:\s*19px/, '大字放大释义');
  assert.match(css, /html\[data-font-size="large"\][\s\S]{0,240}--fs-example:\s*18\.5px/, '大字放大例句');
  assert.match(css, /\.mean\s*\{[^}]*var\(--fs-read/, '.mean 使用阅读字号变量');
  assert.match(css, /\.ex\s*\{[^}]*var\(--fs-example/, '.ex 使用例句字号变量');
  assert.match(css, /\.word\.word-wrap\s*\{[^}]*white-space:\s*normal/, '长词允许换行的 class');
});

test('长词适配：低于最小可读字号时换行而不是无限缩小；大字档最小字号更大', () => {
  const b = browser();
  const el = b.createEl('div');
  el.clientWidth = 120; el.scrollWidth = 1200;
  b.T.fitWord(el);
  assert.equal(el.style.fontSize, '30px', '标准档长词保留 30px 最小可读字号');
  assert.equal(el.classList.contains('word-wrap'), true, '长词改用换行');
  b.T.setFontSize('large');
  const el2 = b.createEl('div');
  el2.clientWidth = 120; el2.scrollWidth = 1200;
  b.T.fitWord(el2);
  assert.equal(el2.style.fontSize, '34px', '大字档最小字号更大');
  assert.equal(el2.classList.contains('word-wrap'), true);
  // 宽度足够时不换行、不缩字
  const el3 = b.createEl('div');
  el3.clientWidth = 900; el3.scrollWidth = 900;
  b.T.fitWord(el3);
  assert.equal(el3.classList.contains('word-wrap'), false, '放得下就不换行');
  assert.equal(el3.style.fontSize, '', '放得下沿用 CSS 字号');
  // 轻度溢出但仍在最小字号以上：继续缩到整行可容纳
  const el4 = b.createEl('div');
  el4.clientWidth = 280; el4.scrollWidth = 420;
  b.T.fitWord(el4);
  assert.equal(el4.classList.contains('word-wrap'), false, '可读范围内仍保持单行');
  assert.ok(parseFloat(el4.style.fontSize) >= 34, '单行缩放不低于最小字号');
});

// ===========================================================================
// B. lang=en 语言标记
// ===========================================================================
test('单词卡词头 lang=en；判定后例句容器 lang=en、中文来源 lang=zh-CN', () => {
  const b = browser();
  b.T.startSession();
  assert.equal(b.attr('#card .word', 'lang'), 'en', '卡片词头标英文');
  revealCurrent(b);
  const ex = b.query('#card .ex[data-ex-linked]');
  assert.ok(ex, '判定后应有英文例句');
  assert.equal(ex.getAttribute('lang'), 'en', '英文例句容器标英文');
  const src = b.query('#card .ex .src');
  assert.ok(src, '例句应带来源');
  assert.equal(src.getAttribute('lang'), 'zh-CN', '中文来源保持中文');
  const mean = b.query('#card .mean');
  assert.equal(mean.getAttribute('lang'), null, '中文释义容器不得整体标英文');
});

test('词表单词按钮 lang=en，中文释义列不标英文', () => {
  const b = browser();
  b.T.show('list');
  const wordBtn = b.query('#listInner [data-open-word]');
  assert.ok(wordBtn, '词表应有单词按钮');
  assert.equal(wordBtn.getAttribute('lang'), 'en', '词表英文单词标 lang=en');
  assert.equal(b.query('#listInner .c-mean').getAttribute('lang'), null, '中文释义不标英文');
});

test('单词详情：词头 lang=en、例句 lang=en、来源 lang=zh-CN、释义保持中文', () => {
  const b = browser();
  const i = b.T.getW().findIndex(x => x.ex);
  assert.ok(i >= 0);
  b.T.openWord(i);
  assert.equal(b.query('#wordTitle').getAttribute('lang'), 'en', '详情词头标英文');
  assert.equal(b.query('#wordTitle').textContent, b.T.getW()[i].w);
  assert.equal(b.attr('#wordDetail .ex', 'lang'), 'en', '详情例句标英文');
  assert.equal(b.attr('#wordDetail .ex .src', 'lang'), 'zh-CN', '详情来源保持中文');
  assert.equal(b.query('#wordDetail .mean').getAttribute('lang'), null, '详情中文释义不标英文');
});

test('例句点词浮层的单词 lang=en，中文释义不标英文', () => {
  const b = browser();
  b.T.show('study');
  revealCurrent(b);
  const ex = b.query('#card .ex[data-ex-linked]');
  ex.focus();
  b.key('ArrowRight');
  b.key('Enter');
  assert.equal(b.query('#exPop').hidden, false, '浮层已打开');
  assert.equal(b.attr('#exPop .ex-pop-w', 'lang'), 'en', '浮层词头标英文');
  const mean = b.query('#exPop .ex-pop-m');
  assert.ok(mean, '浮层应有中文释义');
  assert.equal(mean.getAttribute('lang'), null, '中文释义不整体标英文');
});

test('义项原句 lang=en（WORD_SENSES 有效时），中文来源不标英文', () => {
  const b = browser();
  const W = b.T.getW();
  const i = W.findIndex(x => x.ex && x.w.length >= 4);
  assert.ok(i >= 0);
  const x = W[i];
  b.window.WORD_SENSES = {
    schemaVersion: 1,
    books: { kaoyan: { [x.w]: {
      preferred: [{ meaning: "语境义示例", examples: [{ source: "2021 年考研英语一 Text 2", quote: "The " + x.w + " matters here.", surface: x.w }] }],
      additional: ""
    } } }
  };
  b.T.setProficient(i, false);
  b.T.setCur(i);
  b.T.judge(true);
  const quote = b.query('#card .sense-quote');
  assert.ok(quote, '应渲染义项原句');
  assert.equal(quote.getAttribute('lang'), 'en', '义项英文原句标 lang=en');
  const source = b.query('#card .sense-source');
  assert.equal(source.getAttribute('lang'), null, '中文出处不继承英文');
});

// ===========================================================================
// C. 设备发音
// ===========================================================================
test('默认语音偏好：0.92 倍速、优先 en-US 英语语音、utterance lang=en-US', () => {
  const b = browser();
  const prefs = b.T.getSpeechPrefs();
  assert.equal(prefs.rate, 0.92, '默认语速沿用历史值 0.92');
  assert.equal(prefs.rateMin, 0.5);
  assert.equal(prefs.rateMax, 1.5);
  assert.ok(prefs.voices.length >= 2, '只收录英语语音（排除 zh-CN）');
  assert.ok(prefs.voices.every(v => /^en[-_]/i.test(v.lang)), '语音列表只含英语语音');
  assert.equal(b.T.speak('hello'), true, '有英语语音时应可发声');
  const u = b.speech.spoken.at(-1);
  assert.equal(u.text, 'hello');
  assert.equal(u.lang, 'en-US', '默认选 en-US');
  assert.equal(u.rate, 0.92);
  assert.equal(u.voice.voiceURI, 'Samantha', '默认选中的英语语音');
});

test('语音/语速偏好生效：选 en-GB + 1.2 倍速后朗读使用同一偏好', () => {
  const b = browser();
  b.T.setVoiceURI('Daniel');
  assert.equal(b.T.setSpeechRate(1.2), 1.2);
  b.T.speak('colour');
  const u = b.speech.spoken.at(-1);
  assert.equal(u.voice.voiceURI, 'Daniel');
  assert.equal(u.lang, 'en-GB');
  assert.equal(u.rate, 1.2);
  assert.equal(b.T.getS().settings.voiceURI, 'Daniel', '偏好写入每书设置');
  assert.equal(b.T.getS().settings.speechRate, 1.2);
});

test('语速边界：normalize 夹取 0.5–1.5，非法/缺省回退 0.92', () => {
  const b = browser();
  assert.equal(b.T.setSpeechRate(9), 1.5, '超过上限夹到 1.5');
  assert.equal(b.T.setSpeechRate(0.1), 0.5, '低于下限夹到 0.5');
  const norm = settings => b.T.normalizeState({settings, progress: {}, days: {}}).settings.speechRate;
  assert.equal(norm({speechRate: 5}), 1.5);
  assert.equal(norm({speechRate: 0.2}), 0.5);
  assert.equal(norm({speechRate: 'abc'}), 0.92);
  assert.equal(norm({}), 0.92, '旧记录缺字段默认 0.92');
  assert.equal(norm({speechRate: 1.234}), 1.23, '保留两位小数');
});

test('存储的 voiceURI 在当前设备失效时回退默认英语语音，并给出说明', () => {
  const b = browser();
  b.T.setVoiceURI('Missing-Voice-URI');
  assert.ok(b.text('#voiceHint').includes('不可用'), '设置页说明应提示已回退：' + b.text('#voiceHint'));
  assert.ok(b.text('#voiceHint').includes('回退'), '说明应含「回退」');
  assert.equal(b.T.speak('test'), true);
  assert.equal(b.speech.spoken.at(-1).voice.voiceURI, 'Samantha', '失效 URI 回退到默认 en-US');
});

test('voices 延迟到达：先空列表可用默认朗读，voiceschanged 后刷新可选语音', () => {
  const b = browser({voices: []});
  const before = b.T.getSpeechPrefs();
  assert.equal(before.voices.length, 0);
  assert.equal(before.voicesReady, false, '尚未拿到语音列表不等于设备没有英语语音');
  assert.ok(b.text('#voiceHint').includes('正在读取'), '加载中给出中性说明');
  assert.equal(b.T.speak('early'), true, '未拿到列表时仍可按系统默认朗读');
  assert.equal(b.speech.spoken.at(-1).lang, 'en-US');
  b.speech.setVoices(VOICES);
  b.speech.fireChanged();
  const after = b.T.getSpeechPrefs();
  assert.equal(after.voices.length, 2, 'voiceschanged 后刷新英语语音列表');
  assert.equal(b.query('#voiceSelect').disabled, false, '语音选择可用');
  assert.ok(b.query('#voiceSelect').innerHTML.includes('Samantha'), '下拉框包含设备语音');
  assert.ok(b.query('#voiceSelect').innerHTML.includes('跟随设备'), '保留「跟随设备」选项');
  b.T.speak('late');
  assert.equal(b.speech.spoken.at(-1).voice.voiceURI, 'Samantha', '延迟到达后使用设备语音');
});

test('设备没有英语语音：明确提示且不假装发声（不调用 speechSynthesis.speak）', () => {
  const b = browser({voices: []});
  b.speech.setVoices([{ name: 'Tingting', lang: 'zh-CN', voiceURI: 'Tingting' }]);
  b.speech.fireChanged();
  const prefs = b.T.getSpeechPrefs();
  assert.equal(prefs.voices.length, 0, '只把英语语音计入可用列表');
  assert.equal(prefs.voicesReady, true, '已确认设备无英语语音');
  assert.ok(b.text('#voiceHint').includes('没有可用的英语语音'), '设置页明确提示：' + b.text('#voiceHint'));
  const spokenBefore = b.speech.spoken.length;
  assert.equal(b.T.speak('hello'), false, '没有英语语音时不伪造成功');
  assert.equal(b.speech.spoken.length, spokenBefore, '不得调用 speak 假装发声');
  assert.ok(b.text('#toast').includes('没有可用的英语语音'), '给出可执行提示');
});

test('浏览器不支持 speechSynthesis：明确提示，不影响学习', () => {
  const b = browser({noSpeech: true});
  assert.equal(b.T.speak('hello'), false);
  assert.ok(String(b.text('#toast')).includes('不支持语音朗读'), '提示不支持：' + b.text('#toast'));
  assert.ok(String(b.text('#voiceHint')).includes('不支持'), '设置页说明能力边界');
  b.T.startSession();
  b.T.judge(true);
  assert.equal(b.T.phase, 'revealed', '发音不可用不影响判定与学习');
});

test('连续点击先取消上一段（cancel 在每次 speak 前调用）', () => {
  const b = browser();
  const c0 = b.speech.cancelCount;
  b.T.speak('one');
  b.T.speak('two');
  assert.equal(b.speech.cancelCount, c0 + 2, '每次朗读前取消上一段，避免叠音');
  assert.equal(b.speech.spoken.length, 2);
  assert.equal(b.speech.spoken.at(0).text, 'one');
  assert.equal(b.speech.spoken.at(-1).text, 'two');
});

test('自动发音与快捷键 S 都走同一语音/语速偏好', () => {
  const b = browser();
  b.T.setVoiceURI('Daniel');
  b.T.setSpeechRate(1.35);
  const S = b.T.getS();
  S.settings.autoSpk = true;
  Object.assign(S.settings, {order: 'freq', dailyNew: 20, fmin: 1, fmax: 0, pmin: 0});
  const spokenBefore = b.speech.spoken.length;
  b.T.startSession();
  assert.ok(b.speech.spoken.length > spokenBefore, '开启自动发音后进入卡片即朗读');
  const auto = b.speech.spoken.at(-1);
  assert.equal(auto.voice.voiceURI, 'Daniel', '自动发音使用选中语音');
  assert.equal(auto.rate, 1.35, '自动发音使用语速偏好');
  const beforeKey = b.speech.spoken.length;
  b.key('s');
  assert.ok(b.speech.spoken.length > beforeKey, '快捷键 S 触发朗读');
  assert.equal(b.speech.spoken.at(-1).voice.voiceURI, 'Daniel', '快捷键 S 同样使用偏好');
});

test('设置页发音控件：语音下拉、语速滑杆、试听按钮、能力说明文案', () => {
  const b = browser();
  const sel = b.query('#voiceSelect');
  assert.ok(sel, '应有语音选择');
  assert.equal(sel.querySelectorAll('option').length, 3, '「跟随设备」+ 2 个英语语音');
  const rate = b.query('#speechRate');
  assert.ok(rate, '应有语速控件');
  assert.equal(String(rate.value), '0.92');
  assert.equal(b.text('#speechRateVal'), '0.92×');
  // DOM 桩不会执行原生 range 的步进取整：从真实 HTML 校验可表示性，
  // 避免默认 0.92 被浏览器按 0.05 的步进自动吸附成 0.90。
  const rangeMarkup = html.match(/<input\b[^>]*\bid="speechRate"[^>]*>/)[0];
  const attrNumber = name => Number(rangeMarkup.match(new RegExp('\\b' + name + '="([^"]+)"'))[1]);
  const min = attrNumber('min'), step = attrNumber('step');
  for (const value of [0.92, 1.23]) {
    const steps = (value - min) / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, '原生滑杆必须能精确表示两位小数语速 ' + value);
  }
  const test = b.query('#btnVoiceTest');
  assert.ok(test, '应有试听按钮');
  const before = b.speech.spoken.length;
  test.click();
  assert.equal(b.speech.spoken.length, before + 1, '试听调用真实朗读入口');
  const hint = b.text('#voiceHint');
  assert.ok(hint.includes('不是词典原声'), '文案不得称词典原声');
  assert.ok(hint.includes('离线'), '说明离线发音取决于系统语音');
  assert.ok(!hint.includes('保证'), '不得承诺所有设备都能离线发音');
});

test('语音 URI 只接受字符串并截断；切书后设置页控件回显携带值', () => {
  const b = browser();
  b.T.setVoiceURI(123);
  assert.equal(b.T.getS().settings.voiceURI, '', '非字符串回退跟随设备');
  b.T.setVoiceURI('Daniel');
  b.T.switchBook('cet4');
  b.T.show('set');
  assert.equal(b.query('#voiceSelect').value, 'Daniel', '切书后控件回显携带的语音');
  assert.equal(String(b.query('#speechRate').value), '0.92');
});

test('字号/语音偏好随备份 v3 往返，不改变备份结构', () => {
  const b = browser();
  b.T.setFontSize('large');
  b.T.setVoiceURI('Daniel');
  b.T.setSpeechRate(1.1);
  const data = b.T.buildExport();
  assert.equal(data.version, 3, '备份仍为 v3，不新增版本');
  assert.equal(data.books.kaoyan.settings.fontSize, 'large', '字号在备份 settings 内');
  assert.equal(data.books.kaoyan.settings.voiceURI, 'Daniel');
  assert.equal(data.books.kaoyan.settings.speechRate, 1.1);
  const roundtrip = b.T.normalizeState(clone(data.books.kaoyan)).settings;
  assert.equal(roundtrip.fontSize, 'large');
  assert.equal(roundtrip.voiceURI, 'Daniel');
  assert.equal(roundtrip.speechRate, 1.1);
});

console.log(`\n12 大字/lang=en/设备发音：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
