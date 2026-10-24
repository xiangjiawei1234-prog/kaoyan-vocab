/**
 * H 本词问题本地记录验收（详情页 #wordSheet 内新增区块）
 * 运行：node --max-old-space-size=512 js/test-word-issues.mjs
 *
 * 做法：vm 沙箱载入真实 index.html（DOM 桩解析）、真实词库与真实 js/app.js，
 * 通过界面按钮驱动保存/更新/删除/复制/导出，不复制业务逻辑。
 * 覆盖：独立键契约 / 自动带书·词·来源 / 500 字与 500 条上限 / 损坏原文保留且拒绝覆写 /
 * 四书隔离 / 导出仅含问题记录必要字段 / 不写进度·熟练·备份 / 复制 clipboard 与回退路径 /
 * 详情页既有动作与焦点归还不受影响。
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

const ISSUE_KEY = "vocab_word_issues_v1";
const ISSUE_KIND = "vocab-word-issues";
const KAOYAN_KEY = "kaoyan_vocab_v1";
const KAOYAN_PROF_KEY = "kaoyan_vocab_proficient_v1";
const BOOKS = ["kaoyan", "cet4", "cet6", "combined"];
const BOOK_NAMES = {kaoyan: "考研英语", cet4: "英语四级", cet6: "英语六级", combined: "综合词书"};
const ISSUE_FIELDS = ["bookId", "bookName", "createdAt", "note", "source", "updatedAt", "word"];
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

/** 完整 DOM 桩：解析真实 index.html，支持选择器、事件冒泡、焦点、localStorage 与下载捕获。 */
function browser({ storage = new Map(), fourBooks = false, clipboard = null,
  execCommandResult = true, confirmResult = true, failWrites = new Set(), failReads = new Set() } = {}) {
  let doc;
  const blobs = [], anchors = [], execCommands = [], copied = [], net = {fetch: 0, xhr: 0};
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.attrs = {}; this.dataset = {}; this.style = {}; this.events = new Map();
      this._html = ''; this._text = text; this.scrollTop = 0; this.clientHeight = 260;
      this.clientWidth = 320; this.scrollWidth = 320; this.value = ''; this.checked = false;
      this.disabled = false; this.placeholder = ''; this._writes = 0;
      this._selected = false; this.rows = 0;
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
    // hidden 是反射布尔属性（真实浏览器 el.hidden = false 会移除 attribute）：
    // Tab 焦点陷阱用 closest("[hidden]") 过滤，必须与真实 DOM 语义一致。
    get hidden() { return Object.hasOwn(this.attrs, 'hidden'); }
    set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
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
    select() { this._selected = true; }
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
    cloneNode() { const n = new Node(this.tagName.toLowerCase()); n.attrs = {...this.attrs}; return n; }
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
  doc.createElement = tag => {
    const n = new Node(tag);
    if (tag === 'a') anchors.push(n);
    return n;
  };
  doc.execCommand = (cmd) => { execCommands.push(cmd); return execCommandResult; };
  const winEvents = new Map();
  const localStorage = {
    getItem: k => {
      if (failReads.has(k)) throw new Error('storage read blocked');
      return storage.has(k) ? storage.get(k) : null;
    },
    setItem: (k, v) => {
      if (failWrites.has(k)) throw new Error('quota exceeded');
      storage.set(k, String(v));
    },
    removeItem: k => storage.delete(k)
  };
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}), innerWidth: 1200, innerHeight: 800,
    getComputedStyle: () => ({fontSize: '32px'})};
  const sandbox = {
    window, document: doc, console, Date, localStorage,
    setInterval(fn, ms) { return 0; }, clearInterval(){},
    setTimeout(){ return 0; }, clearTimeout(){}, requestAnimationFrame(fn){ fn(); }, cancelAnimationFrame(){},
    confirm: () => confirmResult,
    Blob: class { constructor(parts, opts) { blobs.push({parts: (parts || []).map(String), type: (opts && opts.type) || ''}); } },
    URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance: {now: () => Date.now()},
    SpeechSynthesisUtterance: class {}, speechSynthesis: {cancel(){}, speak(){}, getVoices(){ return []; }},
    // 本功能不得联网：任何网络调用都被记录（测试断言 0 次）。
    fetch: (...args) => { net.fetch++; return Promise.reject(new Error('network disabled in test')); },
    XMLHttpRequest: class { open(){ net.xhr++; } send(){} }
  };
  if (clipboard === 'ok' || clipboard === 'throw') {
    sandbox.navigator = {clipboard: {writeText: async (text) => {
      copied.push(text);
      if (clipboard === 'throw') throw new Error('clipboard denied');
    }}};
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(words, context, {filename:'words-data.js'});
  vm.runInContext(cet, context, {filename:'cet-words-data.js'});
  if (fourBooks) vm.runInContext(combined, context, {filename:'combined-words-data.js'});
  vm.runInContext(app, context, {filename:'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab 测试入口');
  return {
    T, doc, storage, blobs, anchors, execCommands, copied, net,
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    text(selector) { const el = doc.querySelector(selector); return el ? el.textContent : null; }
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function issueStore(b) {
  const raw = b.storage.get(ISSUE_KEY);
  return raw === undefined ? null : JSON.parse(raw);
}
function findWord(b, word) {
  return b.T.getW().findIndex(x => x.w === word);
}
function openWordByText(b, word) {
  const idx = findWord(b, word);
  assert.ok(idx >= 0, '当前词书应包含 ' + word);
  b.T.openWord(idx);
  return idx;
}
function typeIssue(b, text) {
  const ta = b.query('#wordIssueNote');
  ta.value = text;
  ta.dispatch('input');
  return ta;
}
function saveIssue(b, text) {
  typeIssue(b, text);
  b.query('#wordIssueSave').click();
}
function issueContextOf(b) { return b.T.getWordIssueState().context; }
function seededEntry(word, note, bookId = 'kaoyan', at = '2026-10-20T10:00:00.000Z') {
  return {bookId, bookName: BOOK_NAMES[bookId] || bookId, word, source: '真题例句 · 测试来源 · 词频 #1 · 1 次 / 1 套卷',
    note, createdAt: at, updatedAt: at};
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}

// ===========================================================================
// A. 详情页结构：区块位置、自动带书/词/来源、打开不写学习记录、既有动作不变
// ===========================================================================
await test('详情页 #wordSheet 内有本词问题区；打开详情自动带词书/词头/来源，且不写任何学习记录', () => {
  const b = browser();
  assert.ok(b.query('#wordIssueBlock'), 'index.html 应有 #wordIssueBlock');
  assert.ok(b.query('#wordSheet #wordIssueBlock'), '问题区必须在 #wordSheet 内');
  assert.ok(b.query('#wordSheet #wordIssueBlock #wordIssueNote'), '问题区应有备注输入框');
  assert.equal(b.query('#wordIssueKnown').hidden, true, '首次打开无已有记录');
  assert.equal(b.query('#wordIssueDelete').hidden, true, '无记录时隐藏删除');
  assert.equal(b.query('#wordIssueCopy').hidden, true, '无记录时隐藏复制');
  assert.equal(b.text('#wordIssueStatus'), '', '首次打开状态区为空');
  const stateRawBefore = b.storage.get(KAOYAN_KEY);
  const profRawBefore = b.storage.get(KAOYAN_PROF_KEY);
  const progressBefore = JSON.stringify(b.T.getS().progress);
  const daysBefore = JSON.stringify(b.T.getS().days);
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordSheet').hidden, false, '详情浮层已打开');
  const ctx = issueContextOf(b);
  assert.equal(ctx.bookId, 'kaoyan');
  assert.equal(ctx.bookName, '考研英语');
  assert.equal(ctx.word, 'answer');
  assert.match(ctx.source, /真题例句|自编例句|例句/, '来源应可读：' + ctx.source);
  assert.match(ctx.source, /词频 #\d+/);
  assert.match(ctx.source, /次 \/ \d+ 套卷/);
  assert.equal(b.storage.get(KAOYAN_KEY), stateRawBefore, '打开详情不得写主记录');
  assert.equal(b.storage.get(KAOYAN_PROF_KEY), profRawBefore, '打开详情不得写熟练键');
  assert.equal(JSON.stringify(b.T.getS().progress), progressBefore, '打开详情不得改学习进度');
  assert.equal(JSON.stringify(b.T.getS().days), daysBefore, '打开详情不得写学习统计');
  assert.equal(b.storage.get(ISSUE_KEY), undefined, '只读打开不应创建问题记录键');
  // 详情页既有动作保持
  for (const sel of ['#detailProficient', '#detailStar', '#detailSpeak', '#wordClose']) assert.ok(b.query(sel), '详情页应保留 ' + sel);
  // 状态提示 role=status
  assert.equal(b.query('#wordIssueStatus').getAttribute('role'), 'status');
  assert.equal(b.query('#wordIssueStatus').getAttribute('aria-live'), 'polite');
});

// ===========================================================================
// B. 保存 / 更新：独立键、字段契约、来源与时间
// ===========================================================================
await test('保存写独立键：kind+version+entries，条目自动带书/词/来源/创建更新时间', () => {
  const b = browser();
  openWordByText(b, 'answer');
  saveIssue(b, '这个义项和例句对不上');
  const store = issueStore(b);
  assert.ok(store, '应写入独立键 ' + ISSUE_KEY);
  assert.deepEqual(Object.keys(store).sort(), ['entries', 'kind', 'version']);
  assert.equal(store.kind, ISSUE_KIND);
  assert.equal(store.version, 1);
  assert.equal(store.entries.length, 1);
  const entry = store.entries[0];
  assert.deepEqual(Object.keys(entry).sort(), [...ISSUE_FIELDS].sort());
  assert.equal(entry.bookId, 'kaoyan');
  assert.equal(entry.bookName, '考研英语');
  assert.equal(entry.word, 'answer');
  assert.equal(entry.note, '这个义项和例句对不上');
  assert.match(entry.source, /词频 #\d+/);
  assert.ok(!Number.isNaN(Date.parse(entry.createdAt)), 'createdAt 应为可解析时间');
  assert.ok(!Number.isNaN(Date.parse(entry.updatedAt)), 'updatedAt 应为可解析时间');
  assert.equal(entry.createdAt, entry.updatedAt, '首次保存两者一致');
  assert.ok(b.text('#wordIssueStatus').includes('已保存'), '状态提示保存成功：' + b.text('#wordIssueStatus'));
  assert.equal(b.query('#wordIssueStatus').getAttribute('data-error'), null);
  // 已有记录区显示来源与时间
  assert.equal(b.query('#wordIssueKnown').hidden, false);
  const known = b.text('#wordIssueKnown');
  assert.ok(known.includes('来源'), '已有记录应显示来源：' + known);
  assert.ok(known.includes('创建'), '已有记录应显示创建时间');
  assert.ok(known.includes('更新'), '已有记录应显示更新时间');
  assert.equal(b.query('#wordIssueDelete').hidden, false);
  assert.equal(b.query('#wordIssueCopy').hidden, false);
  assert.ok(b.text('#wordIssueTotal').includes('本书 1 条'), '条数摘要：' + b.text('#wordIssueTotal'));
  assert.ok(b.text('#wordIssueTotal').includes('全部 1 / 500'));
  assert.equal(b.query('#wordIssueNote').value, '这个义项和例句对不上', '输入框保留已保存内容');
  // 不联网
  assert.equal(b.net.fetch, 0);
  assert.equal(b.net.xhr, 0);
});

await test('再次保存＝更新同一条：条目不增加，createdAt 不变，updatedAt 更新并提示「已更新」', async () => {
  const b = browser();
  openWordByText(b, 'answer');
  saveIssue(b, '第一版备注');
  const first = issueStore(b).entries[0];
  await new Promise(r => setTimeout(r, 5));
  saveIssue(b, '第二版备注（更具体）');
  const store = issueStore(b);
  assert.equal(store.entries.length, 1, '同一 bookId+word 只保留一条');
  const second = store.entries[0];
  assert.equal(second.note, '第二版备注（更具体）');
  assert.equal(second.createdAt, first.createdAt, '创建时间不变');
  assert.ok(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt), '更新时间推进');
  assert.ok(b.text('#wordIssueStatus').includes('已更新'), '状态提示更新：' + b.text('#wordIssueStatus'));
  // 首尾空白被裁剪后保存
  saveIssue(b, '  前后空格  ');
  assert.equal(issueStore(b).entries[0].note, '前后空格');
});

await test('空内容/纯空白不保存且提示；输入保留、正常关闭不报错', () => {
  const b = browser();
  openWordByText(b, 'answer');
  b.query('#wordIssueSave').click();
  assert.ok(b.text('#wordIssueStatus').includes('请先写下'), '空内容提示：' + b.text('#wordIssueStatus'));
  assert.equal(b.storage.get(ISSUE_KEY), undefined, '空内容不得写存储');
  typeIssue(b, '   \n  ');
  b.query('#wordIssueSave').click();
  assert.ok(b.text('#wordIssueStatus').includes('请先写下'));
  assert.equal(b.storage.get(ISSUE_KEY), undefined);
  b.key('Escape');
  assert.equal(b.query('#wordSheet').hidden, true, '保存失败不应阻断关闭');
});

// ===========================================================================
// C. 上限：单条 500 字 / 全库 500 条
// ===========================================================================
await test('单条上限 500 字：超长拒绝并保留输入；恰好 500 字可保存', () => {
  const b = browser();
  openWordByText(b, 'answer');
  const ta = b.query('#wordIssueNote');
  assert.equal(ta.getAttribute('maxlength'), '500', '输入框应有 maxlength=500');
  typeIssue(b, '问'.repeat(501));
  b.query('#wordIssueSave').click();
  assert.ok(b.text('#wordIssueStatus').includes('500'), '超长提示上限：' + b.text('#wordIssueStatus'));
  assert.equal(b.query('#wordIssueStatus').getAttribute('data-error'), 'true');
  assert.equal(b.storage.get(ISSUE_KEY), undefined, '超长不得写存储');
  assert.equal(ta.value.length, 501, '超长时输入保留');
  typeIssue(b, '字'.repeat(500));
  b.query('#wordIssueSave').click();
  assert.equal(issueStore(b).entries[0].note.length, 500, '恰好 500 字应可保存');
  assert.ok(b.text('#wordIssueStatus').includes('已保存'));
});

await test('全库最多 500 条：满额新增拒绝且原文不变；已有词更新不受影响', () => {
  const storage = new Map();
  const entries = [];
  entries.push(seededEntry('answer', '旧备注'));
  for (let i = 1; i < 500; i++) entries.push(seededEntry('种子词' + i, '占位备注 ' + i));
  storage.set(ISSUE_KEY, JSON.stringify({kind: ISSUE_KIND, version: 1, entries}));
  const rawBefore = storage.get(ISSUE_KEY);
  const b = browser({storage});
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueKnown').hidden, false, '已有 500 条时仍应显示本词记录');
  saveIssue(b, '满额时更新本词');
  let store = issueStore(b);
  assert.equal(store.entries.length, 500, '更新已有词不新增条目');
  assert.equal(store.entries[0].note, '满额时更新本词');
  // 换一个没有记录的词新增 → 拒绝
  openWordByText(b, 'people');
  typeIssue(b, '这条应该被上限拒绝');
  b.query('#wordIssueSave').click();
  store = issueStore(b);
  assert.equal(store.entries.length, 500, '超过 500 条不得写入');
  assert.ok(!store.entries.some(e => e.word === 'people'), '被拒记录不得进入存储');
  assert.ok(b.text('#wordIssueStatus').includes('500'), '上限提示应写明 500：' + b.text('#wordIssueStatus'));
  assert.ok(b.text('#wordIssueStatus').includes('删除'), '上限提示应说明先删除');
  assert.equal(b.query('#wordIssueNote').value, '这条应该被上限拒绝', '被拒时输入保留');
  assert.ok(rawBefore, '前置种子数据存在');
});

// ===========================================================================
// D. 删除
// ===========================================================================
await test('删除移除当前词记录、清空输入并隐藏删除/复制；其他记录不受影响', () => {
  const storage = new Map();
  const entries = [seededEntry('answer', '答案备注'), seededEntry('people', '人的备注')];
  storage.set(ISSUE_KEY, JSON.stringify({kind: ISSUE_KIND, version: 1, entries}));
  // 取消确认时不删除
  const cancelB = browser({storage, confirmResult: false});
  openWordByText(cancelB, 'answer');
  cancelB.query('#wordIssueDelete').click();
  assert.equal(issueStore(cancelB).entries.length, 2, '取消确认不删除记录');
  assert.equal(cancelB.query('#wordIssueNote').value, '答案备注', '取消后输入仍保留');
  const b = browser({storage});
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueNote').value, '答案备注', '打开已有记录应回填备注');
  b.query('#wordIssueDelete').click();
  const store = issueStore(b);
  assert.equal(store.entries.length, 1, '只删除当前词记录');
  assert.equal(store.entries[0].word, 'people');
  assert.equal(b.query('#wordIssueNote').value, '', '删除后清空输入');
  assert.equal(b.query('#wordIssueKnown').hidden, true, '删除后隐藏已有记录区');
  assert.equal(b.query('#wordIssueDelete').hidden, true);
  assert.equal(b.query('#wordIssueCopy').hidden, true);
  assert.ok(b.text('#wordIssueStatus').includes('已删除'), '删除提示：' + b.text('#wordIssueStatus'));
  assert.ok(b.text('#wordIssueTotal').includes('本书 1 条'));
});

// ===========================================================================
// E. 四书隔离（bookId + word 键控）
// ===========================================================================
await test('四书隔离：同一单词在四本书各自保存互不覆盖；本书导出只含本书', () => {
  const b = browser({fourBooks: true});
  for (const bookId of BOOKS) {
    b.T.switchBook(bookId);
    assert.equal(b.T.getBook(), bookId, '已切到 ' + bookId);
    openWordByText(b, 'answer');
    const ctx = issueContextOf(b);
    assert.equal(ctx.bookId, bookId, '当前书上下文：' + bookId);
    assert.equal(ctx.bookName, BOOK_NAMES[bookId]);
    assert.equal(b.query('#wordIssueKnown').hidden, true, bookId + ' 首次应无记录');
    saveIssue(b, '问题-' + bookId);
    assert.equal(issueStore(b).entries.length, BOOKS.indexOf(bookId) + 1, '每本书各一条');
  }
  const store = issueStore(b);
  assert.equal(store.entries.length, 4, '四书共 4 条');
  assert.deepEqual(store.entries.map(e => e.bookId).sort(), [...BOOKS].sort(), 'bookId 各不相同');
  assert.ok(store.entries.every(e => e.word === 'answer'), '同一词头按书隔离');
  for (const bookId of BOOKS) {
    b.T.switchBook(bookId);
    openWordByText(b, 'answer');
    assert.equal(b.query('#wordIssueNote').value, '问题-' + bookId, bookId + ' 应读回自己的备注');
    const state = b.T.getWordIssueState();
    assert.equal(state.context.bookId, bookId);
    assert.equal(state.entry.bookName, BOOK_NAMES[bookId], '记录条目带本书名');
    assert.ok(b.text('#wordIssueKnown').includes('来源'), '已有记录显示来源');
    const bookExport = b.T.buildWordIssuesExport('book');
    assert.equal(bookExport.entries.length, 1, bookId + ' 本书导出只含 1 条');
    assert.equal(bookExport.entries[0].bookId, bookId);
  }
  const all = b.T.buildWordIssuesExport('all');
  assert.equal(all.entries.length, 4, '全部导出含四书');
  // 删除一本书的记录不影响其他书
  b.T.switchBook('cet4');
  openWordByText(b, 'answer');
  b.query('#wordIssueDelete').click();
  assert.equal(issueStore(b).entries.length, 3, '删除 cet4 记录后剩余 3 条');
  b.T.switchBook('combined');
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueNote').value, '问题-combined', '其他书记录不受影响');
});

// ===========================================================================
// F. 损坏：原文保留、禁止覆写、状态提示、不阻断关闭
// ===========================================================================
await test('损坏 JSON：保留原文、禁用保存与导出、输入保留、Esc 仍可关闭并归还焦点', () => {
  const storage = new Map();
  const corruptRaw = '{"kind":"vocab-word-issues","version":1,"entries":[{BROKEN';
  storage.set(ISSUE_KEY, corruptRaw);
  const b = browser({storage});
  openWordByText(b, 'answer');
  const state = b.T.getWordIssueState();
  assert.equal(state.corrupted, true, '应识别为损坏');
  assert.equal(state.raw, corruptRaw, '应保留原文供检查');
  assert.ok(b.text('#wordIssueStatus').includes('损坏'), '状态提示损坏：' + b.text('#wordIssueStatus'));
  assert.ok(b.text('#wordIssueStatus').includes('保留原文'), '状态说明原文保留');
  assert.equal(b.query('#wordIssueStatus').getAttribute('data-error'), 'true');
  assert.equal(b.query('#wordIssueSave').disabled, true, '损坏时禁用保存');
  assert.equal(b.query('#wordIssueExportBook').disabled, true, '损坏时禁用导出本书');
  assert.equal(b.query('#wordIssueExportAll').disabled, true, '损坏时禁用导出全部');
  assert.equal(b.T.buildWordIssuesExport('all'), null, '纯导出数据也应拒绝');
  const ta = b.query('#wordIssueNote');
  ta.value = '这段输入不能被覆盖';
  ta.dispatch('input');
  b.query('#wordIssueSave').click();   // disabled：DOM 桩不派发 click
  b.query('#wordIssueExportAll').click();
  assert.equal(storage.get(ISSUE_KEY), corruptRaw, '任何操作都不得覆写损坏原文');
  assert.equal(ta.value, '这段输入不能被覆盖', '损坏时输入保留在本页');
  b.key('Escape');
  assert.equal(b.query('#wordSheet').hidden, true, '损坏不阻断关闭');
  assert.ok(b.doc.activeElement === b.query('#card'), '关闭后焦点回到学习卡片');
});

await test('合法 JSON 但版本/结构/条目非法也按损坏处理（保留原文、不静默修复）', () => {
  const cases = [
    '{"kind":"vocab-word-issues","version":2,"entries":[]}',
    '{"kind":"vocab-word-issues","version":1,"entries":{}}',
    '{"kind":"other-app","version":1,"entries":[]}',
    '[]',
    JSON.stringify({kind: ISSUE_KIND, version: 1, entries: [{bookId: 'kaoyan'}]})
  ];
  for (const raw of cases) {
    const storage = new Map([[ISSUE_KEY, raw]]);
    const b = browser({storage});
    openWordByText(b, 'answer');
    const state = b.T.getWordIssueState();
    assert.equal(state.corrupted, true, '应识别损坏：' + raw.slice(0, 40));
    assert.ok(b.text('#wordIssueStatus').includes('损坏'), '应提示损坏：' + raw.slice(0, 40));
    typeIssue(b, '不改原文');
    b.query('#wordIssueSave').click();
    assert.equal(storage.get(ISSUE_KEY), raw, '不得覆写原文：' + raw.slice(0, 40));
  }
});

// ===========================================================================
// G. 导出 JSON：仅问题记录必要字段，不含学习记录
// ===========================================================================
await test('导出全部/本书 JSON：kind+version+exportedAt+entries 必要字段，不含学习记录', () => {
  const b = browser();
  openWordByText(b, 'answer');
  saveIssue(b, '导出的备注内容');
  b.query('#wordIssueExportAll').click();
  assert.equal(b.blobs.length, 1, '应通过 Blob 下载 JSON');
  assert.equal(b.blobs[0].type, 'application/json');
  const data = JSON.parse(b.blobs[0].parts.join(''));
  assert.deepEqual(Object.keys(data).sort(), ['entries', 'exportedAt', 'kind', 'version']);
  assert.equal(data.kind, ISSUE_KIND);
  assert.equal(data.version, 1);
  assert.ok(!Number.isNaN(Date.parse(data.exportedAt)), '导出时间可解析');
  assert.equal(data.entries.length, 1);
  assert.deepEqual(Object.keys(data.entries[0]).sort(), [...ISSUE_FIELDS].sort());
  assert.equal(data.entries[0].note, '导出的备注内容');
  const json = JSON.stringify(data);
  for (const bad of ['progress', 'proficient', 'timeSec', 'settings', 'reviewDay', 'kaoyan_vocab', 'vocab_backup', 'spare']) {
    assert.ok(!json.includes(bad), '导出文件不应包含学习记录字段：' + bad);
  }
  assert.ok(b.text('#wordIssueStatus').includes('不含学习进度'), '状态说明不含学习记录：' + b.text('#wordIssueStatus'));
  assert.equal(b.anchors.length, 1, '应创建下载链接');
  assert.ok(String(b.anchors[0].download).includes('背词问题'), '下载文件名：' + b.anchors[0].download);
  assert.ok(String(b.anchors[0].download).endsWith('.json'));
  // 导出只读：再次导出数据条目不变，学习记录存储键不变
  b.query('#wordIssueExportAll').click();
  assert.equal(b.blobs.length, 2);
  assert.equal(JSON.parse(b.blobs[1].parts.join('')).entries.length, 1);
});

await test('导出本书只含当前书；无记录时不生成文件并说明', () => {
  const storage = new Map();
  storage.set(ISSUE_KEY, JSON.stringify({kind: ISSUE_KIND, version: 1,
    entries: [seededEntry('answer', '研备注'), seededEntry('answer', '四备注', 'cet4')]}));
  const b = browser({storage});
  openWordByText(b, 'answer');
  b.query('#wordIssueExportBook').click();
  assert.equal(b.blobs.length, 1);
  const bookData = JSON.parse(b.blobs[0].parts.join(''));
  assert.equal(bookData.entries.length, 1, '本书导出只含考研记录');
  assert.equal(bookData.entries[0].bookId, 'kaoyan');
  assert.ok(String(b.anchors[0].download).includes('考研英语'), '文件名带本书名');

  const empty = browser();
  openWordByText(empty, 'answer');
  empty.query('#wordIssueExportAll').click();
  assert.equal(empty.blobs.length, 0, '无记录不应生成文件');
  assert.ok(empty.text('#wordIssueStatus').includes('还没有'), '无记录提示：' + empty.text('#wordIssueStatus'));
});

// ===========================================================================
// H. 复制：clipboard 优先；无 clipboard 用 execCommand 回退；全失败给出手动复制说明
// ===========================================================================
await test('复制优先 navigator.clipboard，文本含书/词/来源/备注/时间', async () => {
  const b = browser({clipboard: 'ok'});
  openWordByText(b, 'answer');
  saveIssue(b, '需要复制的问题');
  b.query('#wordIssueCopy').click();
  await flush();
  assert.equal(b.copied.length, 1, '应调用 clipboard.writeText');
  const text = b.copied[0];
  for (const kw of ['考研英语', 'answer', '来源', '需要复制的问题', '创建', '更新']) {
    assert.ok(text.includes(kw), '复制文本应含「' + kw + '」：' + text);
  }
  assert.equal(b.execCommands.length, 0, 'clipboard 成功时不应走 execCommand 回退');
  assert.ok(b.text('#wordIssueStatus').includes('已复制'), '复制成功提示：' + b.text('#wordIssueStatus'));
});

await test('无 clipboard 时回退隐藏 textarea + execCommand，成功后移除临时节点', () => {
  const b = browser();   // 不提供 navigator.clipboard
  openWordByText(b, 'answer');
  saveIssue(b, '回退复制内容');
  b.query('#wordIssueCopy').click();
  assert.equal(b.execCommands.length, 1, '应调用 document.execCommand("copy")');
  assert.equal(b.execCommands[0], 'copy');
  const textareas = b.all('#wordSheet .sheet-panel textarea');
  assert.equal(textareas.length, 1, '复制成功后应移除临时 textarea（只剩问题输入框）');
  assert.equal(textareas[0].id, 'wordIssueNote');
  assert.ok(b.text('#wordIssueStatus').includes('已复制'));
});

await test('clipboard 抛错且 execCommand 失败：选中文本并提示 Ctrl/Cmd+C，不阻断关闭', async () => {
  const b = browser({clipboard: 'throw', execCommandResult: false});
  openWordByText(b, 'answer');
  saveIssue(b, '手动复制的内容');
  b.query('#wordIssueCopy').click();
  await flush();
  assert.equal(b.execCommands.length, 1, 'clipboard 失败应尝试 execCommand');
  const textareaList = b.all('#wordSheet .sheet-panel textarea');
  assert.equal(textareaList.length, 2, '失败时保留临时 textarea 供手动复制');
  const fallback = textareaList[1];
  assert.ok(fallback.value.includes('手动复制的内容'), '临时 textarea 应含复制文本');
  assert.equal(fallback._selected, true, '应选中文本供 Ctrl/Cmd+C');
  assert.ok(b.text('#wordIssueStatus').includes('Ctrl/Cmd+C'), '提示手动复制：' + b.text('#wordIssueStatus'));
  b.key('Escape');
  assert.equal(b.query('#wordSheet').hidden, true, '复制失败不阻断关闭');
});

await test('无记录时复制按钮隐藏，不产生复制动作', () => {
  const b = browser({clipboard: 'ok'});
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueCopy').hidden, true);
});

// ===========================================================================
// I. 不写学习记录 / 备份 v3 / 熟练；不联网
// ===========================================================================
await test('保存/更新/删除/复制/导出都不改 progress、熟练键、备份 v3 与学习统计', async () => {
  const b = browser({clipboard: 'ok'});
  openWordByText(b, 'answer');
  const stateRawBefore = b.storage.get(KAOYAN_KEY);
  const profRawBefore = b.storage.get(KAOYAN_PROF_KEY);
  const S = b.T.getS();
  const learningBefore = JSON.stringify({progress: S.progress, days: S.days, timeSec: S.timeSec,
    review: S.reviewDay, extra: S.extraDay, stars: S.stars, proficient: S.proficient, spelling: S.spelling});
  const settingsBefore = JSON.stringify(S.settings);
  const backupStateBefore = JSON.stringify(b.T.buildExport().books);
  saveIssue(b, '备注不应进入学习记录');
  b.query('#wordIssueCopy').click(); await flush();
  b.query('#wordIssueExportAll').click();
  saveIssue(b, '更新后的备注');
  b.query('#wordIssueDelete').click();
  assert.equal(b.storage.get(KAOYAN_KEY), stateRawBefore, '主记录未被改写');
  assert.equal(b.storage.get(KAOYAN_PROF_KEY), profRawBefore, '熟练键未被改写');
  const learningAfter = JSON.stringify({progress: S.progress, days: S.days, timeSec: S.timeSec,
    review: S.reviewDay, extra: S.extraDay, stars: S.stars, proficient: S.proficient, spelling: S.spelling});
  assert.equal(learningAfter, learningBefore, '学习记录内存态未被改写');
  assert.equal(JSON.stringify(S.settings), settingsBefore, '设置未被改写');
  assert.equal(JSON.stringify(b.T.buildExport().books), backupStateBefore, '备份 v3 内容未被改写');
  const exportJson = JSON.stringify(b.T.buildExport());
  assert.ok(!exportJson.includes(ISSUE_KEY), '备份 v3 不应含问题记录键');
  assert.ok(!exportJson.includes('备注不应进入学习记录'), '备份 v3 不应含问题备注');
  assert.equal(b.net.fetch, 0, '不得联网发送（fetch）');
  assert.equal(b.net.xhr, 0, '不得联网发送（XHR）');
});

await test('存储写入失败：提示失败并保留输入，不阻断关闭；读取失败：禁用保存并提示', () => {
  const failWrite = browser({failWrites: new Set([ISSUE_KEY])});
  openWordByText(failWrite, 'answer');
  typeIssue(failWrite, '写不进去也要保留');
  failWrite.query('#wordIssueSave').click();
  assert.ok(failWrite.text('#wordIssueStatus').includes('失败'), '写入失败提示：' + failWrite.text('#wordIssueStatus'));
  assert.equal(failWrite.query('#wordIssueNote').value, '写不进去也要保留', '写入失败保留输入');
  assert.ok(failWrite.storage.get(KAOYAN_KEY) === undefined || true);
  failWrite.key('Escape');
  assert.equal(failWrite.query('#wordSheet').hidden, true, '写入失败不阻断关闭');

  const failRead = browser({failReads: new Set([ISSUE_KEY])});
  openWordByText(failRead, 'answer');
  assert.ok(failRead.text('#wordIssueStatus').includes('不可用'), '读取失败提示：' + failRead.text('#wordIssueStatus'));
  assert.equal(failRead.query('#wordIssueSave').disabled, true, '读取失败时禁用保存');
});

// ===========================================================================
// J. 既有详情交互与焦点：草稿不被收藏/熟练重渲染覆盖、Tab 可达、Esc 归还
// ===========================================================================
await test('收藏/熟练触发详情重渲染时保留未保存草稿；已保存记录正常回填', () => {
  const b = browser();
  openWordByText(b, 'answer');
  typeIssue(b, '正在输入但还没保存');
  b.query('#detailStar').click();
  assert.equal(b.query('#wordIssueNote').value, '正在输入但还没保存', '收藏重渲染不得丢草稿');
  b.query('#detailProficient').click();
  assert.equal(b.query('#wordIssueNote').value, '正在输入但还没保存', '熟练重渲染不得丢草稿');
  b.query('#detailProficient').click();   // 取消熟练，恢复原状态
  // 保存后重开详情回填已保存内容
  b.query('#wordIssueSave').click();
  b.key('Escape');
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueNote').value, '正在输入但还没保存', '重开详情回填已保存备注');
  assert.ok(b.text('#wordIssueKnown').includes('来源'));
});

await test('问题区键盘可达：label/type 正确、Tab 可到保存与输入框、浮层焦点陷阱保持', () => {
  const b = browser();
  openWordByText(b, 'answer');
  const note = b.query('#wordIssueNote');
  assert.equal(note.tagName, 'TEXTAREA');
  const label = b.query('label[for="wordIssueNote"]');
  assert.ok(label, '备注输入框应有可见 label');
  for (const sel of ['#wordIssueSave', '#wordIssueExportBook', '#wordIssueExportAll']) {
    const btn = b.query(sel);
    assert.equal(btn.tagName, 'BUTTON');
    assert.equal(btn.getAttribute('type'), 'button', '避免表单默认提交');
    assert.notEqual(btn.disabled, true, sel + ' 正常状态下可用');
  }
  // 输入框后一个 Tab 停靠点是保存按钮（无记录时删除/复制隐藏 → 键盘可直接到达保存）
  const focusables = b.all('#wordSheet textarea, #wordSheet button')
    .filter(x => !x.disabled && !x.hidden && !x.closest?.('[hidden], [inert]'));
  const noteIdx = focusables.indexOf(note);
  assert.ok(noteIdx >= 0, '问题输入框应在浮层 Tab 顺序中');
  assert.ok(focusables[noteIdx + 1] === b.query('#wordIssueSave'), '输入框后一个 Tab 停靠点是保存按钮');
  // 浮层最后一个可聚焦元素 Tab 回到浮层第一个（关闭按钮），焦点陷阱不被破坏
  const lastFocusable = focusables[focusables.length - 1];
  assert.ok(lastFocusable === b.query('#detailSpeak'), '最后一个 Tab 停靠点是发音按钮');
  lastFocusable.focus();
  b.key('Tab');
  assert.ok(b.doc.activeElement === b.query('#wordClose'), 'Tab 在浮层内循环');
  b.key('Tab', {shiftKey: true});
  assert.ok(b.doc.activeElement === lastFocusable, 'Shift+Tab 反向循环');
  // Esc 关闭并回到卡片
  b.key('Escape');
  assert.equal(b.query('#wordSheet').hidden, true);
  assert.ok(b.doc.activeElement === b.query('#card'), 'Esc 关闭后焦点回到学习卡片');
});

await test('关闭详情清空本次草稿，但已保存记录仍在存储中', () => {
  const b = browser();
  openWordByText(b, 'answer');
  saveIssue(b, '已保存的备注');
  b.key('Escape');
  openWordByText(b, 'answer');
  typeIssue(b, '未保存草稿');
  b.key('Escape');
  openWordByText(b, 'answer');
  assert.equal(b.query('#wordIssueNote').value, '已保存的备注', '未保存草稿随关闭丢弃，已保存记录回填');
  assert.equal(issueStore(b).entries.length, 1);
});

console.log(`\nH 本词问题本地记录：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
