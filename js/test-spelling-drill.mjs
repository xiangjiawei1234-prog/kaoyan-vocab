/**
 * 16 拼写专项训练试点回归 + 备份/隔离契约。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱、真实四书数据、DOM 桩只模拟浏览器）。
 * 覆盖：判定规则（大小写/空白/连字符撇号/显式英美变体/不模糊判对）、词源与四书隔离、
 * 会话流程与键盘焦点、结果页「专项表现」、state.spelling 归一化/备份 v3 往返/旧备份兼容、
 * 保存失败与跨标签合并、以及不污染主 progress/days/reviewDay/extraDay/timeSec/熟练/队列。
 * 真实软键盘/读屏/窄屏布局与 C/D 新 UI 的指针命中由 QA 真实浏览器验证；本文件不伪造通过。
 * 运行：node --max-old-space-size=512 js/test-spelling-drill.mjs
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
const combined = fs.readFileSync(path.join(ROOT, "js/combined-words-data.js"), "utf8");
const senses = fs.readFileSync(path.join(ROOT, "js/senses-data.js"), "utf8");
const KEY = "kaoyan_vocab_v1";
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const clone = v => JSON.parse(JSON.stringify(v));

/** 完整 DOM 桩：解析真实 index.html；click/keydown 冒泡；focus() 派发 focusin（同浏览器）。 */
function browser({ storage = new Map(), failWrites = false } = {}) {
  let doc;
  const state = { failWrites: failWrites };
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = '';
      this._hidden = false; this._disabled = false; this._checked = false; this.inert = false;
      Object.defineProperty(this, 'hidden', {
        get() { return this._hidden; },
        set(v) { this._hidden = !!v; if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
      });
      Object.defineProperty(this, 'disabled', {
        get() { return this._disabled; },
        set(v) { this._disabled = !!v; if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
      });
      Object.defineProperty(this, 'checked', {
        get() { return this._checked; },
        set(v) { this._checked = !!v; if (v) this.attrs.checked = ''; else delete this.attrs.checked; }
      });
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
    focus() {
      if (!doc.contains(this) || this.disabled) return;
      doc.activeElement = this;
      for (let n = this; n; n = n.parentNode) {
        if (n['onfocusin']) n['onfocusin']({type: 'focusin', target: this});
        for (const fn of n.events.get('focusin') || []) fn({type: 'focusin', target: this});
      }
    }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    scrollIntoView() {}
    getBoundingClientRect() { return {left:0, top:0, width:100, height:52}; }
    getClientRects() { return [{left:0, top:0, width:100, height:52}]; }
    setPointerCapture() {} releasePointerCapture() {}
    dispatch(type, data = {}) {
      const event = {target:this, key:'', ctrlKey:false, altKey:false, metaKey:false, shiftKey:false,
        repeat:false, isComposing:false, detail:0, defaultPrevented:false, stopped:false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...data};
      for (let n = this; n; n = n.parentNode) {
        if (n['on'+type]) n['on'+type](event);
        for (const fn of n.events.get(type) || []) fn(event);
        if (event.stopped) break;
      }
      return event;
    }
    click() { if (this.disabled) return; this.dispatch('click', {detail: 1}); }
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
  const intervals = [], storageMap = storage, winEvents = new Map();
  const utterances = [];
  const speech = {
    getVoices: () => [{name: "Samantha", lang: "en-US", voiceURI: "Samantha"}],
    cancel() {},
    speak(u) { utterances.push(u); },
    addEventListener() {}
  };
  const localStorage = {
    getItem: k => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => { if (state.failWrites) throw new Error("QuotaExceededError"); storageMap.set(k, String(v)); },
    removeItem: k => storageMap.delete(k)
  };
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    matchMedia: () => ({matches:false, addEventListener(){}}), getSelection: () => ({toString: () => ''}),
    getComputedStyle: () => ({fontSize: '32px'}), innerWidth: 1200, innerHeight: 800,
    speechSynthesis: speech};
  const context = vm.createContext({
    window, document: doc, console, Date,
    localStorage,
    setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    FileReader: class {}, performance: { now: () => Date.now() },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } }, speechSynthesis: speech
  });
  for (const source of [words, cet, combined, senses]) vm.runInContext(source, context, { filename: 'data.js' });
  vm.runInContext(app, context, { filename: 'app.js' });
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, doc, window, storage: storageMap, intervals, utterances,
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    key(target, key, opts = {}) { return (typeof target === "string" ? doc.querySelector(target) : target)?.dispatch('keydown', {key, ...opts}); },
    text(sel) { const el = doc.querySelector(sel); return el ? el.textContent : null; },
    setFailWrites(v) { state.failWrites = !!v; },
    fireWindow(type, ev = {}) { for (const fn of winEvents.get(type) || []) fn({type, ...ev}); },
    fireDoc(type, ev = {}) { for (const fn of doc.events.get(type) || []) fn({type, target: doc.body, ...ev}); }
  };
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

