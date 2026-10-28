/**
 * R05 单词 / 例句朗读与统一播放控制回归。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱；DOM 桩只模拟浏览器，假 speechSynthesis 捕获 utterance）。
 * 覆盖：单词与例句控制组结构、判定前不出现例句声音（防泄题）、正常/慢速语速公式、
 * loading→playing→ended 状态机与五种状态文案、停止与迟到回调失效、aria-pressed、
 * 换词/切页/开浮层/切书/撤销后不串卡（同一单词的判定不算换场景）、
 * 无英语语音 / 无 speechSynthesis / 页面隐藏的明确拒绝、自动发音、朗读只读性。
 * 复核修复（E2）：真实派发 visibilitychange 事件即停止朗读、开/关例句查词浮层停止旧朗读、
 * 拼写专项换词 / 完成一组 / 再来一组停止旧朗读。
 * 不依赖真实等待：直接调用假 utterance 的 onstart/onend 驱动回调。
 * 运行：node --max-old-space-size=512 js/test-audio-playback.mjs
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
const cet = fs.readFileSync(path.join(ROOT, "js/cet-words-data.js"), "utf8");
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

/**
 * 与 js/test-a11y.mjs 相同的装载方式：真实 index.html 解析成 DOM 桩，真实 app.js 跑在 vm 里。
 * speechSynthesis 用假对象，utterance 的 onstart/onend 由测试直接驱动。
 */
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
    constructor(text) {
      this.text = String(text); this.lang = ""; this.rate = 1; this.voice = null;
      this.onstart = null; this.onend = null; this.onerror = null;
    }
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
    setTimeout(){ return 0; }, clearTimeout(){}, requestAnimationFrame(fn){fn();}, cancelAnimationFrame(){},
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

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}
/** 不抛 assert 的定位断言：失败时带中文标签与细节。 */
function ck(cond, label, detail) {
  if (!cond) throw new Error(label + (detail === undefined ? '' : '（实际：' + detail + '）'));
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** 开一组主学习（首卡为回忆态）。 */
function fresh() {
  const b = browser();
  b.T.startSession();
  return b;
}
function cardWord(b) { return b.T.getW()[b.T.cur]; }
function audioState(b) { return b.T.getSpeechPlayback(); }
function speakLast(b) { return b.speech.spoken[b.speech.spoken.length - 1]; }
function wordGroup(b) { return b.query('#card .word-face .word-audio'); }
function sentenceGroup(b) { return b.query('#card .answer [data-audio-text]'); }
function wordStatus(b) { return b.text('#wordAudioStatus'); }
/** 学习记录只读快照：progress/days/reviewDay/extraDay/timeSec/stars/proficient/settings。 */
function importantState(b) {
  const S = b.T.getS();
  return JSON.stringify({
    progress: S.progress, days: S.days, reviewDay: S.reviewDay, extraDay: S.extraDay,
    timeSec: S.timeSec, stars: S.stars, proficient: S.proficient, settings: S.settings
  });
}
function contextState(b) {
  const T = b.T;
  return JSON.stringify({ cur: T.cur, verdict: T.verdict, phase: T.phase, qi: T.qi, answered: T.answered, queue: T.Q.length });
}
/** 场景变化后：单词卡不得显示为正在播放。 */
function expectCardNotPlaying(b, label) {
  ck(!['准备中', '朗读中'].includes(wordStatus(b)),
    label + ' #wordAudioStatus 不得显示新卡在播放', JSON.stringify(wordStatus(b)));
  ck(b.T.getSpeechPlayback().status !== 'playing' && b.T.getSpeechPlayback().status !== 'loading',
    label + ' 播放状态不得停留在 loading/playing', b.T.getSpeechPlayback().status);
  if (b.query('#spk')) ck(b.attr('#spk', 'aria-pressed') !== 'true', label + ' #spk 不得 aria-pressed=true');
  if (b.query('#spkSlow')) ck(b.attr('#spkSlow', 'aria-pressed') !== 'true', label + ' #spkSlow 不得 aria-pressed=true');
}
/**
 * 真实派发 document 的 visibilitychange 事件（走 app.js 注册的监听），
 * 而不是只改 document.visibilityState 属性；后者不会触发任何清理，见旧隐藏属性用例。
 */
function fireVisibilityChange(b, state) {
  b.doc.visibilityState = state;
  b.doc.dispatch('visibilitychange', {});
}
/** 用最小主组（1 词）快速到达完成页，再从真实入口 #startSpellingBtn 打开拼写专项。 */
function spellingBrowser() {
  const b = browser();
  const T = b.T;
  T.getS().settings.dailyNew = 1;
  T.getS().settings.groupSize = 1;
  T.startSession();
  if (T.cur != null) {
    T.judge(true);
    if (T.cur != null) T.tryNext();
  }
  assert.equal(T.cur, null, '主组应已到完成页（拼写专项入口条件）');
  return b;
}
function openSpellingDrill(b) {
  const btn = b.query('#startSpellingBtn');
  assert.ok(btn, '完成页应有拼写专项入口');
  btn.click();
  assert.equal(b.query('#spellingSheet').hidden, false, '拼写专项浮层已打开');
  const st = b.T.getSpellingState();
  assert.equal(st.active, true);
  assert.equal(st.phase, 'input');
  assert.ok(st.total > 0);
  return st;
}
/** 逐词跳过推进到本组最后一张（注意：最后一张上再点下一词会直接收尾）。 */
function advanceSpellingToLast(b) {
  const T = b.T;
  let guard = 0;
  while (guard++ < 20) {
    const st = T.getSpellingState();
    if (st.index >= st.total - 1) return st;
    if (st.phase === 'input') T.skipSpellingWord();
    T.nextSpellingWord();
  }
  throw new Error('拼写专项未能推进到最后一张');
}

// ===========================================================================
// A. DOM 与结构
// ===========================================================================
test('单词朗读组：回忆态渲染 #spk/#spkSlow/#spkStop 与状态位，停止初始禁用、保留图标', () => {
  const b = fresh();
  const group = wordGroup(b);
  assert.ok(group, '回忆态应在 #card .word-face 内渲染 .word-audio 组');
  assert.equal(group.getAttribute('role'), 'group', '单词朗读组应声明 role=group');
  assert.equal(group.getAttribute('aria-label'), '单词朗读');
  const spk = b.query('#spk');
  assert.ok(spk, '应有正常语速按钮 #spk');
  assert.ok(b.query('#spk svg'), '#spk 应保留 svg 图标');
  assert.equal(spk.getAttribute('aria-label'), '朗读单词（正常语速）');
  assert.equal(spk.getAttribute('aria-pressed'), 'false', '未播放时 aria-pressed=false');
  const slow = b.query('#spkSlow');
  assert.ok(slow, '应有慢速按钮 #spkSlow');
  assert.equal(slow.textContent, '慢速');
  assert.equal(slow.getAttribute('aria-label'), '慢速朗读单词');
  assert.equal(slow.getAttribute('aria-pressed'), 'false');
  const stop = b.query('#spkStop');
  assert.ok(stop, '应有停止按钮 #spkStop');
  assert.equal(stop.getAttribute('aria-label'), '停止朗读');
  assert.equal(stop.disabled, true, '未播放时停止按钮初始禁用');
  const status = b.query('#wordAudioStatus');
  assert.ok(status, '应有单词播放状态位 #wordAudioStatus');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.textContent, '', '未播放时状态位无文案');
});

