/**
 * C-07b 回归：词表聚焦首行后「首次」ArrowDown 必须立即换行并播报。
 * 用解析真实 index.html 的 DOM 桩执行真实 js/app.js；关键点：桩的 focus() 会像浏览器一样
 * 派发 focusin 冒泡事件（C-07b 的根因是 renderRows 把焦点还回旧行 → focusin 改写活动行）。
 * 同时回归 ArrowUp / End / Home / 行内 Tab / ArrowLeft-Right / roving tabindex=1。
 * 运行：node --max-old-space-size=512 js/test-list-arrow.mjs
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

/** DOM 桩：解析真实 HTML；focus() 派发 focusin 冒泡（与浏览器一致，能复现 C-07b）。 */
function browser() {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.hidden = false; this.disabled = false;
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
    /** 与浏览器一致：设置 activeElement 并派发 focusin（冒泡到 document）。 */
    focus() {
      if (!doc.contains(this) || this.disabled) return;
      doc.activeElement = this;
      for (let n = this; n; n = n.parentNode) {
        if (n['onfocusin']) n['onfocusin']({type: 'focusin', target: this});
        for (const fn of n.events.get('focusin') || []) fn({type: 'focusin', target: this});
      }
    }
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
  const intervals = [], storage = new Map();
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener() {}, matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}),
    getComputedStyle: () => ({fontSize: '32px'}), innerWidth: 1200, innerHeight: 800};
  const context = vm.createContext({
    window, document: doc, console, Date,
    localStorage: {getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    setInterval() { return 0; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance: {now: () => Date.now()},
    SpeechSynthesisUtterance: class {}, speechSynthesis: {cancel(){}, speak(){}, getVoices(){ return []; }}
  });
  vm.runInContext(words, context, {filename: 'words-data.js'});
  vm.runInContext(app, context, {filename: 'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, doc, storage, query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    rowWords: () => doc.querySelectorAll('#listInner [data-open-word]'),
    list: () => doc.querySelector('#listInner'),
    announcement: () => (doc.querySelector('#listAnnouncement') || {}).textContent || '',
    tabStops: () => doc.querySelectorAll('#listInner [tabindex="0"]'),
    activeWord: () => doc.activeElement?.dataset?.openWord ?? null,
    activeProf: () => doc.activeElement?.dataset?.proficient ?? null
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

/** 与 applyFilter（状态 all / 范围 scope / 无搜索）一致的行顺序：inScope 且非熟练，按词频 r 升序。 */
const ordered = b => {
  const W = b.T.getW();
  const arr = [];
  for (let i = 0; i < W.length; i++) if (b.T.inScope(i) && !b.T.isProficient(i)) arr.push(i);
  arr.sort((a, c) => W[a].r - W[c].r);
  return arr;
};

// ===========================================================================
// C-07b：首次方向键
// ===========================================================================
test('进入词表后聚焦首行：活动行/播报/唯一 Tab 停靠点正确', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  const words = b.rowWords();
  assert.ok(words.length > 2, '词表应有行渲染');
  assert.equal(b.tabStops().length, 1, '列表只有一个 Tab 停靠点');
  words[0].focus();
  assert.equal(b.activeWord(), String(ids[0]), '焦点在首行单词');
  assert.equal(b.T.getListActiveWord(), ids[0], '活动行为首行');
  assert.match(b.announcement(), /第 1 行，共 \d+ 行/);
});

test('C-07b：聚焦首行后「第一次」ArrowDown 立即换到第 2 行并播报', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  const event = b.key('ArrowDown');
  assert.equal(event.defaultPrevented, true, '方向键由列表接管');
  assert.equal(b.activeWord(), String(ids[1]), '第一次 ArrowDown 即聚焦第 2 行（旧缺陷要按两次）');
  assert.equal(b.T.getListActiveWord(), ids[1], 'listActiveWord 同步到第 2 行');
  assert.match(b.announcement(), /第 2 行，共 \d+ 行/, '第一次按键即播报第 2 行：' + b.announcement());
  assert.equal(b.tabStops().length, 1, '换行后仍只有一个 Tab 停靠点');
  const stop = b.tabStops()[0];
  assert.equal(Number(stop.dataset.openWord), ids[1], '唯一停靠点在第 2 行');
});

test('连续 ArrowDown / ArrowUp 每一步都立即生效', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  b.key('ArrowDown');
  b.key('ArrowDown');
  assert.equal(b.T.getListActiveWord(), ids[2], '第二次 ArrowDown 到第 3 行');
  const up = b.key('ArrowUp');
  assert.equal(up.defaultPrevented, true);
  assert.equal(b.T.getListActiveWord(), ids[1], 'ArrowUp 立即回到第 2 行');
  b.key('ArrowUp');
  assert.equal(b.T.getListActiveWord(), ids[0], '回到首行');
  const noop = b.key('ArrowUp');
  assert.equal(noop.defaultPrevented, false, '首行再 ArrowUp 不拦截（交给页面滚动）');
  assert.equal(b.T.getListActiveWord(), ids[0], '首行 ArrowUp 不越界');
});

test('End / Home 一次直达末行与首行并播报', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  const end = b.key('End');
  assert.equal(end.defaultPrevented, true);
  assert.equal(b.T.getListActiveWord(), ids[ids.length - 1], 'End 直达末行（列表只渲染窗口，活动行仍为末行）');
  assert.match(b.announcement(), new RegExp('第 ' + ids.length + ' 行'));
  const home = b.key('Home');
  assert.equal(home.defaultPrevented, true);
  assert.equal(b.T.getListActiveWord(), ids[0], 'Home 回到首行');
  assert.match(b.announcement(), /第 1 行/);
});

test('行内 Tab：单词 → 熟练操作 → 离开列表；Shift+Tab 反向', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  const tab1 = b.key('Tab');
  assert.equal(tab1.defaultPrevented, true, '单词 → 熟练操作由脚本接管');
  assert.equal(b.activeProf(), String(ids[0]), '焦点到本行熟练按钮');
  assert.equal(b.tabStops().length, 1, '同一行仍只有一个停靠点');
  const tab2 = b.key('Tab');
  assert.equal(tab2.defaultPrevented, false, '熟练操作后允许离开列表');
  b.query('[data-proficient="' + ids[0] + '"]').focus();
  const back = b.key('Tab', {shiftKey: true});
  assert.equal(back.defaultPrevented, true, 'Shift+Tab 回到本行单词');
  assert.equal(b.activeWord(), String(ids[0]));
});

test('ArrowRight / ArrowLeft 在单词与熟练按钮之间切换', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  b.key('ArrowRight');
  assert.equal(b.activeProf(), String(ids[0]), 'ArrowRight 到熟练按钮');
  b.key('ArrowLeft');
  assert.equal(b.activeWord(), String(ids[0]), 'ArrowLeft 回到单词');
});

test('切书/返回后列表仍是「一次按键」换行（无遗留旧焦点竞争）', () => {
  const b = browser();
  b.T.show('list');
  const ids = ordered(b);
  b.rowWords()[0].focus();
  b.T.show('stats');
  b.T.show('list');
  const first = b.query('#listInner [data-open-word]');
  first.focus();
  b.key('ArrowDown');
  assert.equal(b.T.getListActiveWord(), ids[1], '重新进入词表后首次方向键同样生效');
  assert.equal(b.activeWord(), String(ids[1]));
});

console.log(`\nC-07b 词表方向键回归：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