/* ---------------- 会话夹具 ---------------- */
/** 用小分组快速把主组跑完到完成页（cur==null），不改变范围设置。 */
function finishMainGroup(b, opts = {}) {
  const S = b.T.getS();
  Object.assign(S.settings, {dailyNew: 2, groupSize: 2, order: "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  b.T.startSession();
  let guard = 0;
  while (b.T.cur != null && guard++ < 50) {
    if (b.T.phase === "recall") b.T.judge(true);
    b.T.tryNext();
  }
  assert.equal(b.T.cur, null, "夹具应到达完成页");
  return b.T.getS();
}
/** 把当前范围内前 n 个词标成「已学」（p[4]>0），可附加指定下标集合。 */
function markLearned(b, n, extra = []) {
  const W = b.T.getW(), S = b.T.getS();
  const picked = [];
  for (const i of extra) {
    if (!b.T.inScope(i) || b.T.isProficient(i)) continue;
    S.progress[i] = [1, Date.now() + 86400000, 1, 0, Date.now()];
    picked.push(i);
  }
  for (let i = 0; i < W.length && picked.length < n; i++) {
    if (picked.includes(i) || !b.T.inScope(i) || b.T.isProficient(i)) continue;
    S.progress[i] = [1, Date.now() + 86400000, 1, 0, Date.now()];
    picked.push(i);
  }
  return picked;
}
/** 当前范围内的某类词：出现在显式英美变体表中（任一端）。 */
function findVariantWordIndex(b) {
  const W = b.T.getW(), map = new Set();
  for (const pair of b.T.getSpellingVariants()) { map.add(pair[0]); map.add(pair[1]); }
  for (let i = 0; i < W.length; i++) if (b.T.inScope(i) && map.has(W[i].w)) return i;
  return -1;
}
/** 打开拼写 sheet（需完成页 cur==null）。 */
function openSpelling(b) {
  const btn = b.query('#startSpellingBtn');
  assert.ok(btn, '完成页应有拼写专项入口');
  btn.click();
  assert.equal(b.query('#spellingSheet').hidden, false, '拼写 sheet 应打开');
  return b.T.getSpellingState();
}
/** 依次作答当前组：handler(w) 返回 {answer, skip}；返回每步反馈文本。 */
function playRound(b, handler) {
  const feedbacks = [];
  let guard = 0;
  while (b.T.getSpellingState().active && b.T.getSpellingState().phase !== "done" && guard++ < 40) {
    const st = b.T.getSpellingState();
    if (st.phase !== "input") break;
    const action = handler(st.current.w, st);
    if (action && action.skip) {
      b.query('#spellSkip').click();
    } else {
      b.query('#spellInput').value = action && action.answer != null ? action.answer : st.current.w;
      b.key('#spellInput', 'Enter');
    }
    feedbacks.push(b.text('#spellFeedback'));
    const after = b.T.getSpellingState();
    if (after.phase === "feedback") b.query('#spellNext').click();
  }
  return feedbacks;
}
/** 主组现场与主学习字段快照（用于隔离断言）。 */
function isolationSnapshot(b) {
  const S = b.T.getS();
  return JSON.stringify({
    progress: S.progress, days: S.days, stars: S.stars, proficient: S.proficient,
    reviewDay: S.reviewDay, extraDay: S.extraDay, timeSec: S.timeSec, settings: S.settings,
    survey: b.T.getSurvey(),
    Q: b.T.Q, qi: b.T.qi, cur: b.T.cur, verdict: b.T.verdict, answered: b.T.answered,
    groupTotal: b.T.getGroupTotal()
  });
}
/** 只保留指定词作为专项候选；只操作沙箱中的状态，不改交付词库。 */
function restrictSpellingCandidates(b, wordNames) {
  const allowed = new Set(wordNames), S = b.T.getS(), W = b.T.getW();
  S.progress = {}; S.proficient = {};
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  W.forEach((x, i) => {
    if (allowed.has(x.w)) S.progress[i] = [1, Date.now() + 86400000, 1, 0, Date.now()];
    else S.proficient[x.w] = 1;
  });
}
/** 用户可见文本与可访问名称/描述；显式引用的描述即使隐藏也算，排除调试对象。 */
function spellingAccessibleText(b) {
  const out = [];
  function walk(el) {
    if (el.hidden) return;
    out.push(el._text || '');
    for (const name of ['title', 'aria-label', 'aria-description']) out.push(el.getAttribute(name) || '');
    for (const name of ['aria-labelledby', 'aria-describedby']) {
      for (const id of (el.getAttribute(name) || '').split(/\s+/).filter(Boolean)) out.push(b.query('#' + id)?.textContent || '');
    }
    el.children.forEach(walk);
  }
  walk(b.query('#spellingSheet'));
  return out.join(' ');
}
const chineseCharacters = value => String(value).match(/[\u3400-\u9fff]/g)?.join('') || '';

// ===========================================================================
// A. 判定规则（纯函数）
// ===========================================================================
test('精确匹配：小写/大小写/首尾与多余空白；大小写差异有明确说明', () => {
  const b = browser();
  const same = b.T.spellCompare('apple', 'apple');
  assert.equal(same.correct, true); assert.equal(same.status, 'exact'); assert.equal(same.note, '');
  const upper = b.T.spellCompare('Apple', 'apple');
  assert.equal(upper.correct, true);
  assert.equal(upper.status, 'case');
  assert.match(upper.note, /大小写/);
  const spaces = b.T.spellCompare('  apple  ', 'apple');
  assert.equal(spaces.correct, true);
  const inner = b.T.spellCompare('ice  cream', 'ice cream');
  assert.equal(inner.correct, true, '多余空白被折叠');
});

test('显式英美变体表：双向、整词接受并说明（colour/color、centre/center、organise/organize…）', () => {
  const b = browser();
  for (const [a, c] of [['colour', 'color'], ['center', 'centre'], ['organize', 'organise'],
    ['defense', 'defence'], ['traveled', 'travelled'], ['gray', 'grey'], ['program', 'programme']]) {
    const r1 = b.T.spellCompare(a, c);
    assert.equal(r1.correct, true, c + ' 应接受 ' + a + '：' + r1.note);
    assert.equal(r1.status, 'variant');
    assert.match(r1.note, /已接受(美式|英式)拼写/);
    const r2 = b.T.spellCompare(c, a);
    assert.equal(r2.correct, true, a + ' 应接受 ' + c);
    assert.equal(r2.status, 'variant');
  }
  const pairs = b.T.getSpellingVariants();
  assert.ok(pairs.length >= 35, '显式变体表至少 35 对，实际 ' + pairs.length);
});

test('分隔符宽松匹配：连字符/空格与撇号差异带说明接受', () => {
  const b = browser();
  const hyphen = b.T.spellCompare('well being', 'well-being');
  assert.equal(hyphen.correct, true);
  assert.equal(hyphen.status, 'relaxed');
  assert.match(hyphen.note, /空格\/连字符\/撇号|连字符/);
  const apos = b.T.spellCompare('oclock', "o'clock");
  assert.equal(apos.correct, true);
  assert.equal(apos.status, 'relaxed');
  assert.match(apos.note, /撇号/);
  const curly = b.T.spellCompare('o’clock', "o'clock");
  assert.equal(curly.correct, true, '弯撇号归一后精确匹配');
});

test('不做模糊判对：换位/多字母/少字母/未收录异体都判错并给首个差异', () => {
  const b = browser();
  for (const [input, want] of [['recieve', 'receive'], ['beleive', 'believe'], ['appple', 'apple'],
    ['aple', 'apple'], ['paeple', 'apple'], ['gaol', 'jail'], ['color', 'colour']]) {
    // 最后一条是变体表正常的另一端，抽出来单独测；这里只保留确实不应接受的拼写
    if (input === 'color' && want === 'colour') continue;
    const r = b.T.spellCompare(input, want);
    assert.equal(r.correct, false, input + ' 不得被判对为 ' + want);
    assert.equal(r.status, 'wrong');
    assert.ok(r.firstDiff >= 1, '给出首个差异位置');
  }
  assert.equal(b.T.spellCompare('gaol', 'jail').correct, false, '未收录英美异体不模糊接受');
  assert.equal(b.T.spellCompare('colourr', 'colour').correct, false);
});

test('空输入/纯空白不判定、不计数，提示先输入', () => {
  const b = browser();
  for (const raw of ['', '   ', '\n\t']) {
    const r = b.T.spellCompare(raw, 'apple');
    assert.equal(r.correct, false);
    assert.equal(r.status, 'empty');
    assert.match(r.note, /请输入拼写/);
  }
});

test('首个差异位置：前缀给较短长度+1，首字符不同给 1', () => {
  const b = browser();
  assert.equal(b.T.spellCompare('app', 'apple').firstDiff, 4);
  assert.equal(b.T.spellCompare('xpple', 'apple').firstDiff, 1);
  assert.equal(b.T.spellCompare('appxe', 'apple').firstDiff, 4);
});

test('变体只在词库词是表中一端时接受（不做后缀/泛化规则）', () => {
  const b = browser();
  assert.equal(b.T.spellCompare('organise', 'organize').correct, true);
  assert.equal(b.T.spellCompare('organisation', 'organization').correct, true);
  assert.equal(b.T.spellCompare('organisational', 'organizational').correct, false, '未列出的派生词不按后缀规则放行');
  assert.equal(b.T.spellCompare('center', 'centre').correct, true);
  assert.equal(b.T.spellCompare('central', 'centre').correct, false);
});

// ===========================================================================
// B. 词源、范围、熟练、四书
// ===========================================================================
test('候选口径：当前书 + 当前范围 + 非熟练；优先已学、不足补未学并标记 mixed', () => {
  const b = browser();
  const S = b.T.getS();
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  const c0 = b.T.getSpellingCandidates();
  assert.equal(c0.learned, 0, '新用户没有已学词');
  assert.ok(c0.fresh > 0);
  assert.equal(c0.size, Math.min(10, c0.total));
  markLearned(b, 3);
  const c1 = b.T.getSpellingCandidates();
  assert.equal(c1.learned, 3, '已学词被计入 learned');
  assert.equal(c1.mixed, undefined);
});

test('已学词足够时一组只取已学词；不足时补未学并在组头说明', () => {
  const b = browser();
  finishMainGroup(b);
  const S = b.T.getS();
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  markLearned(b, 10);
  b.T.startSpellingDrill();
  let st = b.T.getSpellingState();
  assert.equal(st.total, 10);
  assert.equal(st.mixed, false, '已学词足够时不混入未学词');
  assert.match(b.text('#spellGroupNote'), /已学词/);
  b.T.exitSpellingDrill();
  // 不足 10 时补未学
  const b2 = browser();
  finishMainGroup(b2);
  b2.T.getS().settings.pmin = 0;
  markLearned(b2, 2);
  b2.T.startSpellingDrill();
  const st2 = b2.T.getSpellingState();
  assert.equal(st2.total, 10);
  assert.equal(st2.mixed, true);
  assert.match(b2.text('#spellGroupNote'), /未学词：只练拼写，不记为学习进度/);
});

test('熟练词排除在候选之外', () => {
  const b = browser();
  finishMainGroup(b);
  b.T.getS().settings.pmin = 0;
  const W = b.T.getW();
  let target = -1;
  for (let i = 0; i < W.length; i++) if (b.T.inScope(i) && !b.T.isProficient(i)) { target = i; break; }
  b.T.setProficient(target, true);
  const before = b.T.getSpellingCandidates().total;
  b.T.setProficient(target, false);
  const after = b.T.getSpellingCandidates().total;
  assert.equal(after, before + 1, '熟练词不进入候选，取消后恢复');
});

test('候选<1：拒绝开始并说明原因；当前范围筛选生效', () => {
  const b = browser();
  finishMainGroup(b);
  const S = b.T.getS();
  S.settings.fmin = 9999; S.settings.fmax = 0; S.settings.pmin = 0;
  const c = b.T.getSpellingCandidates();
  assert.equal(c.total, 0);
  assert.equal(b.T.startSpellingDrill(), false);
  assert.match(b.text('#toast'), /没有可用于拼写练习/);
  assert.equal(b.query('#spellingSheet').hidden, true);
});

test('一组最多 10 词、无重复；候选不足按实际 N 词', () => {
  const b = browser();
  finishMainGroup(b);
  const S = b.T.getS();
  S.settings.pmin = 0;
  markLearned(b, 10);
  b.T.startSpellingDrill();
  const st = b.T.getSpellingState();
  assert.ok(st.total <= 10 && st.total >= 1);
  const seen = new Set();
  for (let k = 0; k < st.total; k++) {
    const cur = b.T.getSpellingState().current;
    assert.ok(cur && !seen.has(cur.w), '队列不重复');
    seen.add(cur.w);
    b.T.skipSpellingWord(); b.T.nextSpellingWord();
  }
});

test('四书隔离：每题按当前书取候选与统计', () => {
  const b = browser();
  finishMainGroup(b);
  b.T.startSpellingDrill();
  b.T.skipSpellingWord(); b.T.nextSpellingWord(); b.T.skipSpellingWord();
  b.T.exitSpellingDrill();
  const ky = b.T.getSpellingStats();
  assert.ok(ky.sessions === 0, '未完成组不计入');
  const c0 = b.T.getSpellingStats();
  assert.equal(c0.sessions, 0);
  b.T.switchBook('cet4');
  assert.equal(b.T.getSpellingStats().sessions, 0, '换书后统计为该书自己的（默认空）');
  const cetCand = b.T.getSpellingCandidates();
  assert.ok(cetCand.total > 0);
  b.T.switchBook('kaoyan');
  assert.equal(b.T.getSpellingStats().sessions, 0);
});

test('真实四书 make/point/work：作答前去掉英文搭配，中文完整，作答后正常显示答案', () => {
  const b = browser();
  for (const book of ['kaoyan', 'cet4', 'cet6', 'combined']) {
    if (book !== 'kaoyan') b.T.switchBook(book);
    finishMainGroup(b);
    for (const word of ['make', 'point', 'work']) {
      const x = b.T.getW().find(x => x.w === word);
      assert.ok(x, book + ' 应有真实词头 ' + word);
      const original = x.m;
      restrictSpellingCandidates(b, [word]);
      assert.equal(b.T.startSpellingDrill(), true);
      assert.equal(b.query('#spellInput').value, '');
      const prompt = b.text('#spellMean');
      assert.doesNotMatch(prompt, /[A-Za-z]/, book + '/' + word + ' 中文题面不带英文');
      assert.equal(chineseCharacters(prompt), chineseCharacters(original), book + '/' + word + ' 不丢中文');
      assert.doesNotMatch(spellingAccessibleText(b), new RegExp('\\b' + word + '\\b', 'i'), book + '/' + word + ' 可访问文本不露答案');
      b.query('#spellInput').value = word;
      b.key('#spellInput', 'Enter');
      assert.match(b.text('#spellFeedback'), /拼写正确/);
      assert.ok(b.text('#spellFeedback').includes(word), '反馈允许显示正确答案');
      assert.equal(x.m, original, '专项转换不改正式释义');
      b.T.exitSpellingDrill();
    }
  }
});

test('题面转换：大小写/接受变体/中英混合嵌套括号不泄漏，保留括号中的全部中文', () => {
  const b = browser();
  finishMainGroup(b);
  const x = b.T.getW().find(x => x.w === 'colour');
  x.m = 'n. 颜色（Colour/Color 色彩；使（COLOR）着色），颜料；vt. 涂色（colour in）';
  const original = x.m;
  restrictSpellingCandidates(b, ['colour']);
  b.T.startSpellingDrill();
  const mean = b.text('#spellMean');
  assert.equal(chineseCharacters(mean), chineseCharacters(original), '不得整括号丢掉中文含义');
  assert.doesNotMatch(mean, /[A-Za-z]/);
  assert.doesNotMatch(mean, /[（(]\s*[）)]/, '清理英文后不留空括号');
  assert.doesNotMatch(mean, /[（(]\s*[/;,，；]/, '不留下英文分隔符残片');
  assert.doesNotMatch(spellingAccessibleText(b), /\b(?:colour|color)\b/i);
  b.query('#spellInput').value = 'color';
  b.key('#spellInput', 'Enter');
  assert.match(b.text('#spellFeedback'), /已接受美式拼写/);
  assert.equal(x.m, original);
});

test('纯中文题面完整保留；缺音标题目仍可作答且音标隐藏', () => {
  const b = browser();
  finishMainGroup(b);
  const x = b.T.getW().find(x => x.w === 'apple');
  assert.ok(x);
  x.m = '苹果；果实（可食用）'; x.ph = '';
  restrictSpellingCandidates(b, ['apple']);
  assert.equal(b.T.startSpellingDrill(), true);
  assert.equal(b.text('#spellMean'), x.m);
  assert.equal(b.query('#spellPh').hidden, true);
  b.query('#spellInput').value = 'apple';
  b.key('#spellInput', 'Enter');
  assert.match(b.text('#spellFeedback'), /拼写正确/);
});

test('无有效中文候选：跳过并说明，不生成空题、不计用户跳过或专项统计', () => {
  const b = browser();
  finishMainGroup(b);
  const W = b.T.getW(), S = b.T.getS();
  const apple = W.find(x => x.w === 'apple'), make = W.find(x => x.w === 'make');
  apple.m = 'n. Apple (APPLE/fruit)';
  restrictSpellingCandidates(b, ['apple', 'make']);
  const statsBefore = JSON.stringify(S.spelling), mainBefore = isolationSnapshot(b);
  const candidates = b.T.getSpellingCandidates();
  assert.equal(candidates.total, 1, '有效候选只计有中文的 make');
  assert.equal(candidates.skippedNoHint, 1, '另报无中文提示数');
  assert.equal(b.T.startSpellingDrill(), true);
  assert.equal(b.T.getSpellingState().total, 1);
  assert.equal(b.T.getSpellingState().current.w, 'make');
  assert.match(b.text('#spellGroupNote'), /已跳过 1 个缺少有效中文提示的词/);
  assert.equal(b.T.getSpellingState().skipped, 0, '内容过滤不是用户跳过');
  assert.equal(isolationSnapshot(b), mainBefore, '开始专项过滤不改主学习状态');
  b.T.exitSpellingDrill();
  assert.equal(JSON.stringify(S.spelling), statsBefore, '退出未完成组不计专项统计');
  restrictSpellingCandidates(b, ['apple']);
  b.T.setCur(null);
  assert.equal(b.query('#startSpellingBtn'), null, '没有有效中文候选时不显示专项入口');
  assert.match(b.text('#card'), /1 个词缺少有效中文提示，已跳过拼写专项/, '完成页说明入口不可用的原因');
  assert.equal(b.T.startSpellingDrill(), false);
  assert.equal(b.query('#spellingSheet').hidden, true);
  assert.match(b.text('#toast'), /缺少有效中文提示/);
  assert.equal(apple.m, 'n. Apple (APPLE/fruit)', '不回写数据内容');
  assert.ok(make.m.includes('make headway'), '主释义中的英文搭配保留');
});

// ===========================================================================
// C. 入口与会话流程
// ===========================================================================
test('完成页显示「拼写专项（N 词）」入口；学习卡进行中不显示', () => {
  const b = browser();
  const S = b.T.getS();
  Object.assign(S.settings, {dailyNew: 5, groupSize: 5, order: "freq", pmin: 0});
  S.progress = {}; b.T.startSession();
  assert.ok(b.T.cur != null);
  assert.equal(b.query('#startSpellingBtn'), null, '未完成本组时不显示拼写入口');
  assert.equal(b.T.startSpellingDrill(), false);
  assert.match(b.text('#toast'), /完成当前这张卡/);
  finishMainGroup(b);
  const btn = b.query('#startSpellingBtn');
  assert.ok(btn, '完成页显示拼写入口');
  assert.match(btn.textContent, /拼写专项（\d+ 词）/);
});

test('打开 sheet：显示中文释义+词性（+音标），不显示英文单词，输入框自动聚焦', () => {
  const b = browser();
  finishMainGroup(b);
  const st = openSpelling(b);
  assert.equal(st.phase, 'input');
  assert.equal(st.index, 0);
  assert.equal(st.active, true);
  const cur = st.current;
  assert.ok(cur, '有当前词');
  assert.equal(chineseCharacters(b.text('#spellMean')), chineseCharacters(cur.m), '题面保留完整中文释义');
  assert.doesNotMatch(b.text('#spellMean'), /[A-Za-z]/, '题面去掉原释义中的英文及词性缩写');
  assert.ok(String(b.text('#spellPos')).length > 0, '显示词性提示');
  const promptText = String(b.text('#spellPrompt'));
  assert.ok(!promptText.toLowerCase().includes(cur.w.toLowerCase()), '提示区不得泄漏英文单词：' + promptText);
  assert.equal(b.doc.activeElement, b.query('#spellInput'), '输入框自动聚焦');
  assert.match(b.text('#spellProgress'), /第 1 \/ \d+ 词/);
  assert.equal(b.query('#spellSheetTitle'), null);
  assert.equal(b.query('#spellTitle').textContent, '拼写专项');
});

test('Enter 提交正确拼写：反馈正确、作答+1、焦点到「下一词」', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const cur = b.T.getSpellingState().current;
  b.query('#spellInput').value = cur.w;
  b.key('#spellInput', 'Enter');
  const st = b.T.getSpellingState();
  assert.equal(st.phase, 'feedback');
  assert.equal(st.attempts, 1);
  assert.equal(st.correct, 1);
  const fb = b.text('#spellFeedback');
  assert.match(fb, /拼写正确/);
  assert.ok(fb.includes(cur.w), '反馈显示正确拼写');
  assert.equal(b.query('#spellFeedback').querySelectorAll('span[lang="en"]').length >= 1, true, '英文拼写标 lang=en');
  assert.equal(b.doc.activeElement, b.query('#spellNext'), '焦点到下一词');
  assert.equal(b.query('#spellInput').disabled, true, '反馈期间输入框禁用');
});

test('错误拼写：显示你的答案、正确拼写与首个差异，不计入正确', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const cur = b.T.getSpellingState().current;
  b.query('#spellInput').value = cur.w + 'zz';
  b.key('#spellInput', 'Enter');
  const st = b.T.getSpellingState();
  assert.equal(st.attempts, 1);
  assert.equal(st.correct, 0);
  const fb = b.text('#spellFeedback');
  assert.match(fb, /拼写不正确/);
  assert.ok(fb.includes('你的答案') && fb.includes(cur.w + 'zz'));
  assert.ok(fb.includes('正确拼写') && fb.includes(cur.w));
  assert.match(fb, /从第 \d+ 个字符起不同/);
});

test('变体拼写：提示「已接受美式/英式拼写」，计入正确', () => {
  const b = browser();
  finishMainGroup(b);
  b.T.getS().settings.pmin = 0;
  const vi = findVariantWordIndex(b);
  assert.ok(vi >= 0, '默认范围应含显式变体表中的词');
  const W = b.T.getW();
  const target = W[vi].w;
  const pairs = b.T.getSpellingVariants();
  const pair = pairs.find(p => p[0] === target || p[1] === target);
  const alt = pair[0] === target ? pair[1] : pair[0];
  // 完成页夹具已有主学习记录；清掉后建立恰好 10 个已学候选，避免随机抽样漏掉目标。
  b.T.getS().progress = {};
  markLearned(b, 10, [vi]);
  b.T.startSpellingDrill();
  const st = b.T.getSpellingState();
  assert.equal(st.total, 10);
  let checked = false;
  while (b.T.getSpellingState().phase !== 'done') {
    const cur = b.T.getSpellingState().current;
    b.query('#spellInput').value = cur.w === target ? alt : cur.w;
    b.key('#spellInput', 'Enter');
    if (cur.w === target) {
      checked = true;
      const fb = b.text('#spellFeedback');
      assert.match(fb, /已接受(美式|英式)拼写/);
      assert.match(fb, /拼写正确/);
    }
    b.query('#spellNext').click();
  }
  assert.equal(checked, true, '本组应包含目标变体词');
  assert.equal(b.T.getSpellingStats().correct, 10);
});

test('跳过：计入跳过、不计入作答/正确，反馈显示正确拼写', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const cur = b.T.getSpellingState().current;
  b.query('#spellSkip').click();
  const st = b.T.getSpellingState();
  assert.equal(st.skipped, 1);
  assert.equal(st.attempts, 0);
  assert.equal(st.correct, 0);
  assert.match(b.text('#spellFeedback'), /已跳过/);
  assert.ok(b.text('#spellFeedback').includes(cur.w));
});

