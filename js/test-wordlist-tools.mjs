/**
 * E 词表整理回归：保存筛选视图（独立键/损坏拒写/按书隔离/上限/重命名/删除）、
 * 整理模式全筛选选择（含虚拟列表未渲染行）、批量收藏/熟练（预览确认、一次保存、
 * 失败整次回滚内存）、应用视图只改列表筛选、导出沿用当前筛选。
 * 用真实 index.html 解析出的 DOM 桩 + vm 运行真实 js/app.js，不复制业务实现。
 * 运行：node --max-old-space-size=512 js/test-wordlist-tools.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const LIST_VIEWS_KEY = "vocab_list_views_v1";

/** DOM 桩：解析真实 HTML；focus() 派发 focusin 冒泡；localStorage 可注入损坏原文/模拟写入失败。 */
function browser({multiBook = false, prefill = null, failStorage = false} = {}) {
  let doc;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.hidden = false; this.disabled = false; this.open = false;
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
      if (['hidden','disabled','checked','open'].includes(name)) this[name] = true;
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
  const storage = new Map(Object.entries(prefill || {}));
  const state = {failStorage: !!failStorage, confirmResult: true};
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener() {}, matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}),
    getComputedStyle: () => ({fontSize: '32px'}), innerWidth: 1200, innerHeight: 800};
  const context = vm.createContext({
    window, document: doc, console, Date,
    localStorage: {
      getItem: k => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => { if (state.failStorage) throw new Error("QuotaExceededError"); storage.set(k, String(v)); },
      removeItem: k => storage.delete(k)
    },
    setInterval() { return 0; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => state.confirmResult, Blob: class {}, URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance: {now: () => Date.now()},
    SpeechSynthesisUtterance: class {}, speechSynthesis: {cancel(){}, speak(){}, getVoices(){ return []; }}
  });
  vm.runInContext(wordsSource, context, {filename: 'words-data.js'});
  if (multiBook) for (const file of ['cet-words-data.js', 'combined-words-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), context, {filename: file});
  }
  vm.runInContext(app, context, {filename: 'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, doc, storage, state, S: T.getS(),
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    text: s => (doc.querySelector(s) || {}).textContent || '',
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    rowWords: () => doc.querySelectorAll('#listInner [data-open-word]'),
    rowChecks: () => doc.querySelectorAll('#listInner [data-row-check]'),
    tabStops: () => doc.querySelectorAll('#listInner [tabindex="0"]'),
    mainKey: id => T.getStorageKeys().books[id || T.getBook()].state,
    profKey: id => T.getStorageKeys().books[id || T.getBook()].prof
  };
}
const wordsSource = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

/* ---------------- 夹具辅助 ---------------- */
/** 让当前书全部词进入范围，并选 n 个词写成「错词」（p[3]>0）以便得到确定的小筛选集。 */
function seedWrong(b, n = 40) {
  const S = b.S, T = b.T, W = T.getW();
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], posMode: 'primary'});
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  const idx = [];
  for (let i = 0; i < W.length && idx.length < n; i++) {
    if (!T.inScope(i) || T.isProficient(i) || i === T.cur) continue;   // 避开当前卡，便于断言队列/当前卡不被推进
    idx.push(i);
    S.progress[i] = [2, Date.now() + 86400000, 2, 2, Date.now() - 1000];
  }
  return idx;
}
function setFilter(b, {q, fst, fsc}) {
  if (q !== undefined) { b.query('#q').value = q; b.query('#q').dispatch('input'); }
  if (fst !== undefined) { b.query('#fst').value = fst; b.query('#fst').dispatch('change'); }
  if (fsc !== undefined) { b.query('#fsc').value = fsc; b.query('#fsc').dispatch('change'); }
}
function enterOrganize(b) {
  b.query('#btnToggleOrganize').click();
  assert.equal(b.query('#listOrganizeBar').hidden, false, '整理栏应显示');
}
function selectAll(b) {
  b.query('#btnSelectAllFiltered').click();
}
function parsedViews(b) {
  const raw = b.storage.get(LIST_VIEWS_KEY);
  return raw == null ? null : JSON.parse(raw);
}

