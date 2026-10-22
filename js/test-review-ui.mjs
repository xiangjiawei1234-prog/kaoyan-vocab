/**
 * UI 审查回归：节点树、焦点销毁、虚拟列表导航、空态与读屏反馈。
 * vm 运行真实 app.js；DOM 桩仅模拟浏览器行为，不复制业务实现。
 * 运行：node --max-old-space-size=512 js/test-review-ui.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const words = fs.readFileSync(path.join(ROOT, 'js/words-data.js'), 'utf8');
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function browser() {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.value = ''; this.checked = false; this.hidden = false; this.disabled = false;
      this.writes = 0; this.textWrites = 0;
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
    set textContent(value) {
      this.detachChildren(); this._html = ''; this._text = String(value); this.textWrites++;
    }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this.detachChildren(); this._text = ''; this._html = String(value); this.writes++;
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
      if (name === 'title') this.title = String(value);
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
      while (bits.length) { const bit = bits.pop(); current = current.parentNode;
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
  for (const select of doc.querySelectorAll('select')) {
    const option = select.querySelector('[selected]') || select.querySelector('option');
    select.value = option?.getAttribute('value') ?? option?.textContent ?? '';
  }
  doc.activeElement = doc.body; doc.visibilityState = 'visible';
  doc.createElement = tag => new Node(tag);
  const intervals = [], storage = new Map(), winEvents = new Map();
  const window = {document:doc, addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    matchMedia:() => ({matches:false, addEventListener(){}}), getSelection:() => ({toString:() => ''})};
  const context = vm.createContext({window, document:doc, console, Date,
    localStorage:{getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,String(v)), removeItem:k => storage.delete(k)},
    setInterval(fn, ms) { intervals.push({fn,ms}); return intervals.length; }, clearInterval(){},
    setTimeout(){return 0;}, clearTimeout(){}, requestAnimationFrame(fn){fn();}, cancelAnimationFrame(){},
    confirm:() => true, Blob:class {}, URL:{createObjectURL:() => 'blob:test', revokeObjectURL(){}},
    FileReader:class {}, performance:{now:() => Date.now()},
    SpeechSynthesisUtterance:class {}, speechSynthesis:{cancel(){},speak(){}}
  });
  vm.runInContext(words, context, {filename:'words-data.js'});
  vm.runInContext(app, context, {filename:'app.js'});
  const T = window.__vocab;
  const S = T.getS();
  Object.assign(S.settings, {fmin:1, fmax:0, pmin:0, kyOnly:false, pos:[], order:'freq', dailyNew:10});
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  T.startSession();
  return {T, S, doc, intervals, storage, query:s => doc.querySelector(s), all:s => doc.querySelectorAll(s),
    key:(key, opts = {}) => doc.activeElement.dispatch('keydown', {key,...opts})};
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + e.stack); }
}
const rowWords = b => b.all('#listInner [data-open-word]');
const ordered = b => b.T.getW().map((w,i) => ({w,i})).sort((a,c) => a.w.r - c.w.r).map(x => x.i);

// These DOM checks prevent permissive mocks from hiding missing-node/focus regressions.
test('DOM 桩：缺失节点返回 null，重绘销毁旧节点与焦点', () => {
  const b = browser(), acts = b.query('#acts'), button = b.query('#ok');
  assert.equal(b.query('#not-a-real-id'), null);
  assert.ok(acts.contains(button));
  button.focus(); acts.innerHTML = '<button id="replacement">替代</button>';
  assert.equal(b.doc.activeElement, b.doc.body);
  assert.equal(b.query('#ok'), null);
  assert.equal(acts.contains(button), false);
});

test('判定按钮消失后焦点回到词卡，继续键翻页并播报新词', () => {
  const b = browser(), old = b.T.cur;
  b.query('#ok').focus(); b.query('#ok').click();
  assert.equal(b.T.phase, 'revealed');
  assert.equal(b.doc.activeElement, b.query('#card'));
  assert.match(b.query('#studyAnnouncement').textContent, /已记为会/);
  assert.ok(b.query('#studyAnnouncement').textContent.includes(b.T.getW()[old].m));
  b.key(' ');
  assert.notEqual(b.T.cur, old);
  assert.equal(b.T.phase, 'recall');
  assert.ok(b.query('#studyAnnouncement').textContent.startsWith(b.T.getW()[b.T.cur].w));
});

test('重绘保留仍存在的收藏按钮焦点，重复播报文本不重复写入', () => {
  const b = browser(), announcement = b.query('#studyAnnouncement');
  b.query('#star').focus();
  const oldStar = b.query('#star'), writes = announcement.textWrites;
  oldStar.click();
  assert.notEqual(b.query('#star'), oldStar);
  assert.equal(b.doc.activeElement, b.query('#star'));
  assert.equal(announcement.textWrites, writes);
});

test('完成页和撤销后的焦点都留在有效学习节点', () => {
  const b = browser(); b.S.settings.dailyNew = 1; b.T.startSession();
  b.T.judge(true); b.query('#nx').focus(); b.query('#nx').click();
  assert.equal(b.T.cur, null);
  assert.equal(b.doc.activeElement, b.query('#card'));
  assert.equal(b.query('#studyAnnouncement').textContent, '本组学习结束。');
  b.query('#undoBtn').focus(); b.query('#undoBtn').click();
  assert.notEqual(b.T.cur, null);
  assert.equal(b.doc.activeElement, b.query('#undoBtn'));
  assert.equal(b.doc.contains(b.doc.activeElement), true);
});

test('相同列表轮询保留节点身份与焦点，变化后保持同词操作焦点', () => {
  const b = browser(), i = ordered(b)[0];
  b.S.progress[i] = [1, Date.now()-1000, 1, 0, Date.now()-1000];
  b.T.show('list'); b.query('#fst').value = 'due'; b.T.applyFilter();
  const original = b.query('[data-open-word="'+i+'"]'); original.focus();
  const writes = b.query('#listInner').writes;
  b.intervals.find(t => t.ms === 30000).fn();
  assert.equal(b.query('[data-open-word="'+i+'"]'), original);
  assert.equal(b.query('#listInner').writes, writes);
  assert.equal(b.doc.activeElement, original);
  b.S.stars[i] = 1; b.T.applyFilter(false);
  assert.notEqual(b.query('[data-open-word="'+i+'"]'), original);
  assert.equal(b.doc.activeElement, b.query('[data-open-word="'+i+'"]'));
});

test('滚动移除焦点行时回到列表容器，不留下脱离文档的焦点', () => {
  const b = browser(); b.T.show('list'); rowWords(b)[0].focus();
  const sc = b.query('#listScroll'); sc.scrollTop = 52*100; sc.dispatch('scroll');
  assert.equal(b.doc.activeElement, sc);
  assert.equal(b.doc.contains(b.doc.activeElement), true);
});

test('方向键及 Home/End 可跨虚拟窗口，到达词序两端', () => {
  const b = browser(), ids = ordered(b); b.T.show('list'); rowWords(b)[0].focus();
  let event = b.key('ArrowDown'); assert.equal(event.defaultPrevented, true);
  assert.equal(b.doc.activeElement.dataset.openWord, String(ids[1]));
  for (let k = 0; k < 25; k++) b.key('ArrowDown');
  assert.equal(b.doc.activeElement.dataset.openWord, String(ids[26]));
  assert.ok(b.query('#listScroll').scrollTop > 0);
  b.key('End'); assert.equal(b.doc.activeElement.dataset.openWord, String(ids.at(-1)));
  b.key('Home'); assert.equal(b.doc.activeElement.dataset.openWord, String(ids[0]));
  event = b.key('ArrowUp'); assert.equal(event.defaultPrevented, false);
});

test('虚拟列表只保留一个 Tab 停靠点：单词→熟练→离开，方向键换行', () => {
  const b = browser(), ids = ordered(b); b.T.show('list');
  let stops = b.all('#listInner [tabindex="0"]');
  assert.equal(stops.length, 1, '列表中应只有一个 Tab 停靠点');
  const word = stops[0];
  assert.equal(word.dataset.openWord, String(ids[0]), '默认活动行为第一行');
  word.focus();
  let event = b.key('Tab');
  assert.equal(event.defaultPrevented, true, '单词 → 本行熟练操作由脚本接管');
  assert.equal(b.doc.activeElement.dataset.proficient, String(ids[0]));
  stops = b.all('#listInner [tabindex="0"]');
  assert.equal(stops.length, 1, '同一行仍只有一个 Tab 停靠点');
  event = b.key('Tab');
  assert.equal(event.defaultPrevented, false, '熟练操作后允许离开列表');
  b.query('[data-proficient="'+ids[0]+'"]').focus();
  event = b.key('Tab', {shiftKey:true});
  assert.equal(event.defaultPrevented, true, 'Shift+Tab 回到本行单词');
  assert.equal(b.doc.activeElement.dataset.openWord, String(ids[0]));
  b.key('ArrowDown');
  assert.equal(b.doc.activeElement.dataset.openWord, String(ids[1]));
  assert.match(b.query('#listAnnouncement').textContent, /第 2 行，共 \d+ 行/);
});

test('词表离开再返回保留搜索、筛选、滚动与活动行', () => {
  const b = browser(); b.T.show('list');
  b.query('#q').value = b.T.getW()[0].w;
  b.query('#fst').value = 'all';
  b.query('#fsc').value = 'all';
  b.T.applyFilter();
  const sc = b.query('#listScroll');
  sc.scrollTop = 52 * 20; sc.dispatch('scroll');
  const active = b.doc.activeElement; // 不要求焦点，记录活动行即可
  const word = b.T.getListActiveWord();
  b.T.show('stats');
  b.query('#q').value = 'changed-outside-list';
  b.T.show('list');
  assert.equal(b.query('#q').value, b.T.getW()[0].w, '返回后恢复搜索词');
  assert.equal(b.query('#fsc').value, 'all');
  assert.ok(sc.scrollTop >= 0);
  assert.equal(b.T.getListActiveWord(), word, '活动行不因切页丢失');
});

test('例句只有一个键盘入口，方向键选词、回车开浮层、Esc 回到触发词', () => {
  const b = browser();
  const i = b.T.getW().findIndex(x => x.ex);
  assert.ok(i >= 0, '词库应有带例句的词');
  b.T.setProficient(i, false);
  b.T.setCur(i); b.T.setVerdict(null); b.T.judge(true);
  const ex = b.query('#card .ex');
  assert.ok(ex, '判定后渲染例句容器');
  assert.equal(ex.getAttribute('tabindex'), '0', '整句只有一个键盘入口');
  assert.equal(b.all('#card .ex .ex-word[tabindex="0"]').length, 0, '句内单词不再各占 Tab');
  ex.focus();
  b.key('ArrowRight');
  const active = b.query('#card .ex .ex-word.ex-active');
  assert.ok(active, '方向键产生活动词');
  b.key('Enter');
  const pop = b.query('#exPop');
  assert.equal(pop.hidden, false, '回车打开查词浮层');
  assert.equal(b.doc.activeElement, pop, '打开后焦点进入浮层');
  assert.equal(ex.getAttribute('aria-expanded'), 'true');
  b.key('Escape');
  assert.equal(pop.hidden, true, 'Esc 关闭浮层');
  assert.equal(ex.getAttribute('aria-expanded'), 'false');
  assert.ok(ex.contains(b.doc.activeElement) || b.doc.activeElement === ex, 'Esc 后焦点回到触发句/词');
});

test('空背诵范围提供清筛选入口，清除列表筛选不改学习设置与队列', () => {
  const b = browser(); b.S.settings.fmin = 9999; b.T.startSession(); b.T.show('list');
  assert.equal(b.query('#listEmpty').hidden, false);
  assert.equal(b.query('#listWrap').hidden, true);
  const queue = JSON.stringify(b.T.Q), settings = JSON.stringify(b.S.settings);
  b.query('#q').value = 'nonexistent-match'; b.query('#fst').value = 'wrong'; b.T.applyFilter();
  b.query('#clearListFilters').click();
  assert.equal(b.query('#q').value, ''); assert.equal(b.query('#fst').value, 'all');
  assert.equal(b.query('#fsc').value, 'all');
  assert.equal(b.query('#listEmpty').hidden, true); assert.equal(b.query('#listWrap').hidden, false);
  assert.equal(b.doc.activeElement, b.query('#q'));
  assert.equal(JSON.stringify(b.S.settings), settings); assert.equal(JSON.stringify(b.T.Q), queue);
});

test('乱序单样本展示 Wilson 真实非对称区间，空样本与非乱序状态正确', () => {
  const b = browser();
  assert.equal(b.query('#surveyChip').hidden, true);
  b.S.settings.order = 'shuffle'; b.T.startSession();
  assert.equal(b.query('#surveyChip').hidden, false);
  assert.equal(b.query('#s-survey').textContent, '—');
  assert.equal(b.query('#s-survey-ci').textContent, '');
  b.T.judge(true);
  assert.equal(b.query('#s-survey').textContent, '100%');
  assert.equal(b.query('#s-survey-ci').textContent, '95% 区间 21%–100%');
  b.T.judge(false);
  assert.equal(b.query('#s-survey').textContent, '0%');
  assert.equal(b.query('#s-survey-ci').textContent, '95% 区间 0%–79%');
  b.T.undo(); assert.equal(b.query('#s-survey-ci').textContent, '95% 区间 21%–100%');
  b.T.undo(); assert.equal(b.query('#s-survey-ci').textContent, '');
});

test('学习量图表点击写出完整日期、新词与复习记录', () => {
  const b = browser(); b.T.judge(true); b.T.show('stats');
  const bar = b.all('#days [data-day-label]').at(-1);
  assert.ok(bar.dataset.dayLabel.includes('新词 1 · 复习 0'));
  bar.click();
  assert.equal(b.query('#daysHint').textContent, bar.dataset.dayLabel);
});

test('换词清空卡片旧滚动，当前词改判与收藏不丢阅读位置', () => {
  const b = browser(), card = b.query('#card');
  b.T.judge(true);
  assert.equal(card.classList.contains('has-answer'), true);
  assert.ok(b.query('.word-face'));
  card.scrollTop = 180;
  b.T.judge(false);
  assert.equal(card.scrollTop, 180);
  b.query('#star').click();
  assert.equal(card.scrollTop, 180);
  b.T.tryNext(true);
  assert.equal(card.scrollTop, 0);
  assert.equal(card.classList.contains('has-answer'), false);
  assert.equal(b.query('.answer'), null);
});

test('直接切换当前学习词也回到卡片顶部', () => {
  const b = browser(), card = b.query('#card');
  card.scrollTop = 200;
  b.T.startSession();
  // 同词重新开始不强制丢失位置；换到另一个单词必须归零。
  const next = b.T.cur === 0 ? 1 : 0;
  b.T.setCur(next);
  assert.equal(card.scrollTop, 0);
});

console.log(`\nUI 审查回归：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