test('空输入提交：不判定不计数，提示先输入', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  b.query('#spellInput').value = '   ';
  b.key('#spellInput', 'Enter');
  const st = b.T.getSpellingState();
  assert.equal(st.phase, 'input');
  assert.equal(st.attempts, 0);
  assert.match(b.text('#toast'), /请输入拼写/);
});

test('听发音：调用真实 speak 入口朗读当前单词（设备能力边界沿用 12 的提示）', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const cur = b.T.getSpellingState().current;
  b.query('#spellListen').click();
  assert.ok(b.utterances.length >= 1, '应调用 speechSynthesis.speak');
  assert.equal(b.utterances.at(-1).text, cur.w);
});

test('输入字母/空格不会触发主学习判定（sheet 内输入不影响主组现场）', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const before = isolationSnapshot(b);
  b.key('#spellInput', 'f');
  b.key('#spellInput', 'j');
  b.key('#spellInput', ' ');
  b.key('#spellInput', '?');
  assert.equal(isolationSnapshot(b), before, '输入过程不改主判定/队列/进度');
  assert.equal(b.query('#helpSheet').hidden, true, '输入 ? 不打开帮助');
});

test('Esc/退出：未完成组不计入专项表现，关闭后回到完成页并归还焦点', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const S = b.T.getS();
  const progressBefore = JSON.stringify({p: S.progress, d: S.days, r: S.reviewDay});
  b.key(b.doc.activeElement, 'Escape');
  assert.equal(b.query('#spellingSheet').hidden, true, 'Esc 关闭 sheet');
  assert.equal(b.T.getSpellingStats().sessions, 0, '未完成组不计入 sessions');
  assert.match(b.text('#toast'), /本组未完成，不计入专项表现/);
  assert.equal(b.T.cur, null, '回到原完成页');
  assert.equal(JSON.stringify({p: S.progress, d: S.days, r: S.reviewDay}), progressBefore, '主学习字段不变');
  assert.ok(b.query('#card').contains(b.doc.activeElement) || b.doc.activeElement === b.query('#card'),
    '焦点归还学习卡片');
});