// ===========================================================================
// 基本模式切换与全筛选选择（虚拟列表未渲染行不能漏）
// ===========================================================================
test('整理模式：默认隐藏、进入后行内选择按钮 + 仍只有一个 Tab 停靠点', () => {
  const b = browser();
  b.T.show('list');
  assert.equal(b.query('#listOrganizeBar').hidden, true, '默认不显示整理栏');
  assert.equal(b.T.isListOrganize(), false);
  assert.equal(b.all('#listInner [data-row-check]').length, 0, '普通模式行内没有选择按钮');
  enterOrganize(b);
  assert.equal(b.T.isListOrganize(), true);
  assert.equal(b.query('#btnToggleOrganize').getAttribute('aria-pressed'), 'true');
  assert.equal(b.rowChecks().length, b.rowWords().length, '每个渲染行都有选择按钮');
  assert.equal(b.tabStops().length, 1, '整理模式仍只有一个 Tab 停靠点');
  assert.equal(b.query('#listSelectionSummary').textContent, '尚未选择词。可点「选择当前筛选全部 ' + b.T.getFilterIndices().length + ' 词」，或点行内复选框逐个选择。');
});

test('「选择当前筛选全部」覆盖虚拟列表未渲染行，且不改筛选/学习设置', () => {
  const b = browser();
  b.T.show('list');
  const settings = JSON.stringify(b.S.settings), queue = JSON.stringify(b.T.Q), cur = b.T.cur;
  const filt = b.T.getFilterIndices();
  assert.ok(filt.length > 20, '夹具应有足够多的筛选结果');
  enterOrganize(b);
  selectAll(b);
  const selected = b.T.getListSelection();
  assert.equal(selected.length, filt.length, '全选数量=当前筛选结果数');
  const rendered = new Set(b.rowWords().map(n => Number(n.dataset.openWord)));
  const unrendered = filt.filter(i => !rendered.has(i));
  assert.ok(unrendered.length > 0, '应有未渲染的虚拟行');
  assert.ok(unrendered.every(i => selected.includes(i)), '未渲染行也必须被选中');
  assert.match(b.query('#listSelectionSummary').textContent, /全部 \d+ 词/);
  assert.equal(JSON.stringify(b.S.settings), settings, '全选不改学习设置');
  assert.equal(JSON.stringify(b.T.Q), queue);
  assert.equal(b.T.cur, cur);
  assert.equal(b.query('#listExportHint').hidden, false, '已选行时提示导出不受选择影响');
  assert.match(b.query('#listExportHint').textContent, /仅用于批量整理/);
  const check = b.rowChecks()[0];
  assert.equal(check.getAttribute('aria-checked'), 'true', '渲染行选择按钮状态同步');
});