test('释义态仍渲染同一组单词朗读控制，不与例句控制混在一起', () => {
  const b = fresh();
  b.T.judge(true);
  assert.equal(b.T.verdict, true);
  const group = wordGroup(b);
  assert.ok(group, '释义态仍应在 .word-face 内保留单词朗读组');
  assert.ok(b.query('#spk') && b.query('#spkSlow') && b.query('#spkStop'), '三个按钮仍齐全');
  assert.equal(b.all('#spk').length, 1, '不应出现第二套 #spk');
  assert.equal(b.query('#spkStop').disabled, true, '没有播放时停止按钮仍禁用');
  assert.equal(wordStatus(b), '');
  assert.equal(b.query('#card .answer').contains(b.query('#spk')), false, '单词控制组不应放进释义区');
});

test('判定前不渲染例句朗读，判定后才出现（避免声音泄题）', () => {
  const b = fresh();
  assert.equal(b.query('#card .answer'), null, '回忆态不出现释义区');
  assert.equal(b.all('#card [data-audio-play]').length, 0, '回忆态不得出现例句播放按钮');
  assert.equal(b.all('#card .audio-controls').length, 0, '回忆态不得出现例句控制组');
  assert.equal(b.all('#card [data-audio-text]').length, 0);
  b.T.judge(true);
  assert.ok(b.query('#card .answer'), '判定后出现释义区');
  const group = b.query('#card .answer .audio-controls');
  assert.ok(group, '判定后释义区内出现例句控制组');
  assert.equal(group.getAttribute('data-audio-kind'), 'sentence');
  assert.equal(b.all('#card .answer [data-audio-play]').length, 2, '正常/慢速两个播放按钮');
  assert.equal(b.all('#card .answer [data-audio-stop]').length, 1, '一个停止按钮');
  b.T.undo();
  assert.equal(b.T.phase, 'recall');
  assert.equal(b.all('#card [data-audio-play]').length, 0, '撤销回回忆态后例句朗读入口消失，避免泄题');
});

test('例句朗读只读英文原句 ex，不含中文来源标签', () => {
  const b = fresh();
  b.T.judge(true);
  const x = cardWord(b);
  const group = sentenceGroup(b);
  assert.ok(group, '释义区应有带 data-audio-text 的例句朗读组');
  assert.equal(group.getAttribute('data-audio-kind'), 'sentence');
  assert.equal(group.dataset.audioText, x.ex, '朗读文本必须等于该词 11 元组的 ex');
  assert.ok(String(group.dataset.audioKey).startsWith('sentence:'), '例句朗读键应以 sentence: 开头');
  assert.ok(b.query('#card .answer .ex'), '界面同时有可点词例句');
  const srcText = b.text('#card .answer .ex .src');
  assert.ok(srcText && srcText.includes('例句'), '例句来源徽标应存在：' + srcText);
  assert.notEqual(group.dataset.audioText, srcText, '朗读文本不能等于来源徽标文本');
  assert.ok(!group.dataset.audioText.includes('真题例句'), '朗读文本不得夹入「真题例句」标签');
  assert.ok(!group.dataset.audioText.includes('自编例句'), '朗读文本不得夹入「自编例句」标签');
  assert.equal(b.attr('#card .answer [data-audio-play="normal"]', 'aria-label'), '朗读例句');
  assert.equal(b.attr('#card .answer [data-audio-play="slow"]', 'aria-label'), '慢速朗读例句');
  assert.equal(b.query('#card .answer [data-audio-stop]').disabled, true, '未播放时例句停止按钮禁用');
  const status = b.query('#card .answer .audio-status');
  assert.ok(status, '例句组应有 .audio-status 状态位');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
});

test('单词详情浮层 #wordDetail 也有例句朗读组，可直接播放与停止', () => {
  const b = fresh();
  const T = b.T;
  const i = T.getW().findIndex(y => y.ex);
  assert.ok(i >= 0, '词库应有带例句的词');
  T.openWord(i);
  assert.equal(b.query('#wordSheet').hidden, false, '单词详情浮层已打开');
  const group = b.query('#wordDetail [data-audio-text]');
  assert.ok(group, '详情内应有例句朗读组（打开详情即属允许阶段）');
  assert.equal(group.getAttribute('data-audio-kind'), 'sentence');
  assert.equal(group.dataset.audioText, T.getW()[i].ex, '详情朗读文本等于该词 ex');
  assert.equal(b.all('#wordDetail [data-audio-text]').length, 1);
  assert.equal(b.query('#wordDetail [data-audio-stop]').disabled, true, '未播放时详情停止按钮禁用');
  const spokenBefore = b.speech.spoken.length;
  const cancelBefore = b.speech.cancelCount;
  b.query('#wordDetail [data-audio-play="normal"]').click();
  assert.equal(b.speech.spoken.length, spokenBefore + 1, '点击详情「朗读例句」应交给 speechSynthesis');
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '每次朗读前先取消上一段');
  assert.equal(speakLast(b).text, T.getW()[i].ex);
  assert.equal(audioState(b).kind, 'sentence');
  assert.equal(audioState(b).status, 'loading');
  speakLast(b).onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(b.attr('#wordDetail [data-audio-play="normal"]', 'aria-pressed'), 'true');
  assert.equal(b.attr('#wordDetail [data-audio-play="slow"]', 'aria-pressed'), 'false');
  assert.equal(b.text('#wordDetail .audio-status'), '朗读中');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false', '例句朗读不得把单词按钮显示为播放中');
  assert.equal(wordStatus(b), '', '例句朗读不改单词状态位');
  b.query('#wordDetail [data-audio-stop]').click();
  assert.equal(audioState(b).status, 'stopped');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(b.query('#wordDetail [data-audio-stop]').disabled, true);
  assert.equal(b.attr('#wordDetail [data-audio-play="normal"]', 'aria-pressed'), 'false');
  assert.equal(b.text('#wordDetail .audio-status'), '已停止');
  T.closeSheet();
  assert.equal(b.query('#wordSheet').hidden, true, '详情浮层可关闭');
});