test('完成一组：结果页显示「本组专项表现」与错词列表，累计写入 state.spelling', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const total = b.T.getSpellingState().total;
  const feedbacks = playRound(b, (w) => ({answer: w}));
  assert.equal(b.T.getSpellingState().phase, 'done');
  assert.equal(feedbacks.length, total);
  const st = b.T.getSpellingState();
  assert.equal(b.query('#spellResult').hidden, false, '显示结果页');
  assert.match(b.text('#spellResultTitle'), /本组专项表现/);
  const line = b.text('#spellResultLine');
  assert.match(line, new RegExp("正确 " + total + " / 作答 " + total));
  const stats = b.T.getSpellingStats();
  assert.equal(stats.sessions, 1);
  assert.equal(stats.attempts, total);
  assert.equal(stats.correct, total);
  const raw = b.storage.get(KEY);
  assert.ok(raw && raw.includes('"spelling"'), '拼写记录写入主记录 state.spelling');
  const saved = JSON.parse(raw);
  assert.equal(saved.spelling.sessions, 1);
  assert.equal(saved.spelling.lastSession.total, total);
});

test('结果页「再来一组」：新组开始、上一组不会重复记账', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  const sessions = b.T.getSpellingStats().sessions;
  b.query('#spellAgain').click();
  const st = b.T.getSpellingState();
  assert.equal(st.active, true);
  assert.equal(st.phase, 'input');
  assert.equal(st.index, 0);
  assert.equal(b.T.getSpellingStats().sessions, sessions, '再来一组不重复累加');
  assert.equal(b.query('#spellResult').hidden, true);
});

