/**
 * 11 轻量引导 + 词表范围回归。
 * 执行真实 index.html + 真实 js/app.js（vm 沙箱；DOM 桩只模拟浏览器行为，不复制业务逻辑）。
 * 覆盖：首屏提示条可跳过/不拦截键盘、独立全局键、已有用户设置不重置、可重开说明浮层、
 * 词表「当前范围/全库 · 状态 · N 词」摘要、中文释义搜索、零结果、重置筛选不动学习设置。
 * 运行：node --max-old-space-size=512 js/test-guide.mjs
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
const GUIDE_KEY = "vocab_guide_v1";
const KAOYAN_KEY = "kaoyan_vocab_v1";
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/** 完整 DOM 桩：解析真实 index.html，支持选择器查询、事件冒泡、焦点与 localStorage。 */
function browser({ storage = new Map() } = {}) {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.hidden = false; this.disabled = false; this.placeholder = ''; this._writes = 0;
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
      this.detachChildren(); this._text = ''; this._html = String(value); this._writes++;
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
      if (tag === 'input' && /\bplaceholder\s*=/.test(m[0])) {
        const ph = m[2].match(/placeholder\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (ph) n.placeholder = decode(ph[1] ?? ph[2] ?? ph[3] ?? '');
      }
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
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}), innerWidth: 1200, innerHeight: 800,
    getComputedStyle: () => ({fontSize: '32px'})};
  const context = vm.createContext({
    window, document: doc, console, Date, localStorage,
    setInterval(fn, ms) { intervals.push({fn, ms}); return intervals.length; }, clearInterval(){},
    setTimeout(){return 0;}, clearTimeout(){}, requestAnimationFrame(fn){fn();}, cancelAnimationFrame(){},
    confirm: () => true, Blob: class {}, URL:{createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance:{now: () => Date.now()},
    SpeechSynthesisUtterance: class {}, speechSynthesis: {cancel(){}, speak(){}, getVoices(){ return []; }}
  });
  vm.runInContext(words, context, {filename:'words-data.js'});
  vm.runInContext(cet, context, {filename:'cet-words-data.js'});
  vm.runInContext(app, context, {filename:'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab 测试入口');
  return {
    T, doc, storage, intervals, query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    text(selector) { const el = doc.querySelector(selector); return el ? el.textContent : null; }
  };
}

/** 一份形式合法的已有学习记录（旧用户 + 自定义设置），用于「不重置已有用户」检查。 */
function existingUserState() {
  return {
    dv: 3,
    settings: { dailyNew: 7, theme: "dark", order: "freq", fmin: 1, fmax: 0, pmin: 2 },
    progress: { "0": [1, Date.now() + 86400000, 1, 0, Date.now()] },
    days: {}, stars: {}, proficient: {}, timeSec: 120
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

// ===========================================================================
// A. 首屏提示条
// ===========================================================================
test('全新记录：背诵页出现首屏提示条，文案覆盖 5 个要点，且不是模态浮层', () => {
  const b = browser();
  const banner = b.query('#guideBanner');
  assert.ok(banner, 'index.html 应含 #guideBanner');
  assert.equal(banner.hidden, false, '首次打开应显示首屏提示条');
  const text = b.text('#guideBanner');
  for (const kw of ['词书', '每日新词', '范围', '全书', '回忆', '会', '熟练']) {
    assert.ok(text.includes(kw), '提示条文案应包含「' + kw + '」，实际：' + text);
  }
  // 不是 sheet：没有自动打开的浮层，主内容未被 inert 覆盖（提示条不阻塞当前页面）。
  assert.equal(b.query('#helpSheet').hidden, true, '提示条不是模态浮层');
  assert.ok(b.all('.sheet').every(el => el.hidden === true), '首屏不应自动打开任何浮层');
});

test('提示条不阻塞键盘：显示期间 F / J / 空格照常判定与翻页', () => {
  const b = browser();
  assert.equal(b.query('#guideBanner').hidden, false);
  const S = b.T.getS();
  Object.assign(S.settings, {order: 'freq', dailyNew: 20, fmin: 1, fmax: 0, pmin: 0});
  b.T.startSession();
  assert.equal(b.T.phase, 'recall');
  b.key('f');
  assert.equal(b.T.phase, 'revealed', '提示条显示时按 F 仍应立即判定');
  assert.equal(b.T.verdict, true);
  b.key(' ');
  assert.equal(b.T.phase, 'recall', '提示条显示时按空格仍应翻页');
  b.key('j');
  assert.equal(b.T.verdict, false, '提示条显示时按 J 仍应判定');
});

test('「知道了」记入独立全局键并隐藏提示条；再次打开页面不再自动出现', () => {
  const storage = new Map();
  const b = browser({storage});
  assert.equal(b.query('#guideBanner').hidden, false);
  b.query('#guideBannerDismiss').click();
  assert.equal(b.query('#guideBanner').hidden, true, '点击「知道了」后隐藏');
  const raw = storage.get(GUIDE_KEY);
  assert.ok(raw, '应写入独立的引导偏好键 ' + GUIDE_KEY);
  const state = JSON.parse(raw);
  assert.equal(state.version, 1);
  assert.ok(typeof state.dismissedAt === 'string' && !Number.isNaN(Date.parse(state.dismissedAt)));
  const again = browser({storage});
  assert.equal(again.query('#guideBanner').hidden, true, '同一浏览器的下次打开不再自动提示');
});

test('引导键不进入每书 state / 备份 v3 / 学习进度与配额', () => {
  const storage = new Map();
  const b = browser({storage});
  b.query('#guideBannerDismiss').click();
  const S = b.T.getS();
  assert.ok(!Object.prototype.hasOwnProperty.call(S, 'guide'), 'state 不应含 guide 字段');
  assert.ok(!Object.prototype.hasOwnProperty.call(S.settings, 'guide'), 'settings 不应含 guide 字段');
  const stateRaw = storage.get(KAOYAN_KEY) || '';
  assert.ok(!stateRaw.includes(GUIDE_KEY), '主记录不应引用引导键');
  const backup = JSON.stringify(b.T.buildExport());
  assert.ok(!backup.includes('vocab_guide'), '备份 v3 不应包含引导状态');
  assert.ok(!backup.includes('dismissedAt'), '备份 v3 不应包含引导状态字段');
  const keys = b.T.getStorageKeys();
  assert.ok(!JSON.stringify(keys).includes(GUIDE_KEY), '引导键不属于任何词书存储键');
});

test('已有用户：首次也出现一次提示条，但设置与记录不被重置', () => {
  const storage = new Map();
  storage.set(KAOYAN_KEY, JSON.stringify(existingUserState()));
  const b = browser({storage});
  assert.equal(b.query('#guideBanner').hidden, false, '老用户升级后也提示一次（可跳过）');
  assert.equal(b.T.getS().settings.dailyNew, 7, '已有每日新词设置保留');
  assert.equal(b.T.getS().settings.theme, 'dark', '已有主题保留');
  b.query('#guideBannerDismiss').click();
  assert.equal(b.T.getS().settings.dailyNew, 7, '跳过引导不得重置已有设置');
  assert.equal(b.T.getS().settings.order, 'freq');
  assert.ok(Object.keys(b.T.getS().progress).length >= 1, '学习进度保留');
  const again = browser({storage});
  assert.equal(again.query('#guideBanner').hidden, true, '老用户也只在首次提示');
});

test('提示条只在背诵页出现；切到其他视图隐藏，回到背诵不重复打扰已确认用户', () => {
  const b = browser();
  b.T.show('stats');
  assert.equal(b.query('#guideBanner').hidden, true, '非背诵页不显示提示条');
  b.T.show('study');
  assert.equal(b.query('#guideBanner').hidden, false, '未确认时回到背诵页仍显示');
  b.query('#guideBannerDismiss').click();
  b.T.show('stats');
  b.T.show('study');
  assert.equal(b.query('#guideBanner').hidden, true, '确认后不再出现');
});

// ===========================================================================
// B. 可重开的完整说明浮层
// ===========================================================================
test('提示条「查看使用说明」打开说明浮层，同样记为已看并隐藏提示条', () => {
  const storage = new Map();
  const b = browser({storage});
  b.query('#guideBannerOpen').click();
  assert.equal(b.query('#guideSheet').hidden, false, '打开完整说明浮层');
  assert.equal(b.query('#guideBanner').hidden, true, '打开说明后隐藏首屏提示条');
  assert.ok(storage.get(GUIDE_KEY), '打开说明视为已看引导');
  const text = b.text('#guideSheet');
  for (const kw of ['选词书', '当前范围不是全书', '先回忆', '熟练', '额度']) {
    assert.ok(text.includes(kw), '说明浮层应讲清「' + kw + '」');
  }
  assert.equal(b.doc.activeElement, b.query('#guideSheet .sheet-panel'), '打开后焦点进入浮层');
});

test('Esc 关闭说明浮层并把焦点还给背诵卡片', () => {
  const b = browser();
  b.query('#guideBannerOpen').click();
  b.key('Escape');
  assert.equal(b.query('#guideSheet').hidden, true, 'Esc 关闭说明浮层');
  assert.equal(b.query('#card').contains(b.doc.activeElement) || b.doc.activeElement === b.query('#card'),
    true, '关闭后焦点回到学习卡片');
});

test('确认后可随时从「?」帮助浮层「再看一次使用说明」重开', () => {
  const storage = new Map();
  const b = browser({storage});
  b.query('#guideBannerDismiss').click();
  assert.equal(b.query('#guideBanner').hidden, true);
  b.query('#btnHelp').click();
  assert.equal(b.query('#helpSheet').hidden, false, '帮助浮层打开');
  assert.ok(b.query('#btnGuideFromHelp'), '帮助浮层应有「再看一次使用说明」入口');
  b.query('#btnGuideFromHelp').click();
  assert.equal(b.query('#guideSheet').hidden, false, '重开说明浮层');
  assert.equal(b.query('#helpSheet').hidden, true, '帮助浮层让位给说明浮层');
  // 「开始学习」关闭，可立即学习。
  b.query('#guideStartBtn').click();
  assert.equal(b.query('#guideSheet').hidden, true);
  const S = b.T.getS();
  Object.assign(S.settings, {order: 'freq', dailyNew: 20, fmin: 1, fmax: 0, pmin: 0});
  b.T.startSession();
  b.key('f');
  assert.equal(b.T.phase, 'revealed', '关闭说明后可立即键盘学习');
});

test('说明浮层可被背景/关闭按钮关闭，引导状态不因重开而回退', () => {
  const storage = new Map();
  const b = browser({storage});
  b.query('#guideBannerDismiss').click();
  const seenState = storage.get(GUIDE_KEY);
  b.T.openGuide();
  assert.equal(b.query('#guideSheet').hidden, false);
  b.query('#guideSheet .sheet-head .icon-btn').click();
  assert.equal(b.query('#guideSheet').hidden, true, '关闭按钮关闭说明');
  assert.equal(storage.get(GUIDE_KEY), seenState, '重看说明不改变已看状态');
  // 打开说明不会改写任何学习设置/进度。
  assert.equal(b.T.getS().settings.dailyNew, 20);
});

test('设置页「离线与帮助」入口可再次打开使用说明', () => {
  const b = browser();
  b.query('#guideBannerDismiss').click();
  const replay = b.query('#btnReplayGuide');
  assert.ok(replay, '设置页应有「再看一次使用说明」入口');
  replay.click();
  assert.equal(b.query('#guideSheet').hidden, false, '从设置页重开说明浮层');
  assert.equal(b.query('#guideSheet').hidden, false);
  b.query('#guideStartBtn').click();
  assert.equal(b.query('#guideSheet').hidden, true);
  // 设置页 06 分区存在，且说明入口与离线状态在同一节。
  assert.ok(b.query('#settings-offline'), '设置页应有离线与帮助分区');
});

// ===========================================================================
// C. 词表范围摘要
// ===========================================================================
test('词表搜索框 placeholder 明确支持单词和中文释义', () => {
  const b = browser();
  const q = b.query('#q');
  assert.ok(q, '应有搜索框');
  assert.match(String(q.placeholder), /单词/);
  assert.match(String(q.placeholder), /中文/);
});

test('结果摘要显示「当前范围 · 状态 · 共 N 词（全库 M 词）」', () => {
  const b = browser();
  b.T.show('list');
  const W = b.T.getW();
  const scopeCount = b.T.inScopeCount();
  const text = b.text('#listCount');
  assert.ok(text.includes('当前范围'), '默认范围筛选应说明「当前范围」：' + text);
  assert.ok(text.includes('全部'), '默认状态应说明「全部」：' + text);
  assert.ok(text.includes('共 ' + scopeCount + ' 词'), '应显示当前结果词数：' + text);
  assert.ok(text.includes('全库 ' + W.length + ' 词'), '当前范围时应补全库词数：' + text);
  assert.ok(!text.includes('&'), '摘要应为纯文本（不注入 HTML）');
});

test('切换状态/全库范围时摘要同步更新，并保留「共 N 词」可读格式', () => {
  const b = browser();
  b.T.show('list');
  const W = b.T.getW();
  b.query('#fsc').value = 'all';
  b.T.applyFilter();
  let text = b.text('#listCount');
  assert.ok(text.startsWith('全库 · 全部 · 共 '), '全库范围摘要：' + text);
  assert.ok(text.includes('共 ' + W.length + ' 词'), '全库应计入全部词条：' + text);
  b.query('#fst').value = 'wrong';
  b.T.applyFilter();
  text = b.text('#listCount');
  assert.ok(text.includes('全库 · 错词'), '状态名应出现在摘要：' + text);
  assert.match(text, /共 \d+ 词/);
  b.query('#fsc').value = 'scope';
  b.T.applyFilter();
  assert.ok(b.text('#listCount').includes('当前范围 · 错词'));
});

test('搜索单词与中文释义都能命中；零结果显示「共 0 词」', () => {
  const b = browser();
  b.T.show('list');
  const W = b.T.getW();
  const w = W[0].w;
  b.query('#q').value = w;
  b.query('#fst').value = 'all';
  b.query('#fsc').value = 'scope';
  b.T.applyFilter();
  assert.match(b.text('#listCount'), /共 \d+ 词/);
  assert.ok(Number(b.text('#listCount').match(/共 (\d+) 词/)[1]) >= 1, '英文搜索应命中：' + b.text('#listCount'));
  // 中文释义：取一个词释义的前两个汉字
  let zh = '';
  for (const x of W) { const t = String(x.m || ''); if (t.length >= 2) { zh = t.slice(0, 2); break; } }
  b.query('#q').value = zh;
  b.T.applyFilter();
  assert.match(b.text('#listCount'), /共 \d+ 词/);
  const n = Number(b.text('#listCount').match(/共 (\d+) 词/)[1]);
  assert.ok(n >= 1, '中文释义搜索应至少命中一个词（' + zh + '）');
  b.query('#q').value = 'zzzz-not-a-word-zzzz';
  b.T.applyFilter();
  assert.ok(b.text('#listCount').includes('共 0 词'), '零结果：' + b.text('#listCount'));
  assert.equal(b.query('#listEmpty').hidden, false, '零结果应显示空态');
});

test('当前范围外搜索：scope 下 0 词，切到全库后命中', () => {
  const b = browser();
  b.T.show('list');
  const W = b.T.getW();
  // 选一个不在当前范围、且不是任何范围内单词子串的词（搜索是单词/释义子串匹配）
  let outside = -1;
  for (let i = 0; i < W.length; i++) {
    const w = W[i].w;
    if (b.T.inScope(i) || w.length < 5) continue;
    let contained = false;
    for (let j = 0; j < W.length && !contained; j++) {
      if (b.T.inScope(j) && W[j].w.includes(w)) contained = true;
    }
    if (!contained) { outside = i; break; }
  }
  assert.ok(outside >= 0, '默认范围应小于全库且能找到一个范围外单词');
  b.query('#fst').value = 'all';
  b.query('#fsc').value = 'scope';
  b.query('#q').value = W[outside].w;
  b.T.applyFilter();
  assert.ok(b.text('#listCount').includes('共 0 词'), '当前范围外搜索应 0 词并提示范围：' + b.text('#listCount'));
  b.query('#fsc').value = 'all';
  b.T.applyFilter();
  assert.ok(b.text('#listCount').includes('共 1 词'), '切到全库应命中该词：' + b.text('#listCount'));
});

test('重置列表筛选只清搜索/状态/范围，不改学习设置与学习队列', () => {
  const b = browser();
  const S = b.T.getS();
  Object.assign(S.settings, {dailyNew: 7, groupSize: 12, order: 'freq'});
  b.T.show('list');
  b.query('#q').value = 'alpha';
  b.query('#fst').value = 'wrong';
  b.query('#fsc').value = 'all';
  b.T.applyFilter();
  const settingsBefore = JSON.stringify(S.settings);
  const queueBefore = JSON.stringify(b.T.Q);
  b.query('#clearListFilters').click();
  assert.equal(b.query('#q').value, '', '清空搜索');
  assert.equal(b.query('#fst').value, 'all', '状态恢复全部');
  assert.equal(b.query('#fsc').value, 'all', '范围恢复全库');
  assert.equal(JSON.stringify(b.T.getS().settings), settingsBefore, '不得重置学习设置');
  assert.equal(JSON.stringify(b.T.Q), queueBefore, '不得重建/改写学习队列');
  assert.equal(b.doc.activeElement, b.query('#q'), '重置后焦点回到搜索框');
});

test('词表仍保持一个 Tab 停靠点与方向键换行', () => {
  const b = browser();
  b.T.show('list');
  let stops = b.all('#listInner [tabindex="0"]');
  assert.equal(stops.length, 1, '虚拟列表只保留一个 Tab 停靠点');
  const first = stops[0];
  first.focus();
  const word0 = first.dataset.openWord;
  const event = b.key('ArrowDown');
  assert.equal(event.defaultPrevented, true, '方向键由列表接管');
  assert.notEqual(b.doc.activeElement.dataset.openWord, word0, '方向键换到下一行');
  assert.equal(b.all('#listInner [tabindex="0"]').length, 1, '换行后仍只有一个停靠点');
});

test('引导与词表摘要都通过调试钩子可读（不改学习记录）', () => {
  const storage = new Map();
  const b = browser({storage});
  const state = b.T.getGuideState();
  assert.equal(state.key, GUIDE_KEY);
  assert.equal(state.seen, false);
  assert.equal(state.bannerVisible, true);
  b.query('#guideBannerDismiss').click();
  assert.equal(b.T.getGuideState().seen, true);
  b.T.show('list');
  assert.equal(b.T.getListSummary(), b.text('#listCount'), '钩子与界面摘要一致');
});

console.log(`\n11 引导与词表范围：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