test('统一控制组生成器 audioControlsHtml：正常/慢速/停止/状态齐全，空文本不生成', () => {
  const b = browser();
  const T = b.T;
  const sentence = T.audioControlsHtml('Hello, world.', 'sentence');
  assert.equal(typeof sentence, 'string');
  assert.ok(sentence.includes('data-audio-text="Hello, world."'), '例句组带原文 data-audio-text');
  assert.ok(sentence.includes('data-audio-kind="sentence"'));
  assert.ok(sentence.includes('data-audio-key="sentence:'), '带例句朗读键');
  assert.ok(sentence.includes('data-audio-play="normal"'));
  assert.ok(sentence.includes('data-audio-play="slow"'));
  assert.ok(sentence.includes('data-audio-stop'));
  assert.ok(sentence.includes('aria-label="慢速朗读例句"'));
  assert.ok(sentence.includes('class="audio-status"'));
  const word = T.audioControlsHtml('word', 'word');
  assert.ok(word.includes('data-audio-kind="word"'));
  assert.ok(word.includes('aria-label="朗读单词"'));
  assert.equal(T.audioControlsHtml('', 'sentence'), '', '空文本不生成控制组');
  assert.equal(T.audioControlsHtml('   '), '', '纯空白不生成控制组');
  assert.equal(T.audioControlsHtml(null, 'sentence'), '', '非字符串不生成控制组');
});

// ===========================================================================
// B. 正常 / 慢速 / 状态机
// ===========================================================================
test('正常朗读：英语语音、settings.speechRate、loading→playing→ended 与状态位', () => {
  const b = fresh();
  const T = b.T;
  assert.equal(T.setSpeechRate(1.25), 1.25);
  const x = cardWord(b);
  const spokenBefore = b.speech.spoken.length;
  const cancelBefore = b.speech.cancelCount;
  assert.equal(T.speak(x.w, { kind: 'word' }), true, '有英语语音时交给 speechSynthesis 并返回 true');
  assert.equal(b.speech.spoken.length, spokenBefore + 1);
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '朗读前先 cancel 上一段');
  const u = speakLast(b);
  assert.equal(u.text, x.w);
  assert.equal(u.lang, 'en-US', '默认选英语语音，不用中文语音读英文');
  assert.equal(u.voice.voiceURI, 'Samantha');
  assert.equal(u.rate, 1.25, '正常语速应用 settings.speechRate');
  const p = audioState(b);
  assert.equal(p.status, 'loading');
  assert.equal(p.kind, 'word');
  assert.equal(p.slow, false);
  assert.equal(p.text, x.w);
  assert.ok(String(p.key).startsWith('word:'));
  assert.equal(T.speechStatusLabel(), '准备中');
  assert.equal(wordStatus(b), '准备中');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true', '加载中即可认为该控制组在播放');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  assert.equal(b.query('#spkStop').disabled, false, '播放中停止按钮可用');
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(T.speechStatusLabel(), '朗读中');
  assert.equal(wordStatus(b), '朗读中');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  u.onend();
  assert.equal(audioState(b).status, 'ended');
  assert.equal(T.speechStatusLabel(), '已结束');
  assert.equal(wordStatus(b), '已结束');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false', '结束后恢复正常状态');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  assert.equal(b.query('#spkStop').disabled, true, '结束后停止按钮回到禁用');
});

test('慢速朗读：utterance.rate = max(0.5, min(rate, rate*0.75))，不写回语速偏好', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.setSpeechRate(1.2);
  assert.equal(T.speak(x.w, { kind: 'word', slow: true }), true);
  assert.ok(near(speakLast(b).rate, Math.max(0.5, Math.min(1.2, 1.2 * 0.75))),
    '慢速应为 max(0.5, min(rate, rate*0.75))，实际 ' + speakLast(b).rate);
  assert.ok(near(speakLast(b).rate, 0.9));
  assert.equal(audioState(b).slow, true);
  assert.equal(T.getS().settings.speechRate, 1.2, '慢速只是本次播放，不改持久化语速偏好');
  speakLast(b).onstart();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'true');
  // 下界：0.5 倍速的 0.75 倍不得低于 0.5
  T.setSpeechRate(0.5);
  T.speak(x.w, { kind: 'word', slow: true });
  assert.ok(near(speakLast(b).rate, 0.5), '慢速不得低于 0.5 下限，实际 ' + speakLast(b).rate);
  // 上界：1.5 倍速的慢速 = 1.125
  T.setSpeechRate(1.5);
  T.speak(x.w, { kind: 'word', slow: true });
  assert.ok(near(speakLast(b).rate, 1.125), '1.5 倍速的慢速为 1.125，实际 ' + speakLast(b).rate);
  // 正常朗读仍用 settings.speechRate
  T.speak(x.w, { kind: 'word' });
  assert.ok(near(speakLast(b).rate, 1.5), '正常朗读仍应用 settings.speechRate');
  assert.equal(audioState(b).slow, false);
});

test('点击 #spkSlow 与 #spk 分别走慢速公式与正常速率', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.setSpeechRate(1.4);
  const spokenBefore = b.speech.spoken.length;
  const cancelBefore = b.speech.cancelCount;
  b.query('#spkSlow').click();
  assert.equal(b.speech.spoken.length, spokenBefore + 1, '点击慢速应朗读');
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '慢速朗读前先取消上一段');
  assert.ok(near(speakLast(b).rate, 1.05), '点击慢速同样应用慢速公式，实际 ' + speakLast(b).rate);
  assert.equal(audioState(b).kind, 'word');
  assert.equal(audioState(b).slow, true);
  speakLast(b).onstart();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'true');
  const beforeNormal = b.speech.spoken.length;
  const cancelBeforeNormal = b.speech.cancelCount;
  b.query('#spk').click();
  assert.equal(b.speech.spoken.length, beforeNormal + 1, '点击正常语速应朗读');
  assert.equal(b.speech.cancelCount, cancelBeforeNormal + 1, '正常朗读前也先取消上一段');
  assert.ok(near(speakLast(b).rate, 1.4), '点击 #spk 使用 settings.speechRate，实际 ' + speakLast(b).rate);
  assert.equal(audioState(b).slow, false);
  speakLast(b).onstart();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  assert.equal(T.getS().settings.speechRate, 1.4, '点击慢速不修改持久化语速');
});

test('speechStatusLabel 只返回契约内五种朗读状态文案', () => {
  const allowed = ['准备中', '朗读中', '已结束', '已停止', '朗读失败'];
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  assert.equal(T.speechStatusLabel(), '', '未播放时没有状态文案');
  T.speak(x.w);
  assert.equal(T.speechStatusLabel(), '准备中');
  assert.ok(allowed.includes(T.speechStatusLabel()));
  speakLast(b).onstart();
  assert.equal(T.speechStatusLabel(), '朗读中');
  speakLast(b).onend();
  assert.equal(T.speechStatusLabel(), '已结束');
  T.speak(x.w);
  speakLast(b).onstart();
  T.stopSpeech();
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.ok(allowed.includes(T.speechStatusLabel()));
  const b2 = browser({ voices: [] });
  b2.speech.setVoices([{ name: 'Tingting', lang: 'zh-CN', voiceURI: 'Tingting' }]);
  b2.speech.fireChanged();
  b2.T.startSession();
  assert.equal(b2.T.speak(cardWord(b2).w), false);
  assert.equal(b2.T.speechStatusLabel(), '朗读失败');
  assert.ok(allowed.includes(b2.T.speechStatusLabel()));
});