test('结果页「完成返回」：关闭 sheet、toast 说明已完成', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.equal(b.query('#spellingSheet').hidden, true);
  assert.match(b.text('#toast'), /已结束拼写专项/);
  assert.equal(b.T.cur, null);
});

test('关闭按钮/背景：未完成退出不计入，完成后的关闭不重复记账', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  b.query('#spellingSheet .sheet-head [data-spell-close]').click();
  assert.equal(b.query('#spellingSheet').hidden, true);
  assert.match(b.text('#toast'), /未完成，不计入/);
  // 完成一组后再关闭：不重复累加
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  const sessions = b.T.getSpellingStats().sessions;
  b.query('#spellDone').click();
  assert.equal(b.T.getSpellingStats().sessions, sessions);
});

// ===========================================================================
// D. 隔离（不污染主进度/配额/队列/时长/熟练）
// ===========================================================================
test('整组训练前后：progress/days/stars/proficient/reviewDay/extraDay/timeSec/settings/SURVEY 不变', () => {
  const b = browser();
  finishMainGroup(b);
  // 制造一些主学习现场数据
  const S = b.T.getS();
  const W = b.T.getW();
  let learned = -1;
  for (let i = 0; i < W.length; i++) if (b.T.inScope(i)) { learned = i; break; }
  S.progress[learned] = [2, Date.now() + 1000, 2, 1, Date.now() - 1000];
  S.days[b.T.getS() ? Object.keys(S.days)[0] || '2026-10-22' : '2026-10-22'] = {n: 2, r: 3, ok: 2, no: 1};
  b.T.judge; // noop
  const before = isolationSnapshot(b);
  const dayBefore = JSON.stringify(S.days);
  openSpelling(b);
  playRound(b, (w, st) => ({answer: st.index === 0 ? w + 'x' : (st.index === 1 ? null : w), skip: st.index === 1}));
  b.query('#spellDone').click();
  assert.equal(isolationSnapshot(b), before, '训练不得改动主进度/日统计/队列/设置');
  assert.equal(JSON.stringify(b.T.getS().days), dayBefore, '不得写 day() 主统计');
  assert.equal(b.T.getSpellingStats().sessions, 1, '只写 spelling');
});