test('行内选择按钮可逐个切换；清空选择恢复未选', () => {
  const b = browser();
  b.T.show('list');
  enterOrganize(b);
  const check = b.rowChecks()[0];
  const i = Number(check.dataset.rowCheck);
  check.click();
  assert.deepEqual(Array.from(b.T.getListSelection()), [i]);
  assert.equal(check.getAttribute('aria-checked'), 'true');
  assert.match(b.query('#listSelectionSummary').textContent, /已选 1 \//);
  check.click();
  assert.deepEqual(Array.from(b.T.getListSelection()), []);
  assert.equal(check.getAttribute('aria-checked'), 'false');
  selectAll(b);
  b.query('#btnClearSelection').click();
  assert.deepEqual(Array.from(b.T.getListSelection()), []);
  assert.match(b.query('#listAnnouncement').textContent, /已清空选择/);
});

test('整理模式方向键换行一次生效，ArrowRight 依次到选择按钮与熟练操作', () => {
  const b = browser();
  b.T.show('list');
  enterOrganize(b);
  const ids = b.T.getFilterIndices();
  b.rowWords()[0].focus();
  b.key('ArrowDown');
  assert.equal(b.T.getListActiveWord(), ids[1], '第一次 ArrowDown 立即到第 2 行');
  b.key('ArrowRight');
  assert.equal(b.doc.activeElement.dataset.rowCheck, String(ids[1]), 'ArrowRight 到本行选择按钮');
  b.key('ArrowRight');
  assert.equal(b.doc.activeElement.dataset.proficient, String(ids[1]), '再 ArrowRight 到熟练操作');
  b.key('ArrowLeft');
  assert.equal(b.doc.activeElement.dataset.rowCheck, String(ids[1]));
  b.key('Tab');
  assert.equal(b.doc.activeElement.dataset.proficient, String(ids[1]), 'Tab 从选择到熟练');
  assert.equal(b.tabStops().length, 1, '始终只有一个 Tab 停靠点');
});

// ===========================================================================
// 批量收藏（立即生效、含未渲染行、失败回滚）
// ===========================================================================
test('批量收藏/取消收藏覆盖整个筛选结果（含未渲染行）并沿用星标存储', () => {
  const b = browser();
  const picks = seedWrong(b, 40);
  b.T.show('list');
  setFilter(b, {fst: 'wrong'});
  assert.equal(b.T.getFilterIndices().length, 40);
  enterOrganize(b);
  selectAll(b);
  const before = {settings: JSON.stringify(b.S.settings), progress: JSON.stringify(b.S.progress),
    days: JSON.stringify(b.S.days), queue: JSON.stringify(b.T.Q), cur: b.T.cur, qi: b.T.qi};
  b.query('#btnBatchStar').click();
  for (const i of picks) assert.ok(b.S.stars[i], '收藏应包含未渲染行 ' + i);
  assert.equal(Object.keys(b.S.stars).length, 40);
  assert.match(b.query('#toast').textContent, /已收藏 40 词/);
  assert.equal(JSON.stringify(b.S.settings), before.settings);
  assert.equal(JSON.stringify(b.S.progress), before.progress, '批量收藏不改学习进度');
  assert.equal(JSON.stringify(b.S.days), before.days);
  assert.equal(JSON.stringify(b.T.Q), before.queue);
  assert.equal(b.T.cur, before.cur);
  assert.ok(b.storage.has(b.mainKey()), '批量收藏一次写入主记录');
  selectAll(b);
  b.query('#btnBatchUnstar').click();
  assert.equal(Object.keys(b.S.stars).length, 0);
  assert.match(b.query('#toast').textContent, /已取消收藏 40 词/);
});

test('批量收藏保存失败时整次回滚内存并持续提示', () => {
  const b = browser();
  seedWrong(b, 5);
  b.T.show('list');
  setFilter(b, {fst: 'wrong'});
  enterOrganize(b);
  selectAll(b);
  b.state.failStorage = true;
  b.query('#btnBatchStar').click();
  assert.equal(JSON.stringify(b.S.stars), '{}', '失败后内存星标回滚为空');
  assert.equal(b.query('#appAlert').hidden, false, '保存失败应出现持续错误提示');
  assert.match(b.query('#appAlertBody').textContent, /保存失败|存储不可用/);
  assert.match(b.query('#toast').textContent, /已恢复原状态/);
  b.state.failStorage = false;
  selectAll(b);
  b.query('#btnBatchStar').click();
  assert.equal(Object.keys(b.S.stars).length, 5, '恢复存储后可重试成功');
});

// ===========================================================================
// 批量熟练：影响预览 + 一次确认 + setProficient 语义 + 失败回滚
// ===========================================================================
test('批量标熟练先显示影响预览，确认后一次写入熟练键与主记录', () => {
  const b = browser();
  const picks = seedWrong(b, 40);
  b.T.show('list');
  setFilter(b, {fst: 'wrong'});
  enterOrganize(b);
  selectAll(b);
  const todayKey = (() => { const d = new Date(); const p2 = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();
  b.S.days[todayKey] = {n: 1, r: 2, ok: 1, no: 1};
  const before = {progress: JSON.stringify(b.S.progress), days: JSON.stringify(b.S.days),
    queue: JSON.stringify(b.T.Q), cur: b.T.cur, qi: b.T.qi, reviewDay: JSON.stringify(b.S.reviewDay || null)};
  const beforeQ = JSON.parse(before.queue);
  b.query('#btnBatchProficient').click();
  const box = b.query('#listBatchPreview');
  assert.equal(box.hidden, false, '必须显示影响预览');
  const text = b.query('#listBatchPreviewText').textContent;
  assert.match(text, /40 个词/);
  assert.match(text, /移出背诵\/复习\/乱序队列/);
  assert.match(text, /不改学习进度/);
  assert.equal(b.S.proficient && Object.keys(b.S.proficient).length, 0, '确认前不得修改熟练名单');
  assert.equal(b.query('#btnBatchConfirm').disabled, false);
  b.query('#btnBatchConfirm').click();
  assert.equal(Object.keys(b.S.proficient).length, 40);
  for (const i of picks) assert.ok(b.T.isProficient(i), '所选词应标为熟练');
  const profRaw = b.storage.get(b.profKey());
  assert.ok(profRaw, '独立熟练键已写入');
  assert.equal(Object.keys(JSON.parse(profRaw)).length, 40);
  assert.equal(box.hidden, true, '确认后预览关闭');
  assert.equal(JSON.stringify(b.S.progress), before.progress, '批量熟练不改学习进度');
  assert.equal(JSON.stringify(b.S.days), before.days, '批量熟练不改当日学习计数（渲染可能补空记录）');
  // 熟练词必须移出队列（这是 setProficient 语义），但队列不新增词、当前卡/qi 不推进。
  for (const i of picks) assert.ok(!b.T.Q.includes(i), '熟练词应移出队列：' + i);
  assert.ok(b.T.Q.every(k => beforeQ.includes(k)), '队列不引入新词');
  assert.equal(b.T.cur, before.cur);
  assert.equal(b.T.qi, before.qi);
  assert.equal(JSON.stringify(b.S.reviewDay || null), before.reviewDay);
  assert.match(b.query('#toast').textContent, /已标为熟练 40 词/);
  // 已移出默认筛选：切到「熟练」筛选可看到并批量取消（整理模式保持）
  setFilter(b, {fst: 'proficient'});
  assert.equal(b.T.getFilterIndices().length, 40);
  assert.equal(b.T.isListOrganize(), true, '切换筛选后整理模式保持');
  assert.equal(b.query('#listOrganizeBar').hidden, false);
  selectAll(b);
  b.query('#btnBatchUnproficient').click();
  assert.match(b.query('#listBatchPreviewText').textContent, /恢复背诵\/复习安排/);
  b.query('#btnBatchConfirm').click();
  assert.equal(Object.keys(b.S.proficient).length, 0, '取消熟练恢复名单');
  assert.equal(JSON.parse(b.storage.get(b.profKey())).constructor, Object, '熟练键仍是合法 JSON 对象');
});

test('批量熟练包含当前学习词时按正式语义跳到下一张，但不写判定/进度', () => {
  const b = browser();
  const T = b.T, S = b.S, W = T.getW();
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: []});
  T.startSession();
  assert.notEqual(T.cur, null, '夹具应有当前卡');
  const cur = T.cur, curWord = W[cur].w;
  T.show('list');
  setFilter(b, {q: curWord, fst: 'all', fsc: 'all'});
  const target = T.getFilterIndices().find(i => i === cur);
  assert.ok(target !== undefined, '当前词应出现在搜索筛选结果中');
  enterOrganize(b);
  const targetCheck = b.query('[data-row-check="' + target + '"]');
  assert.ok(targetCheck, '当前词行应已渲染');
  targetCheck.click();
  assert.deepEqual(Array.from(T.getListSelection()), [target]);
  b.query('#btnBatchProficient').click();
  assert.match(b.query('#listBatchPreviewText').textContent, /当前正在学习的词/);
  const progressBefore = JSON.stringify(S.progress), daysBefore = JSON.stringify(S.days);
  const oldCur = T.cur;
  b.query('#btnBatchConfirm').click();
  assert.ok(T.isProficient(target));
  assert.ok(Object.prototype.hasOwnProperty.call(S.proficient, curWord));
  assert.notEqual(T.cur, oldCur, '当前卡被移出队列后前进到下一张');
  assert.equal(JSON.stringify(S.progress), progressBefore, '不写学习进度');
  assert.equal(JSON.stringify(S.days), daysBefore, '不写学习天数/判定计数');
});

test('批量熟练保存失败时整次回滚内存与队列，并提示重试', () => {
  const b = browser();
  seedWrong(b, 5);
  b.T.show('list');
  setFilter(b, {fst: 'wrong'});
  enterOrganize(b);
  selectAll(b);
  const queue = JSON.stringify(b.T.Q), qi = b.T.qi;
  b.query('#btnBatchProficient').click();
  b.state.failStorage = true;
  b.query('#btnBatchConfirm').click();
  assert.equal(Object.keys(b.S.proficient).length, 0, '失败后熟练名单回滚');
  assert.equal(JSON.stringify(b.T.Q), queue, '失败后队列回滚');
  assert.equal(b.T.qi, qi);
  assert.equal(b.storage.has(b.profKey()) && JSON.parse(b.storage.get(b.profKey())).constructor === Object
    ? Object.keys(JSON.parse(b.storage.get(b.profKey()))).length : 0, 0, '独立熟练键不留下半写名单');
  assert.equal(b.query('#appAlert').hidden, false);
  assert.match(b.query('#toast').textContent, /已恢复原状态/);
  b.state.failStorage = false;
  b.query('#btnBatchProficient').click();
  b.query('#btnBatchConfirm').click();
  assert.equal(Object.keys(b.S.proficient).length, 5, '重试成功');
});

// ===========================================================================
// 保存筛选视图：保存/应用/重命名/删除/上限/校验/损坏拒写/按书隔离
// ===========================================================================
test('保存当前筛选视图并应用：只改列表筛选，不动学习设置/队列/当前卡', () => {
  const b = browser();
  seedWrong(b, 7);
  b.T.show('list');
  setFilter(b, {fst: 'wrong', fsc: 'scope'});
  const count = b.query('#listCount').textContent;
  const settings = JSON.stringify(b.S.settings), queue = JSON.stringify(b.T.Q), cur = b.T.cur;
  b.query('#listViewName').value = '本周错词';
  b.query('#btnSaveListView').click();
  const store = parsedViews(b);
  assert.ok(store, '视图键已写入');
  assert.equal(store.kind, 'vocab-list-views');
  assert.equal(store.version, 1);
  assert.equal(store.views.length, 1);
  assert.equal(store.views[0].book, 'kaoyan');
  assert.equal(store.views[0].name, '本周错词');
  assert.equal(store.views[0].fst, 'wrong');
  assert.equal(store.views[0].fsc, 'scope');
  assert.equal(b.query('#listViewName').value, '', '保存后清空名称输入');
  assert.match(b.query('#listViewsStatus').textContent, /已保存视图「本周错词」/);
  assert.equal(b.T.getListViewState().views.filter(v => v.book === 'kaoyan').length, 1);
  // 改成别的筛选后再应用视图
  setFilter(b, {q: b.T.getW()[0].w, fst: 'all', fsc: 'all'});
  assert.notEqual(b.query('#listCount').textContent, count);
  b.query('#listScroll').scrollTop = 520;
  b.query('[data-view-apply]').click();
  assert.equal(b.query('#fst').value, 'wrong');
  assert.equal(b.query('#fsc').value, 'scope');
  assert.equal(b.query('#q').value, '');
  assert.equal(b.query('#listCount').textContent, count, '应用后筛选结果恢复');
  assert.equal(b.query('#listScroll').scrollTop, 0, '应用视图回到顶部');
  assert.equal(b.T.getListActiveWord(), b.T.getFilterIndices()[0], '活动行回到首行');
  assert.equal(JSON.stringify(b.S.settings), settings);
  assert.equal(JSON.stringify(b.T.Q), queue);
  assert.equal(b.T.cur, cur);
  assert.ok(b.T.getFilterIndices().length > 0);
});

test('视图重命名与删除只改独立视图键', () => {
  const b = browser();
  b.T.show('list');
  b.query('#listViewName').value = '旧名字';
  b.query('#btnSaveListView').click();
  b.query('[data-view-rename-input]').value = '新名字';
  b.query('[data-view-rename]').click();
  assert.equal(parsedViews(b).views[0].name, '新名字');
  assert.match(b.query('#listViewsStatus').textContent, /已重命名/);
  b.query('[data-view-delete]').click();
  assert.equal(parsedViews(b).views.length, 0);
  assert.match(b.query('#listViewsStatus').textContent, /已删除视图/);
});

test('视图名称 1–30 字、同名拒绝；每书最多 12 个', () => {
  const b = browser();
  b.T.show('list');
  b.query('#btnSaveListView').click();
  assert.match(b.query('#listViewsStatus').textContent, /1–30/);
  assert.equal(parsedViews(b), null, '空名称不写入');
  b.query('#listViewName').value = 'x'.repeat(31);
  b.query('#btnSaveListView').click();
  assert.match(b.query('#listViewsStatus').textContent, /最多 30 字/);
  b.query('#listViewName').value = '重复名';
  b.query('#btnSaveListView').click();
  assert.equal(parsedViews(b).views.length, 1);
  b.query('#listViewName').value = '重复名';
  b.query('#btnSaveListView').click();
  assert.match(b.query('#listViewsStatus').textContent, /同名/);
  assert.equal(parsedViews(b).views.length, 1);
  for (let n = 2; n <= 12; n++) {
    b.query('#listViewName').value = '视图' + n;
    b.query('#btnSaveListView').click();
  }
  assert.equal(parsedViews(b).views.length, 12);
  b.query('#listViewName').value = '视图13';
  b.query('#btnSaveListView').click();
  assert.match(b.query('#listViewsStatus').textContent, /最多保存 12 个/);
  assert.equal(parsedViews(b).views.length, 12);
});

test('损坏的视图存储保留原文并拒绝覆写；显式重置后恢复', () => {
  for (const bad of ['not-json', JSON.stringify({kind: 'x', version: 1, views: []}),
    JSON.stringify({kind: 'vocab-list-views', version: 1, views: [{id: 'a', book: 'kaoyan', name: '', q: '', fst: 'all', fsc: 'scope'}]})]) {
    const b = browser({prefill: {[LIST_VIEWS_KEY]: bad}});
    b.T.show('list');
    const st = b.T.getListViewState();
    assert.equal(st.corrupt, true, '应识别损坏：' + bad.slice(0, 40));
    assert.equal(b.storage.get(LIST_VIEWS_KEY), bad, '损坏原文必须原样保留');
    assert.match(b.query('#listViewsStatus').textContent, /已损坏|保留原文/);
    assert.equal(b.query('#btnResetListViews').hidden, false);
    // 尝试保存/重命名/删除都不能覆写原文
    b.query('#listViewName').value = '尝试';
    b.query('#btnSaveListView').click();
    assert.equal(b.storage.get(LIST_VIEWS_KEY), bad, '损坏时保存被拒绝');
    b.query('#btnResetListViews').click();
    assert.equal(b.T.getListViewState().corrupt, false, '重置后恢复可用');
    assert.equal(b.storage.has(LIST_VIEWS_KEY), false, '重置移除损坏原文');
    b.query('#listViewName').value = '恢复后';
    b.query('#btnSaveListView').click();
    assert.equal(parsedViews(b).views.length, 1);
  }
});

test('视图按词书隔离：只显示并应用当前书的视图，切书后互不覆盖', () => {
  const b = browser({multiBook: true});
  b.T.show('list');
  b.query('#listViewName').value = '考研视图';
  b.query('#btnSaveListView').click();
  b.T.switchBook('cet4');
  b.T.show('list');
  assert.equal(b.query('#listViewsList').textContent.includes('考研视图'), false, '不显示其他书的视图');
  b.query('#listViewName').value = '四级视图';
  b.query('#btnSaveListView').click();
  assert.equal(b.T.getListViewState().views.filter(v => v.book === 'cet4').length, 1);
  b.T.switchBook('kaoyan');
  b.T.show('list');
  assert.equal(b.query('#listViewsList').textContent.includes('考研视图'), true);
  assert.equal(b.query('#listViewsList').textContent.includes('四级视图'), false);
  b.query('[data-view-apply]').click();
  assert.match(b.query('#toast').textContent, /已应用视图：考研视图/);
});

test('批量整理与视图应用不写学习进度/天数/时长，导出沿用当前筛选', () => {
  const b = browser();
  const picks = seedWrong(b, 6);
  b.T.show('list');
  setFilter(b, {fst: 'wrong'});
  const before = {
    progress: JSON.stringify(b.S.progress), days: JSON.stringify(b.S.days),
    timeSec: b.S.timeSec, extraDay: JSON.stringify(b.S.extraDay || null),
    reviewDay: JSON.stringify(b.S.reviewDay || null)
  };
  enterOrganize(b);
  selectAll(b);
  b.query('#btnBatchStar').click();
  const txt = b.T.wordBookTxt('filter');
  const words = txt.trimEnd().split('\n');
  assert.equal(words.length, 6, '筛选导出仍是当前筛选结果');
  for (const i of picks) assert.ok(words.includes(b.T.getW()[i].w));
  assert.equal(b.T.printBookEntries('filter').length, 6, '打印生词本沿用当前筛选');
  assert.equal(JSON.stringify(b.S.progress), before.progress);
  assert.equal(JSON.stringify(b.S.days), before.days);
  assert.equal(b.S.timeSec, before.timeSec);
  assert.equal(JSON.stringify(b.S.extraDay || null), before.extraDay);
  assert.equal(JSON.stringify(b.S.reviewDay || null), before.reviewDay);
  b.query('#listViewName').value = '错词6';
  b.query('#btnSaveListView').click();
  setFilter(b, {fst: 'all'});
  b.query('[data-view-apply]').click();
  assert.equal(b.T.wordBookTxt('filter').trimEnd().split('\n').length, 6);
});

test('保存视图名称的输入确认不提前落盘，正常Enter仍保存', () => {
  const b=browser();b.T.show('list');const input=b.query('#listViewName');
  for(const [i,opts] of [{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'},{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true}].entries()) {
    input.value='候选未确认'+i;input.focus();const event=b.key('Enter',opts);
    assert.equal(b.storage.has(LIST_VIEWS_KEY),false,'输入确认或长按不能创建视图');
    assert.equal(event.defaultPrevented,false);assert.equal(b.doc.activeElement,input);
  }
  input.value='正常确认';input.focus();assert.equal(b.key('Enter').defaultPrevented,true);
  assert.equal(parsedViews(b).views.length,1);assert.equal(parsedViews(b).views[0].name,'正常确认');
});

test('重命名视图的输入确认不提前落盘，正常Enter仍提交', () => {
  const b=browser();b.T.show('list');b.query('#listViewName').value='原视图';b.query('#btnSaveListView').click();
  let input=b.query('[data-view-rename-input]');assert.ok(input);
  const before=b.storage.get(LIST_VIEWS_KEY);
  for(const [i,opts] of [{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'},{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true}].entries()) {
    input.value='候选未确认'+i;input.focus();const event=b.key('Enter',opts);
    assert.equal(b.storage.get(LIST_VIEWS_KEY),before,'输入确认或长按不能重命名');
    assert.equal(event.defaultPrevented,false);assert.equal(b.doc.activeElement,input);
  }
  input.value='正常更名';input.focus();assert.equal(b.key('Enter').defaultPrevented,true);
  assert.equal(parsedViews(b).views[0].name,'正常更名');
});

test('整理模式在单词、选择、熟练之间始终保留唯一Tab停靠点', () => {
  const b=browser();b.T.show('list');enterOrganize(b);b.rowWords()[0].focus();
  for(const [key,attr] of [['ArrowRight','data-row-check'],['ArrowRight','data-proficient'],['ArrowLeft','data-row-check'],['ArrowLeft','data-open-word'],['ArrowDown','data-open-word']]) {
    b.key(key);assert.notEqual(b.doc.activeElement.getAttribute(attr),null,attr);
    const stops=b.all('#listInner [tabindex="0"]');assert.equal(stops.length,1,'虚拟列表需恰一个Tab入口');
    assert.equal(stops[0],b.doc.activeElement,'当前活动操作可重新Tab进入');
  }
});

test('词表方向键不拦截浏览器组合或输入法，裸键及长按仍逐行导航', () => {
  const b=browser();b.T.show('list');b.rowWords()[0].focus();
  for(const opts of [{altKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'}]) {
    const before=b.doc.activeElement;const event=b.key('ArrowRight',opts);
    assert.equal(event.defaultPrevented,false,'组合键/输入法保留原行为');assert.equal(b.doc.activeElement,before);
  }
  const first=+b.doc.activeElement.dataset.openWord;
  assert.equal(b.key('ArrowDown',{repeat:true}).defaultPrevented,true,'长按方向仍可导航');
  assert.notEqual(+b.doc.activeElement.dataset.openWord,first);
});

test('统计图表方向键不截获浏览器修饰组合或输入法，裸键长按仍选相邻点', () => {
  const b=browser();b.T.show('stats');const first=b.query('#forecast [data-fc-label]');assert.ok(first);first.focus();
  for(const opts of [{altKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'}]) {
    const event=b.key('ArrowRight',opts);assert.equal(event.defaultPrevented,false);assert.equal(b.doc.activeElement,first);
  }
  assert.equal(b.key('ArrowRight',{repeat:true}).defaultPrevented,true);assert.notEqual(b.doc.activeElement,first);
});

console.log(`\nE 词表整理回归：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