// ===========================================================================
// C. 停止与迟到回调
// ===========================================================================
test('stopSpeech：cancel、stopped、停止键禁用，旧 utterance 迟到回调不改写状态', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w);
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  const cancelBefore = b.speech.cancelCount;
  assert.equal(T.stopSpeech(), true, '播放中停止返回 true');
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '停止应调用 speechSynthesis.cancel');
  assert.equal(audioState(b).status, 'stopped');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(b.query('#spkStop').disabled, true, '停止后停止按钮禁用');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false', '停止后正常按钮复位');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  assert.equal(wordStatus(b), '已停止');
  // 旧 utterance 迟到的 onend/onstart 不能把状态改回 ended/playing
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '旧 onend 不得改写停止状态');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(wordStatus(b), '已停止');
  u.onstart();
  assert.equal(audioState(b).status, 'stopped', '旧 onstart 不得把已停止改回播放中');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  // 空闲时 stopSpeech 返回 false，但仍保证调用 cancel
  const cancelIdle = b.speech.cancelCount;
  assert.equal(T.stopSpeech(), false);
  assert.equal(b.speech.cancelCount, cancelIdle + 1);
  assert.equal(audioState(b).status, 'stopped', '空闲停止不产生新的播放状态');
});

test('点击 #spkStop 停止朗读，旧 utterance 迟到 onend 不改成「已结束」', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  b.query('#spk').click();
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  const cancelBefore = b.speech.cancelCount;
  b.query('#spkStop').click();
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '点击停止调用 cancel');
  assert.equal(audioState(b).status, 'stopped');
  assert.equal(b.query('#spkStop').disabled, true);
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '停止后迟到的 onend 不得标成 ended');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(wordStatus(b), '已停止');
});

test('连续两次点击只保留最后一段：每次 speak 前 cancel 计数增加', () => {
  const b = fresh();
  const x = cardWord(b);
  const spokenBefore = b.speech.spoken.length;
  const cancelBefore = b.speech.cancelCount;
  b.query('#spk').click();
  b.query('#spk').click();
  assert.equal(b.speech.spoken.length, spokenBefore + 2, '两次点击产生两段朗读请求');
  assert.equal(b.speech.cancelCount, cancelBefore + 2, '每次 speak 前都先 cancel');
  assert.equal(speakLast(b).text, x.w);
  assert.equal(audioState(b).text, x.w, '播放状态记录最后一次朗读');
  const slowSpoken = b.speech.spoken.length;
  const slowCancel = b.speech.cancelCount;
  b.query('#spkSlow').click();
  b.query('#spkSlow').click();
  assert.equal(b.speech.spoken.length, slowSpoken + 2);
  assert.equal(b.speech.cancelCount, slowCancel + 2);
  assert.equal(audioState(b).slow, true, '最后一段是慢速');
  const directSpoken = b.speech.spoken.length;
  const directCancel = b.speech.cancelCount;
  b.T.speak('first-segment', { kind: 'word' });
  b.T.speak('second-segment', { kind: 'word' });
  assert.equal(b.speech.spoken.length, directSpoken + 2);
  assert.equal(b.speech.cancelCount, directCancel + 2, '钩子入口同样每次先 cancel');
  assert.equal(speakLast(b).text, 'second-segment', '只有最后一段生效');
});

test('旧一段的迟到回调不能改写新一段的状态', () => {
  const b = fresh();
  const T = b.T;
  assert.equal(T.speak('alpha', { kind: 'word' }), true);
  const uA = speakLast(b);
  uA.onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(T.speak('beta', { kind: 'word' }), true);
  const uB = speakLast(b);
  assert.equal(audioState(b).status, 'loading', '新一段进入加载态');
  uA.onend();
  assert.equal(audioState(b).status, 'loading', '旧一段 onend 不得结束新一段');
  uA.onstart();
  assert.equal(audioState(b).status, 'loading', '旧一段 onstart 不得开始新一段');
  uB.onstart();
  assert.equal(audioState(b).status, 'playing');
  uA.onend();
  assert.equal(audioState(b).status, 'playing', '播放中旧回调不得结束新一段');
  uB.onend();
  assert.equal(audioState(b).status, 'ended');
});