test('不消费新词额度与复习台账、不推进 SRS / 不改 p[1] / 不改熟练收藏', () => {
  const b = browser();
  finishMainGroup(b);
  const S = b.T.getS();
  const W = b.T.getW();
  let idx = -1;
  for (let i = 0; i < W.length; i++) if (b.T.inScope(i)) { idx = i; break; }
  S.progress[idx] = [3, 123456789, 3, 0, Date.now() - 5000];
  S.stars[idx] = 1;
  const before = {
    prog: clone(S.progress), stars: clone(S.stars), rev: clone(S.reviewDay), day: clone(S.days),
    has: b.T.hasMainProgress(S.progress[idx]), due: b.T.countDue(), p: clone(S.progress[idx])
  };
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.deepEqual(S.progress[idx], before.p, '不推进学习档位/不改 p[1]');
  assert.deepEqual(S.stars, before.stars);
  assert.equal(b.T.hasMainProgress(S.progress[idx]), before.has);
  assert.equal(b.T.countDue(), before.due, '到期数不变');
  assert.equal(JSON.stringify(S.reviewDay), JSON.stringify(before.rev), '不消费复习台账');
  assert.equal(JSON.stringify(S.days), JSON.stringify(before.day), '不写主日统计');
});

test('学习时长不增加（完成页 cur==null，训练不计入 timeSec）', () => {
  const b = browser();
  finishMainGroup(b);
  const before = b.T.getS().timeSec;
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.equal(b.T.getS().timeSec, before, '拼写训练不增加累计学习时长');
});

test('打开 sheet 时自动续背不触发；关闭后恢复完成页资格', () => {
  const b = browser();
  finishMainGroup(b);
  b.T.setAutoResume({enabled: true, threshold: 1, idleMs: 120000, countdownMs: 15000});
  const before = b.T.getAutoResumeState();
  assert.equal(before.eligible, true, '完成页且无浮层时应 eligible');
  openSpelling(b);
  const during = b.T.getAutoResumeState();
  assert.equal(during.eligible, false, 'sheet 打开时不触发自动续背');
  assert.notEqual(during.phase, 'countdown');
  b.key(b.doc.activeElement, 'Escape');
  const after = b.T.getAutoResumeState();
  assert.equal(after.eligible, true, '关闭 sheet 后恢复 eligible');
});

test('与自动续背状态区共存：完成页同时有 #autoResume 与 #startSpellingBtn', () => {
  const b = browser();
  finishMainGroup(b);
  b.T.setAutoResume({enabled: true, threshold: 1, idleMs: 120000, countdownMs: 15000});
  // 触发一次完成页渲染以显示自动续背状态区
  b.T.setCur(null);
  assert.equal(b.query('#startSpellingBtn') != null, true, '完成页有拼写入口');
  assert.ok(b.query('#autoResume'), '自动续背状态区节点存在');
});