// ===========================================================================
// D. aria-pressed
// ===========================================================================
test('播放中对应控制组 aria-pressed=true（正常/慢速区分），结束后复位', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  speakLast(b).onstart();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true', '正常播放时 #spk 按下');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false', '正常播放时慢速不按下');
  T.speak(x.w, { kind: 'word', slow: true });
  speakLast(b).onstart();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false', '慢速播放时正常不按下');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'true', '慢速播放时 #spkSlow 按下');
  T.stopSpeech();
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  // 例句组：正常/慢速复用同一套 aria-pressed 口径
  T.judge(true);
  b.query('#card .answer [data-audio-play="normal"]').click();
  speakLast(b).onstart();
  assert.equal(b.attr('#card .answer [data-audio-play="normal"]', 'aria-pressed'), 'true');
  assert.equal(b.attr('#card .answer [data-audio-play="slow"]', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false', '例句朗读时单词按钮不按下');
  b.query('#card .answer [data-audio-play="slow"]').click();
  speakLast(b).onstart();
  assert.equal(b.attr('#card .answer [data-audio-play="normal"]', 'aria-pressed'), 'false');
  assert.equal(b.attr('#card .answer [data-audio-play="slow"]', 'aria-pressed'), 'true');
  b.query('#card .answer [data-audio-stop]').click();
  assert.equal(b.attr('#card .answer [data-audio-play="normal"]', 'aria-pressed'), 'false');
  assert.equal(b.attr('#card .answer [data-audio-play="slow"]', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
});

// ===========================================================================
// E. 场景变化 / 迟到回调不串卡
// ===========================================================================
test('播放中翻到下一词：先失效旧回调再取消，旧回调不串新卡', () => {
  const b = fresh();
  const T = b.T;
  T.judge(true);
  const oldIndex = T.cur;
  const oldWord = cardWord(b).w;
  T.speak(oldWord, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const cancelBefore = b.speech.cancelCount;
  const spokenBefore = b.speech.spoken.length;
  T.tryNext();
  assert.notEqual(T.cur, oldIndex, '应换到下一词');
  assert.equal(audioState(b).status, 'stopped', '换词后旧朗读被停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '换词场景变化只 cancel 一次');
  expectCardNotPlaying(b, '换到下一词后');
  u.onstart();
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '旧 utterance 迟到回调不得把新卡标成播放/结束');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(b.speech.spoken.length, spokenBefore, '旧回调不得重新交给 speechSynthesis');
  expectCardNotPlaying(b, '旧回调之后');
});

test('播放中切页：show("stats")/show("study") 令旧朗读失效，迟到回调不串页', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const cancelBefore = b.speech.cancelCount;
  T.show('stats');
  assert.equal(audioState(b).status, 'stopped', '切到统计页后旧朗读停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1);
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  u.onstart();
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '切页后迟到回调不改状态');
  expectCardNotPlaying(b, '切到统计页后');
  // 统计页新起一段，返回背诵页也应失效
  assert.equal(T.speak(x.w, { kind: 'word' }), true);
  const u2 = speakLast(b);
  u2.onstart();
  assert.equal(audioState(b).status, 'playing');
  const cancelBack = b.speech.cancelCount;
  T.show('study');
  assert.equal(audioState(b).status, 'stopped', '从统计页返回背诵页后旧朗读停止');
  assert.equal(b.speech.cancelCount, cancelBack + 1);
  u2.onend();
  assert.equal(audioState(b).status, 'stopped', '返回背诵页后迟到 onend 被忽略');
});

test('播放中打开单词详情浮层：旧单词朗读停止，迟到回调不恢复', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const cancelBefore = b.speech.cancelCount;
  const i = T.getW().findIndex(y => y.ex);
  T.openWord(i);
  assert.equal(b.query('#wordSheet').hidden, false, '单词详情浮层已打开');
  assert.equal(audioState(b).status, 'stopped', '开浮层后旧朗读停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1);
  u.onstart();
  u.onend();
  assert.equal(audioState(b).status, 'stopped');
  expectCardNotPlaying(b, '打开详情浮层后');
  // 关闭浮层也不得让旧回调恢复
  T.closeSheet();
  u.onend();
  assert.equal(audioState(b).status, 'stopped');
});

test('同一单词的判定/改判不打断单词朗读；撤销导致阶段回退会停止例句朗读', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const cancelBefore = b.speech.cancelCount;
  T.judge(true);
  assert.equal(T.verdict, true);
  assert.equal(audioState(b).status, 'playing', '同一单词判定不打断单词朗读');
  assert.equal(b.speech.cancelCount, cancelBefore, '判定不应 cancel 单词朗读');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true');
  assert.equal(wordStatus(b), '朗读中');
  T.judge(false);
  assert.equal(T.verdict, false);
  assert.equal(audioState(b).status, 'playing', '同卡改判也不打断单词朗读');
  assert.equal(b.speech.cancelCount, cancelBefore);
  u.onend();
  assert.equal(audioState(b).status, 'ended');
  // 例句朗读：阶段回退（撤销判定）时必须停止
  const b2 = fresh();
  const T2 = b2.T;
  T2.judge(true);
  b2.query('#card .answer [data-audio-play="normal"]').click();
  const uEx = speakLast(b2);
  uEx.onstart();
  assert.equal(audioState(b2).status, 'playing');
  const cancelEx = b2.speech.cancelCount;
  T2.undo();
  assert.equal(T2.phase, 'recall', '撤销回到回忆态');
  assert.equal(audioState(b2).status, 'stopped', '阶段回退后例句朗读停止');
  assert.equal(b2.speech.cancelCount, cancelEx + 1);
  assert.equal(b2.all('#card [data-audio-play]').length, 0, '回忆态不再有例句朗读入口');
  uEx.onend();
  assert.equal(audioState(b2).status, 'stopped', '例句旧回调不得恢复播放');
});

test('stopSpeechIfSceneChanged 先让旧回调失效再 cancel（cancel 内同步回调也不改写状态）', () => {
  const b = fresh();
  const T = b.T;
  T.judge(true);
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const oldId = audioState(b).id;
  const originalCancel = b.speech.cancel;
  const seen = {};
  b.speech.cancel = () => {
    originalCancel.call(b.speech);
    seen.during = audioState(b);
    u.onend();                       // 模拟某些设备 cancel 时同步触发旧 utterance 回调
    seen.afterCallback = audioState(b).status;
  };
  T.tryNext();
  assert.ok(seen.during, '场景变化应调用 cancel');
  assert.equal(seen.during.status, 'stopped', 'cancel 时状态已先置为 stopped（旧回调已失效）');
  assert.equal(seen.during.context, null, 'cancel 时旧场景上下文已清空');
  assert.equal(seen.during.id, oldId + 1, 'cancel 时播放代次已推进，旧 utterance 不再 current');
  assert.equal(seen.afterCallback, 'stopped', 'cancel 内同步触发的旧 onend 不能改写状态');
  assert.equal(audioState(b).status, 'stopped');
  assert.equal(T.speechStatusLabel(), '已停止');
});

test('切书后旧书朗读失效，迟到回调不串到新书', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w, { kind: 'word' });
  const u = speakLast(b);
  u.onstart();
  const cancelBefore = b.speech.cancelCount;
  T.switchBook('cet4');
  assert.equal(T.getBook(), 'cet4');
  assert.equal(audioState(b).status, 'stopped', '切书后旧书朗读停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1);
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '切书后旧回调被忽略');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
});

// ===========================================================================
// E2. 复核修复：页面隐藏 / 例句查词浮层 / 拼写专项的真实场景清理
// ===========================================================================
test('播放中真实派发 visibilitychange（hidden）立即停止单词朗读，回前台不复播', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  T.speak(x.w);
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  const cancelBefore = b.speech.cancelCount;
  fireVisibilityChange(b, 'hidden');
  assert.equal(audioState(b).status, 'stopped', '进入后台触发 visibilitychange 后应停止朗读');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '后台停止同样走统一 cancel');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  assert.equal(b.attr('#spkSlow', 'aria-pressed'), 'false');
  assert.equal(b.query('#spkStop').disabled, true, '后台停止后停止按钮回禁用');
  assert.ok(['', '已停止'].includes(wordStatus(b)),
    '#wordAudioStatus 只能为空或「已停止」，实际 ' + JSON.stringify(wordStatus(b)));
  // 旧 utterance 迟到回调不得改写停止状态
  u.onstart();
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '后台停止后迟到回调不得恢复播放/结束');
  assert.equal(T.speechStatusLabel(), '已停止');
  // 回到前台再派发事件：不得恢复播放或显示朗读中
  fireVisibilityChange(b, 'visible');
  assert.equal(audioState(b).status, 'stopped', '回到前台后状态仍为已停止');
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.ok(['', '已停止'].includes(wordStatus(b)),
    '回到前台后 #wordAudioStatus 不得显示朗读中，实际 ' + JSON.stringify(wordStatus(b)));
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  // 没有播放时后台事件不产生新的 cancel/状态
  const cancelIdle = b.speech.cancelCount;
  fireVisibilityChange(b, 'hidden');
  assert.equal(audioState(b).status, 'stopped');
  assert.equal(b.speech.cancelCount, cancelIdle, '没有播放时后台事件不再 cancel');
  fireVisibilityChange(b, 'visible');
});

test('例句朗读中真实派发 visibilitychange（hidden）停止，例句状态位不残留「朗读中」', () => {
  const b = fresh();
  const T = b.T;
  T.judge(true);
  b.query('#card .answer [data-audio-play="normal"]').click();
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(b.text('#card .answer .audio-status'), '朗读中');
  const cancelBefore = b.speech.cancelCount;
  fireVisibilityChange(b, 'hidden');
  assert.equal(audioState(b).status, 'stopped', '例句朗读进入后台后停止');
  assert.equal(b.speech.cancelCount, cancelBefore + 1);
  assert.equal(b.attr('#card .answer [data-audio-play="normal"]', 'aria-pressed'), 'false');
  assert.equal(b.attr('#card .answer [data-audio-play="slow"]', 'aria-pressed'), 'false');
  assert.equal(b.query('#card .answer [data-audio-stop]').disabled, true);
  const sentenceStatus = b.text('#card .answer .audio-status');
  assert.ok(['', '已停止'].includes(sentenceStatus),
    '例句 .audio-status 只能为空或「已停止」，实际 ' + JSON.stringify(sentenceStatus));
  u.onend();
  u.onstart();
  assert.equal(audioState(b).status, 'stopped', '例句迟到回调不得改写后台停止');
  fireVisibilityChange(b, 'visible');
  assert.equal(audioState(b).status, 'stopped', '回到前台不得恢复例句朗读');
  assert.ok(['', '已停止'].includes(b.text('#card .answer .audio-status')));
});

test('例句查词浮层开/关都会停止旧朗读，迟到回调不恢复', () => {
  const b = fresh();
  const T = b.T;
  T.judge(true);
  const x = cardWord(b);
  b.query('#card .answer [data-audio-play="normal"]').click();
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  // 从例句里选一个可查词作为锚点；找不到时退回当前词（锚点仍是例句内的 .ex-word 节点）
  let anchor = null, token = '';
  for (const el of b.all('#card .answer .ex .ex-word')) {
    const word = el.getAttribute('data-exw');
    if (T.lookupExWordCandidates(word).length) { anchor = el; token = word; break; }
  }
  if (!anchor) { anchor = b.query('#card .answer .ex .ex-word'); token = x.w; }
  assert.ok(anchor, '例句中应有可点词节点');
  const cancelOpen = b.speech.cancelCount;
  T.showExPop(token, anchor);
  assert.equal(b.query('#exPop').hidden, false, '例句查词浮层已打开');
  assert.equal(audioState(b).status, 'stopped', '打开查词浮层后卡片例句朗读停止');
  assert.equal(b.speech.cancelCount, cancelOpen + 1);
  assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  u.onend();
  u.onstart();
  assert.equal(audioState(b).status, 'stopped', '打开浮层后迟到回调不得恢复朗读');
  assert.ok(String(b.attr('#exPop', 'aria-label')).includes('例句查词'), '浮层 aria 说明当前查词场景');
  assert.ok(b.query('#exPopSpeak'), '浮层内应有发音按钮');
  // 浮层内单独播放：关闭浮层时同样停止
  const spokenBefore = b.speech.spoken.length;
  b.query('#exPopSpeak').click();
  assert.equal(b.speech.spoken.length, spokenBefore + 1, '浮层发音按钮应交给 speechSynthesis');
  const u2 = speakLast(b);
  u2.onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(audioState(b).text, String(u2.text));
  const cancelHide = b.speech.cancelCount;
  T.hideExPop();
  assert.equal(b.query('#exPop').hidden, true, '例句查词浮层已关闭');
  assert.equal(audioState(b).status, 'stopped', '关闭查词浮层后浮层内朗读停止');
  assert.equal(b.speech.cancelCount, cancelHide + 1);
  assert.equal(T.speechStatusLabel(), '已停止');
  u2.onend();
  assert.equal(audioState(b).status, 'stopped', '关闭浮层后迟到 onend 不得改写');
});

test('拼写专项点「听发音」后换词：旧朗读停止并先 cancel', () => {
  const b = spellingBrowser();
  const T = b.T;
  const st0 = openSpellingDrill(b);
  const first = st0.current.w;
  assert.ok(first);
  const cancelBefore = b.speech.cancelCount;
  b.query('#spellListen').click();
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '拼写朗读前先取消上一段');
  const u = speakLast(b);
  assert.equal(u.text, first);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  assert.equal(T.getSpeechScene().spelling, first, '朗读场景属于当前拼写词');
  // 提交错误答案进入 feedback，再点「下一词」
  b.query('#spellInput').value = 'zzzzzz';
  b.query('#spellSubmit').click();
  assert.equal(T.getSpellingState().phase, 'feedback');
  const cancelNext = b.speech.cancelCount;
  b.query('#spellNext').click();
  const st = T.getSpellingState();
  assert.equal(st.phase, 'input');
  assert.equal(st.index, 1, '已换到下一词');
  assert.notEqual(st.current.w, first);
  assert.equal(audioState(b).status, 'stopped', '拼写换词后旧单词朗读停止');
  assert.equal(b.speech.cancelCount, cancelNext + 1, '换词停止只 cancel 一次');
  assert.equal(T.speechStatusLabel(), '已停止');
  u.onend();
  u.onstart();
  assert.equal(audioState(b).status, 'stopped', '换词后迟到回调不得恢复朗读');
  assert.ok(b.text('#wordAudioStatus') === null || !['准备中', '朗读中'].includes(b.text('#wordAudioStatus')),
    '换词后不应残留显示朗读中');
});

test('拼写专项完成后停止最后一张朗读，结果页不残留「朗读中」', () => {
  const b = spellingBrowser();
  const T = b.T;
  openSpellingDrill(b);
  const last = advanceSpellingToLast(b);
  assert.equal(last.index, last.total - 1, '已到最后一张');
  assert.equal(last.phase, 'input');
  b.query('#spellListen').click();
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  b.query('#spellInput').value = 'zzzzzz';
  b.query('#spellSubmit').click();
  assert.equal(T.getSpellingState().phase, 'feedback');
  const cancelFinish = b.speech.cancelCount;
  T.nextSpellingWord();   // 最后一张 → finishSpellingSession
  assert.equal(T.getSpellingState().phase, 'done', '应收尾进入结果页');
  assert.equal(b.query('#spellResult').hidden, false, '结果页可见');
  assert.equal(audioState(b).status, 'stopped', '完成一组后必须停止最后一张朗读');
  assert.equal(b.speech.cancelCount, cancelFinish + 1);
  assert.equal(T.speechStatusLabel(), '已停止');
  assert.ok(!String(b.text('#spellingSheet')).includes('朗读中'), '结果页不得残留「朗读中」文案');
  assert.equal(b.query('#spellingSheet .audio-status'), null, '拼写结果页没有音频状态位');
  assert.equal(b.query('#wordAudioStatus'), null, '主组完成页没有单词状态位');
  u.onend();
  u.onstart();
  assert.equal(audioState(b).status, 'stopped', '完成后迟到回调不得恢复朗读');
  assert.equal(T.speechStatusLabel(), '已停止');
});