// ===========================================================================
// E. 存储归一化 / 备份 / 兼容 / 保存失败 / 跨标签
// ===========================================================================
test('新记录与旧记录：spelling 默认空白；单个非法子项只修该子项', () => {
  const b = browser();
  const fresh = b.T.normalizeState({progress: {}, days: {}});
  assert.equal(JSON.stringify(fresh.spelling), JSON.stringify({sessions: 0, attempts: 0, correct: 0, skipped: 0, lastDay: null, lastSession: null}));
  const old = b.T.normalizeState({settings: {dailyNew: 7}, progress: {}, days: {}});
  assert.equal(old.settings.dailyNew, 7);
  assert.equal(old.spelling.sessions, 0, '旧记录缺 spelling → 默认');
  const bad = b.T.normalizeState({
    progress: {}, days: {},
    spelling: {sessions: -3, attempts: -1, correct: 9, skipped: -2, lastDay: "2026-13-40", lastSession: [1, 2]}
  });
  assert.equal(bad.spelling.sessions, 0, '非法计数回落 0');
  assert.equal(bad.spelling.attempts, 0);
  assert.equal(bad.spelling.correct, 0);
  assert.equal(bad.spelling.skipped, 0);
  assert.equal(bad.spelling.lastDay, null);
  assert.equal(bad.spelling.lastSession, null);
});

test('lastSession 归一化：自相矛盾整条丢弃；合法记录原样保留', () => {
  const b = browser();
  const ok = b.T.normalizeState({progress: {}, days: {}, spelling: {
    sessions: 2, attempts: 10, correct: 8, skipped: 1, lastDay: "2026-10-10",
    lastSession: {day: "2026-10-10", total: 10, attempts: 9, correct: 8, skipped: 1, mixed: true, at: "2026-10-10T12:00:00.000Z"}
  }}).spelling;
  assert.equal(ok.sessions, 2);
  assert.equal(ok.lastSession.total, 10);
  assert.equal(ok.lastSession.mixed, true);
  const bad = b.T.normalizeState({progress: {}, days: {}, spelling: {
    sessions: 1, lastDay: "2026-10-10",
    lastSession: {day: "2026-10-10", total: 10, attempts: 9, correct: 8, skipped: 0}
  }}).spelling;
  assert.equal(bad.lastSession, null, 'attempts+skipped!=total 整条丢弃');
  const over = b.T.normalizeState({progress: {}, days: {}, spelling: {
    attempts: 2, correct: 5
  }}).spelling;
  assert.equal(over.correct, 0, 'correct>attempts 时只修该字段');
  assert.equal(over.attempts, 2);
});

test('备份 v3 导出包含每书 spelling；导出只读（内存不变）', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  const S = b.T.getS();
  const snapshot = JSON.stringify(S);
  const data = b.T.buildExport();
  assert.equal(data.version, 3, '备份仍为 v3（不升版本）');
  assert.ok(data.books.kaoyan.spelling, '备份含考研 spelling');
  assert.equal(data.books.kaoyan.spelling.sessions, 1);
  assert.ok(data.books.cet4.spelling, '其他书也有默认 spelling 字段');
  assert.equal(JSON.stringify(S), snapshot, '导出不得修改内存状态');
});

test('备份往返：导入恢复累计与最近一组汇总；旧 v1/v2 缺字段按默认兼容', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  const data = b.T.buildExport();
  const stats = b.T.getSpellingStats();
  b.T.getS().spelling = {sessions: 0, attempts: 0, correct: 0, skipped: 0, lastDay: null, lastSession: null};
  b.T.importState(data);
  const back = b.T.getSpellingStats();
  assert.equal(back.sessions, stats.sessions);
  assert.equal(back.attempts, stats.attempts);
  assert.equal(back.correct, stats.correct);
  assert.equal(back.lastSession.total, stats.lastSession.total);
  const legacy = {app: "kaoyan-vocab", version: 3, books: {kaoyan: {
    dv: 3, settings: {}, progress: {0: [1, Date.now() + 86400000, 1, 0, Date.now() - 1000]}, days: {}
  }}};
  assert.doesNotThrow(() => b.T.importState(legacy), '旧备份缺 spelling 不报错（有主学习记录）');
  assert.equal(b.T.getSpellingStats().sessions, 0, '旧备份缺字段按空白兼容');
});

test('只有专项记录、没有主学习进度的备份仍可导入', () => {
  const b = browser();
  const data = {app: "kaoyan-vocab", version: 3, activeBook: "kaoyan", books: {kaoyan: {
    dv: 3, settings: {}, progress: {}, days: {},
    spelling: {sessions: 1, attempts: 10, correct: 9, skipped: 1, lastDay: "2026-10-10",
      lastSession: {day: "2026-10-10", total: 10, attempts: 9, correct: 9, skipped: 1, mixed: true, at: "2026-10-10T12:00:00.000Z"}}
  }}};
  const plan = b.T.prepareImportPlan(data);
  assert.ok(plan.books.length === 1, '专项记录被视为可恢复内容');
  b.T.importState(data);
  assert.equal(b.T.getSpellingStats().sessions, 1);
});

test('重置当前词书会清空 spelling；四书各自独立', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.equal(b.T.getSpellingStats().sessions, 1);
  b.doc.querySelector('#rst').click();
  assert.equal(b.T.getSpellingStats().sessions, 0, '重置当前词书清空专项记录');
  // 四书独立：考研有记录、四级默认
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.equal(b.T.getSpellingStats().sessions, 1);
  b.T.switchBook('cet4');
  assert.equal(b.T.getSpellingStats().sessions, 0, '四级自己的记录为空');
  b.T.switchBook('kaoyan');
  assert.equal(b.T.getSpellingStats().sessions, 1, '切回考研记录仍在');
});

test('保存失败：内存统计保留并提示，恢复后随下次保存落盘', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  b.setFailWrites(true);
  playRound(b, (w) => ({answer: w}));
  const stats = b.T.getSpellingStats();
  assert.equal(stats.sessions, 1, '保存失败时内存统计仍更新');
  assert.equal(b.query('#appAlert').hidden, false, '出现持久保存失败提示');
  b.setFailWrites(false);
  b.T.setFontSize('large');   // 触发一次正常保存（保存路径与拼写无关）
  const raw = JSON.parse(b.storage.get(KEY));
  assert.equal(raw.spelling.sessions, 1, '下次成功保存写入拼写记录');
});