test('拼写专项「再来一组」先停止上一组残留朗读', () => {
  const b = spellingBrowser();
  const T = b.T;
  openSpellingDrill(b);
  advanceSpellingToLast(b);
  T.skipSpellingWord();
  T.nextSpellingWord();
  assert.equal(T.getSpellingState().phase, 'done', '先完成上一组');
  assert.ok(!['loading', 'playing'].includes(audioState(b).status), '完成前没有播放时不残留播放态');
  // 结果页上再残留一段播放（统一朗读入口），点「再来一组」必须先停
  assert.equal(T.speak('restart-check'), true);
  const u = speakLast(b);
  assert.equal(audioState(b).status, 'loading');
  const cancelRestart = b.speech.cancelCount;
  b.query('#spellAgain').click();
  const st = T.getSpellingState();
  assert.equal(st.active, true);
  assert.equal(st.phase, 'input', '已开始新一组');
  assert.ok(st.total > 0);
  assert.equal(b.query('#spellResult').hidden, true, '结果页收起');
  assert.equal(audioState(b).status, 'stopped', '再来一组先停止旧朗读');
  assert.equal(b.speech.cancelCount, cancelRestart + 1, '重开只 cancel 一次');
  assert.equal(T.speechStatusLabel(), '已停止');
  u.onend();
  assert.equal(audioState(b).status, 'stopped', '上一组迟到回调不得恢复朗读');
});

// ===========================================================================
// F. 能力边界
// ===========================================================================
test('已确认没有英语语音：明确拒绝、不假装发声、给出可执行提示', () => {
  const b = browser({ voices: [] });
  b.speech.setVoices([{ name: 'Tingting', lang: 'zh-CN', voiceURI: 'Tingting' }]);
  b.speech.fireChanged();
  const T = b.T;
  const prefs = T.getSpeechPrefs();
  assert.equal(prefs.voices.length, 0, '中文语音不得计入英语语音');
  assert.equal(prefs.voicesReady, true, '已确认设备没有英语语音');
  T.startSession();
  const x = cardWord(b);
  const spokenBefore = b.speech.spoken.length;
  assert.equal(T.speak(x.w), false, '没有英语语音时不得假装发声');
  assert.equal(b.speech.spoken.length, spokenBefore, '不得调用 speechSynthesis.speak');
  assert.equal(audioState(b).status, 'error');
  assert.equal(T.speechStatusLabel(), '朗读失败');
  assert.ok(String(b.text('#toast')).includes('没有可用的英语语音'), 'toast 明确说明不可用：' + b.text('#toast'));
  assert.ok(String(b.text('#toast')).includes('安装英语语音'), 'toast 给出可执行建议');
  assert.equal(T.getSpeechPrefs().voices.length, 0);
});

test('浏览器不支持 speechSynthesis：拒绝并提示，不影响判定与学习', () => {
  const b = browser({ noSpeech: true });
  const T = b.T;
  T.startSession();
  assert.equal(T.speak('hello'), false, '无 speechSynthesis 时拒绝发声');
  assert.equal(audioState(b).status, 'error');
  assert.equal(T.speechStatusLabel(), '朗读失败');
  assert.ok(String(b.text('#toast')).includes('不支持语音朗读'), 'toast 说明不支持：' + b.text('#toast'));
  assert.ok(String(b.text('#voiceHint')).includes('不支持'), '设置页说明能力边界：' + b.text('#voiceHint'));
  T.judge(true);
  assert.equal(T.verdict, true, '发音不可用不影响判定');
  assert.equal(T.phase, 'revealed');
  assert.ok(b.query('#card .answer [data-audio-play]'), '例句控制组照常渲染');
  b.query('#card .answer [data-audio-play="normal"]').click();
  assert.equal(audioState(b).status, 'error', '点击例句朗读仍明确失败而不是无声假成功');
  assert.ok(String(b.text('#toast')).includes('不支持语音朗读'));
});

test('页面隐藏属性（不派发事件）时 speak 返回 false；隐藏期间迟到回调不改状态（旧断言：真实事件清理见 E2 用例）', () => {
  const b = fresh();
  const T = b.T;
  const x = cardWord(b);
  b.doc.visibilityState = 'hidden';
  const spokenBefore = b.speech.spoken.length;
  const cancelBefore = b.speech.cancelCount;
  assert.equal(T.speak(x.w), false, '页面隐藏时 speak 返回 false');
  assert.equal(b.speech.spoken.length, spokenBefore, '隐藏时不调用 speak');
  assert.equal(b.speech.cancelCount, cancelBefore, '隐藏守卫在 cancel 之前生效');
  assert.equal(audioState(b).status, 'idle', '隐藏时不产生播放状态');
  b.doc.visibilityState = 'visible';
  assert.equal(T.speak(x.w), true);
  const u = speakLast(b);
  u.onstart();
  assert.equal(audioState(b).status, 'playing');
  // 只改属性不会派发 visibilitychange，因此不会触发场景清理；真实产品路径见 E2「真实派发」用例。
  const cancelPropertyOnly = b.speech.cancelCount;
  b.doc.visibilityState = 'hidden';
  assert.equal(audioState(b).status, 'playing', '只改 visibilityState 属性不会触发停止（真实事件见 E2）');
  assert.equal(b.speech.cancelCount, cancelPropertyOnly, '只改属性不调用 cancel');
  u.onend();
  assert.equal(audioState(b).status, 'playing', '隐藏期间旧回调被判为不同场景而忽略');
  b.doc.visibilityState = 'visible';
  assert.equal(T.stopSpeech(), true, '回到前台后仍可明确停止');
  assert.equal(audioState(b).status, 'stopped');
});

// ===========================================================================
// G. 自动发音
// ===========================================================================
test('自动发音：新卡自动读单词、走同一语音偏好；判定不打断；下一张继续', () => {
  const b = browser();
  const T = b.T;
  T.setVoiceURI('Daniel');
  T.setSpeechRate(1.35);
  T.getS().settings.autoSpk = true;
  const before = b.speech.spoken.length;
  T.startSession();
  assert.equal(b.speech.spoken.length, before + 1, '开启自动发音后新卡自动朗读');
  const x1 = cardWord(b);
  const auto = speakLast(b);
  assert.equal(auto.text, x1.w);
  assert.equal(auto.voice.voiceURI, 'Daniel', '自动发音使用选中语音');
  assert.ok(near(auto.rate, 1.35), '自动发音使用语速偏好');
  assert.equal(audioState(b).kind, 'word');
  assert.equal(audioState(b).status, 'loading');
  auto.onstart();
  assert.equal(audioState(b).status, 'playing');
  const cancelBefore = b.speech.cancelCount;
  const spokenBefore = b.speech.spoken.length;
  T.judge(true);
  assert.equal(audioState(b).status, 'playing', '判定不打断自动读单词');
  assert.equal(b.speech.cancelCount, cancelBefore, '判定不 cancel 自动朗读');
  assert.equal(b.speech.spoken.length, spokenBefore, '判定不重复自动朗读');
  assert.equal(b.attr('#spk', 'aria-pressed'), 'true');
  assert.equal(wordStatus(b), '朗读中');
  auto.onend();
  const nextSpoken = b.speech.spoken.length;
  T.tryNext();
  assert.equal(b.speech.spoken.length, nextSpoken + 1, '下一张卡继续自动朗读');
  const x2 = cardWord(b);
  const auto2 = speakLast(b);
  assert.equal(auto2.text, x2.w);
  assert.notEqual(x2.w, x1.w);
  assert.equal(auto2.voice.voiceURI, 'Daniel');
  assert.ok(near(auto2.rate, 1.35));
  assert.equal(audioState(b).status, 'loading');
});

// ===========================================================================
// H. 只读性
// ===========================================================================
test('播放/慢速/停止/例句朗读不改学习记录、配额、熟练、收藏或设置', () => {
  const b = fresh();
  const T = b.T;
  T.judge(true);
  b.query('#star').click();               // 让收藏也进入代表性快照
  T.setSpeechRate(1.1);
  const beforeState = importantState(b);
  const beforeContext = contextState(b);
  const x = cardWord(b);
  b.query('#spk').click();
  speakLast(b).onstart();
  speakLast(b).onend();
  b.query('#spkSlow').click();
  speakLast(b).onstart();
  b.query('#spkStop').click();
  b.query('#card .answer [data-audio-play="normal"]').click();
  speakLast(b).onstart();
  speakLast(b).onend();
  b.query('#card .answer [data-audio-play="slow"]').click();
  b.query('#card .answer [data-audio-stop]').click();
  T.speak(x.w);
  T.stopSpeech();
  T.speak(x.ex, { kind: 'sentence' });
  T.stopSpeech();
  assert.equal(importantState(b), beforeState, '朗读操作不得改变 progress/days/台账/收藏/熟练/设置');
  assert.equal(contextState(b), beforeContext, '朗读操作不得改变当前卡、判定、队列或作答计数');
  assert.equal(T.getS().settings.speechRate, 1.1, '语速偏好保持不变');
  assert.equal(T.getS().timeSec, 0, '朗读不增加学习时长');
  assert.ok(Object.keys(T.getS().stars).length > 0, '代表性快照包含收藏');
});

// I. 独立复核：失败替换、状态归属与语境原句遗漏。
test('新的朗读失败也取消上一段，不把仍在响的语音留在禁用停止按钮之后', () => {
  const b = fresh(), T = b.T;
  T.speak(cardWord(b).w); const old = speakLast(b); old.onstart();
  const before = importantState(b), cancelBefore = b.speech.cancelCount, spokenBefore = b.speech.spoken.length;
  b.speech.setVoices(VOICES.filter(v => v.lang === 'zh-CN')); b.speech.fireChanged();
  assert.equal(T.speak('A new request.'), false);
  assert.equal(b.speech.cancelCount, cancelBefore + 1, '失败的新请求也应取消旧段');
  assert.equal(b.speech.spoken.length, spokenBefore, '没有英语语音不应提交新段');
  assert.equal(audioState(b).status, 'error');
  old.onend(); old.onstart(); old.onerror({error: 'interrupted'});
  assert.equal(audioState(b).status, 'error', '旧段迟到回调不覆盖新失败');
  assert.equal(importantState(b), before);
});

test('已结束/失败状态不从设置试听串回同词的学习卡', () => {
  for (const result of ['ended', 'error']) {
    const b = fresh(), T = b.T, word = cardWord(b).w;
    T.show('set'); T.speak(word); const u = speakLast(b); u.onstart();
    if (result === 'ended') u.onend(); else u.onerror({error: 'synthesis-failed'});
    assert.equal(audioState(b).status, result);
    T.show('study');
    assert.equal(wordStatus(b), '', '不同视图的非播放状态不归属学习卡');
    assert.equal(b.attr('#spk', 'aria-pressed'), 'false');
  }
});

function addSenseFixture(b) {
  const x = cardWord(b), quote = x.ex;
  b.window.WORD_SENSES = {schemaVersion: 1, books: {kaoyan: {[x.w]: {
    preferred: [{meaning: '测试语境义', examples: [0, 1].map(() => ({quote, source: '自编', surface: x.w}))}], additional: ''
  }}}};
  // 首词可能例句使用词形而非原形；保证严格义项契约可读而不改真实词条。
  if (!quote.toLowerCase().includes(x.w.toLowerCase())) {
    b.window.WORD_SENSES.books.kaoyan[x.w].preferred[0].examples.forEach(e => e.surface = quote.split(/\s+/).find(Boolean));
  }
  return {x, quote};
}
test('已核语境义原句同样支持朗读，重复原句只激活实际操作的控制组，compact浮层不加控件', () => {
  const b = fresh(), T = b.T, {quote} = addSenseFixture(b);
  assert.equal(b.all('#card [data-audio-play]').length, 0, '回忆态不泄题');
  T.judge(true);
  const senseGroups = b.all('#card .sense-example [data-audio-text]');
  assert.equal(senseGroups.length, 2, '每条义项原句都有控制组');
  const before = importantState(b);
  const first = senseGroups[0], second = senseGroups[1];
  assert.equal(first.dataset.audioText, quote);
  assert.notEqual(first.dataset.audioKey, second.dataset.audioKey, '相同原句的不同来源实例有稳定区分');
  first.querySelector('[data-audio-play="normal"]').click(); speakLast(b).onstart();
  assert.equal(speakLast(b).text, quote);
  assert.equal(first.querySelector('[data-audio-play="normal"]').getAttribute('aria-pressed'), 'true');
  assert.equal(second.querySelector('[data-audio-play="normal"]').getAttribute('aria-pressed'), 'false');
  first.querySelector('[data-audio-stop]').click();
  assert.equal(first.querySelector('.audio-status').textContent, '已停止');
  T.openWord(T.cur);
  assert.equal(b.all('#wordDetail .sense-example [data-audio-text]').length, 2, '详情也绑定义项原句');
  b.query('#wordDetail .sense-example [data-audio-play="slow"]').click();
  assert.equal(speakLast(b).text, quote); assert.equal(audioState(b).slow, true);
  T.closeSheet(); T.showExPop(cardWord(b).w, null);
  assert.equal(b.all('#exPop [data-audio-play]').length, 0, '简洁查词层不展开义项播放控件');
  assert.equal(importantState(b), before);
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