test('跨标签：其他标签只改拼写时合并较大记录，不重建当前组', () => {
  const b = browser();
  finishMainGroup(b);
  const plan = b.T.getPlan();
  const local = b.T.getSpellingStats();
  const candidate = JSON.parse(b.storage.get(KEY));
  candidate.spelling = {sessions: 5, attempts: 50, correct: 40, skipped: 5, lastDay: "2026-10-10", lastSession: null};
  b.storage.set(KEY, JSON.stringify(candidate));
  b.fireWindow('storage', {key: KEY, newValue: JSON.stringify(candidate)});
  const merged = b.T.getSpellingStats();
  assert.equal(merged.sessions, 5, '引入其他标签更大的拼写记录');
  assert.equal(plan.startedAt, b.T.getPlan().startedAt, '只差拼写时不重建当前组');
  assert.equal(local.sessions, 0);
});

test('跨标签：其他标签推进学习进度时，本页刚完成的拼写记录不丢', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  const sessions = b.T.getSpellingStats().sessions;
  const candidate = JSON.parse(b.storage.get(KEY));
  candidate.progress = Object.assign({}, candidate.progress, {0: [1, Date.now() + 1000, 1, 0, Date.now()]});
  candidate.spelling = {sessions: 0, attempts: 0, correct: 0, skipped: 0, lastDay: null, lastSession: null};
  b.storage.set(KEY, JSON.stringify(candidate));
  b.fireWindow('storage', {key: KEY, newValue: JSON.stringify(candidate)});
  assert.equal(b.T.getSpellingStats().sessions, sessions, '旧快照不得覆盖本页较新的拼写记录');
});


test('变体/宽松规则与大小写组合：接受时都带明确说明', () => {
  const b = browser();
  const v = b.T.spellCompare('Colour', 'color');
  assert.equal(v.correct, true);
  assert.equal(v.status, 'variant');
  assert.match(v.note, /已接受(美式|英式)拼写/);
  const r = b.T.spellCompare('Well-Being', 'well being');
  assert.equal(r.correct, true);
  assert.equal(r.status, 'relaxed');
});

test('全部跳过（0 作答）：结果页如实显示「作答 0 / 跳过 N」，组数仍累加', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const total = b.T.getSpellingState().total;
  playRound(b, () => ({skip: true}));
  assert.equal(b.T.getSpellingState().phase, 'done');
  assert.match(b.text('#spellResultLine'), new RegExp("正确 0 / 作答 0（跳过 " + total + "）"));
  const stats = b.T.getSpellingStats();
  assert.equal(stats.sessions, 1);
  assert.equal(stats.attempts, 0);
  assert.equal(stats.skipped, total);
  assert.equal(b.text('#spellResultWords').includes('没有拼写错误'), true);
});

test('sheet 内 Tab 循环不逃逸到页面其它控件', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  const exitBtn = b.query('#spellExit');
  exitBtn.focus();
  const ev = exitBtn.dispatch('keydown', {key: 'Tab'});
  assert.equal(ev.defaultPrevented, true, 'sheet 内最后一站 Tab 被接管');
  assert.equal(b.query('#spellingSheet').contains(b.doc.activeElement), true, '焦点仍在 sheet 内');
});

test('入口按钮文案如实：拼写专项、不占新词额度/不记为学习进度', () => {
  const b = browser();
  finishMainGroup(b);
  const btn = b.query('#startSpellingBtn');
  assert.ok(btn);
  assert.match(btn.textContent, /拼写专项（\d+ 词）/);
  assert.match(String(btn.getAttribute('title')), /不占新词额度/);
  assert.match(String(btn.getAttribute('title')), /不记为学习进度/);
});

test('四书备份独立：一书的专项记录不影响另一书', () => {
  const b = browser();
  finishMainGroup(b);
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  const kaoyanSessions = b.T.getSpellingStats().sessions;
  assert.equal(kaoyanSessions, 1);
  b.T.switchBook('cet4');
  assert.equal(b.T.getSpellingStats().sessions, 0);
  // 四级也完成一组（换个词书，用同样的完成页夹具）
  const S4 = b.T.getS();
  Object.assign(S4.settings, {dailyNew: 2, groupSize: 2, order: "freq", fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  S4.progress = {}; S4.days = {}; S4.proficient = {};
  b.T.startSession();
  let guard = 0;
  while (b.T.cur != null && guard++ < 50) { if (b.T.phase === "recall") b.T.judge(true); b.T.tryNext(); }
  openSpelling(b);
  playRound(b, (w) => ({answer: w}));
  b.query('#spellDone').click();
  assert.equal(b.T.getSpellingStats().sessions, 1, '四级自己一组');
  b.T.switchBook('kaoyan');
  assert.equal(b.T.getSpellingStats().sessions, 1, '考研仍是一组');
  const data = b.T.buildExport();
  assert.equal(data.books.kaoyan.spelling.sessions, 1);
  assert.equal(data.books.cet4.spelling.sessions, 1);
  assert.equal(data.books.cet6.spelling.sessions, 0);
});

// ===========================================================================
// F. 静态契约
// ===========================================================================
test('静态契约：#spellingSheet 静态骨架、16px 输入、lang/无障碍节点与「专项表现」文案', () => {
  assert.match(html, /id="spellingSheet"/);
  assert.match(html, /id="spellInput"[^>]*type="text"/);
  assert.match(html, /id="spellFeedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="spellProgress"[^>]*role="status"/);
  assert.match(html, /id="spellResultTitle">本组专项表现/);
  assert.match(html, /专项表现只统计本组拼写练习/);
  assert.match(html, /id="spellDone"/);
  const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
  assert.match(css, /#spellInput\s*\{[^}]*font-size:\s*16px/, '窄屏输入 16px 防 iOS 缩放');
  assert.match(css, /\.spell-mean\s*\{[^}]*var\(--fs-read/, '拼写释义跟随大字阅读字号');
  assert.match(app, /spelling: \{sessions: 0, attempts: 0/, 'DEF 含 state.spelling 字段结构');
  assert.doesNotMatch(app, /location\.reload\s*\(/, '不引入整页刷新');
});

console.log(`\n16 拼写专项：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
