/**
 * G 统计直达词表回归：到期负荷日期柱 / 词频分层 / 阶段档 → 临时列表筛选下钻。
 * 覆盖：下钻词集与统计口径完全一致（当前范围、非熟练、pos/套卷/大纲、本地日桶）、
 * 不改学习设置/队列/当前卡、返回统计保留选中条件/展开面板/滚动、空集 disabled 并说明、
 * 不可还原的历史学习量只说明不造假词集、切书清下钻、导出沿用下钻上下文。
 * 用真实 index.html 解析出的 DOM 桩 + vm 运行真实 js/app.js。
 * 运行：node --max-old-space-size=512 js/test-stats-drill.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(ROOT, "js/words-data.js"), "utf8");
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function browser({multiBook = false} = {}) {
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
  const created = [];
  doc.createElement = tag => { const n = new Node(tag); created.push(n); return n; };
  const storage = new Map();
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener() {}, matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}),
    getComputedStyle: () => ({fontSize: '32px'}), innerWidth: 1200, innerHeight: 800};
  const context = vm.createContext({
    window, document: doc, console, Date,
    localStorage: {getItem: k => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    setInterval() { return 0; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
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
    T, doc, storage, created, S: T.getS(),
    query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
    text: s => (doc.querySelector(s) || {}).textContent || '',
    key: (key, opts = {}) => doc.activeElement.dispatch('keydown', {key, ...opts}),
    today: () => { const d = new Date(); const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name + ': ' + (e && e.stack || e)); }
}
const sorted = arr => Array.from(arr).slice().sort((a, b) => a - b);
const eqSet = (actual, expected, msg) => assert.equal(JSON.stringify(sorted(actual)), JSON.stringify(sorted(expected)), msg);
const localBucket = (t) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const due = new Date(t); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - start.getTime()) / 86400000);
};
const atDay = (offset, hour = 12) => {
  const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0); return d.getTime();
};

/** 让全部词进入范围、清空学习记录，返回可写的 S/W。 */
function seed(b) {
  const T = b.T, S = b.S, W = T.getW();
  Object.assign(S.settings, {fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], posMode: 'primary',
    order: 'freq', dailyNew: 10, groupSize: 30, backlogGuard: false});
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  T.startSession();
  return {T, S, W, now: Date.now()};
}
function setLearned(S, i, stage, dueAt, wrong = 0) {
  S.progress[i] = [stage, dueAt, stage, wrong, Date.now() - 5000];
}
/** 取 inScope 且非熟练的前 n 个下标。 */
function pickIndices(T, n) {
  const out = [];
  for (let i = 0; i < T.getW().length && out.length < n; i++) if (T.inScope(i) && !T.isProficient(i)) out.push(i);
  return out;
}
function openPanel(b, id) {
  const panel = b.query('#' + id);
  assert.ok(panel, '面板存在：' + id);
  panel.open = true;
  return panel;
}
function clickForecastBar(b, idx) {
  const bars = b.all('#forecast [data-fc-label]');
  assert.ok(bars[idx], '应渲染日期柱 ' + idx);
  bars[idx].click();
  return bars[idx];
}
function clickStageBar(b, idx) {
  const bars = b.all('#stages [data-stage-label]');
  assert.ok(bars[idx], '应渲染档位 ' + idx);
  bars[idx].click();
  return bars[idx];
}
function drillIndicesUnderCaliber(job) {
  const out = [];
  for (let i = 0; i < job.W.length; i++) {
    if (!job.T.inScope(i) || job.T.isProficient(i)) continue;
    const p = job.S.progress[i];
    if (job.kind === 'due') {
      if (!p || !(p[4] > 0) || p[0] >= 11) continue;
      const bucket = localBucket(p[1]);
      if (job.dayIndex === 0 ? bucket <= 0 : bucket === job.dayIndex) out.push(i);
    } else if (job.kind === 'stage') {
      if (!p || !(p[4] > 0)) continue;
      if (Math.min(p[0], 11) === job.stage) out.push(i);
    }
  }
  return out;
}

// ===========================================================================
// 复习负荷日期柱下钻
// ===========================================================================
test('到期日期柱：选中后出现「查看该日到期词 (N)」并进入临时下钻', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 12);
  setLearned(job.S, picks[0], 2, atDay(0, 18), 1);   // 今天稍后到期
  setLearned(job.S, picks[1], 2, atDay(-2), 1);      // 已到期
  setLearned(job.S, picks[2], 2, atDay(2), 1);
  setLearned(job.S, picks[3], 2, atDay(2, 20), 1);
  setLearned(job.S, picks[4], 2, atDay(2), 1);
  setLearned(job.S, picks[5], 2, atDay(5), 1);
  job.S.proficient[job.W[picks[6]].w] = Date.now();  // 熟练词不计
  job.S.progress[picks[7]] = [11, atDay(2), 11, 0, Date.now() - 5000]; // 已掌握不计
  const settingsBefore = JSON.stringify(job.S.settings);
  const queueBefore = JSON.stringify(job.T.Q);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  const fc = b.T.dueForecast(14);
  clickForecastBar(b, 2);
  const btn = b.query('#btnDrillDueDay');
  assert.equal(btn.disabled, false, '有词日期应可下钻');
  assert.match(btn.textContent, /到期词 \(3\)/);
  assert.match(b.query('#forecastDrillNote').textContent, /3 词/);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.query('#v-list').classList.contains('on'), true, '应跳转词表');
  assert.equal(b.query('#listDrillChip').hidden, false);
  assert.match(b.query('#listDrillSource').textContent, /统计下钻 · 本地日 .* 到期词/);
  assert.match(b.query('#listCount').textContent, /统计下钻/);
  const drilled = b.T.getStatsDrillIndices();
  eqSet(drilled, drillIndicesUnderCaliber({kind: 'due', dayIndex: 2, T: job.T, S: job.S, W: job.W}), '到期下钻词集与统计口径一致');
  assert.equal(drilled.length, fc.counts[2], '下钻数量=统计柱高');
  assert.equal(drilled.length, 3);
  assert.equal(b.T.getFilterIndices().length, 3);
  assert.equal(b.T.getStatsDrill().kind, 'due');
  assert.equal(b.T.getStatsDrill().dayIndex, 2);
  assert.equal(JSON.stringify(job.S.settings), settingsBefore, '下钻不改学习设置');
  assert.equal(JSON.stringify(job.T.Q), queueBefore, '下钻不改学习队列');
  assert.match(b.query('#listExportHint').textContent, /下钻词集/, '导出菜单说明下钻上下文');
});

test('到期今天柱包含已到期与今天稍后到期（与 dueForecast 第 0 柱同一口径）', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 6);
  setLearned(job.S, picks[0], 2, atDay(-9), 1);      // 逾期
  setLearned(job.S, picks[1], 2, atDay(0, 23), 1);   // 今天稍后
  setLearned(job.S, picks[2], 2, atDay(0), 1);       // 今天已到期
  setLearned(job.S, picks[3], 2, atDay(1), 1);
  const settingsBefore = JSON.stringify(job.S.settings), queue = JSON.stringify(job.T.Q), cur = job.T.cur;
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  const fc = b.T.dueForecast(14);
  clickForecastBar(b, 0);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.T.getFilterIndices().length, fc.counts[0]);
  assert.equal(b.T.getFilterIndices().length, 3);
  eqSet(b.T.getStatsDrillIndices(), drillIndicesUnderCaliber({kind: 'due', dayIndex: 0, T: job.T, S: job.S, W: job.W}), '第 0 柱=所有本地日桶≤今天');
  assert.equal(JSON.stringify(job.S.settings), settingsBefore, '不改学习范围设置');
  assert.equal(JSON.stringify(job.T.Q), queue, '不改学习队列');
  assert.equal(job.T.cur, cur, '不改当前卡');
});

test('返回统计保留选中柱、展开面板、滚动位置与进入前列表筛选', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 5);
  for (let k = 0; k < 5; k++) setLearned(job.S, picks[k], 2, atDay(k + 1), 1);
  // 先设置一个「用户列表筛选」并在离开列表时保存
  b.T.show('list');
  b.query('#q').value = ''; b.query('#q').dispatch('input');
  b.query('#fst').value = 'wrong'; b.query('#fst').dispatch('change');
  b.query('#fsc').value = 'all'; b.query('#fsc').dispatch('change');
  const filterBefore = {q: b.query('#q').value, fst: b.query('#fst').value, fsc: b.query('#fsc').value};
  b.T.show('stats');
  const panel = openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 2);
  const btn = b.query('#btnDrillDueDay');
  assert.equal(btn.disabled, false);
  b.query('#main').scrollTop = 640;
  btn.click();
  assert.equal(b.T.getStatsDrill() !== null, true);
  // 下钻中列表持久筛选不被覆盖：控件是中性值，但保存值仍为进入前筛选
  b.query('#btnBackToStats').click();
  assert.equal(b.T.getStatsDrill(), null, '返回后退出下钻层');
  assert.equal(b.query('#v-stats').classList.contains('on'), true, '回到统计页');
  assert.equal(panel.open, true, '展开面板保持');
  const pressed = b.all('#forecast [aria-pressed="true"]');
  assert.equal(pressed.length, 1, '选中日期柱保持选中');
  assert.equal(b.all('#forecast [data-fc-label]').indexOf(pressed[0]), 2);
  assert.equal(b.query('#main').scrollTop, 640, '恢复统计滚动位置');
  assert.equal(b.query('#btnDrillDueDay').disabled, false, '返回后按钮仍可用');
  assert.equal(b.query('#listDrillChip').hidden, true);
  // 再回词表应恢复进入前列表筛选
  b.T.show('list');
  assert.equal(b.query('#q').value, filterBefore.q);
  assert.equal(b.query('#fst').value, filterBefore.fst);
  assert.equal(b.query('#fsc').value, filterBefore.fsc);
});

test('空集：无词日期/无样本时按钮 disabled 并说明，不进入假词集', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 3);
  setLearned(job.S, picks[0], 2, atDay(1), 1);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 8);
  assert.equal(b.query('#btnDrillDueDay').disabled, true, '0 词日期不可下钻');
  assert.match(b.query('#forecastDrillNote').textContent, /没有到期词/);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.T.getStatsDrill(), null, 'disabled 按钮不产生下钻');
  assert.equal(b.query('#v-stats').classList.contains('on'), true);
  // 完全没有到期复习时面板 data-empty，下钻行整体不呈现
  job.S.progress = {};
  b.T.show('stats');
  assert.equal(b.query('#statsForecastPanel').dataset.empty, '1');
  assert.equal(b.query('#btnDrillDueDay').disabled, true);
});

// ===========================================================================
// 词频分层下钻
// ===========================================================================
test('词频层：每层「查看该层词 (N)」下钻词集与 frequencyMastery 口径一致', () => {
  const b = browser(), job = seed(b);
  const hi = [], mid = [];
  for (let i = 0; i < job.W.length && hi.length < 2; i++) if (job.T.inScope(i) && job.W[i].f >= 20) hi.push(i);
  for (let i = 0; i < job.W.length && mid.length < 2; i++) if (job.T.inScope(i) && job.W[i].f >= 5 && job.W[i].f <= 9) mid.push(i);
  setLearned(job.S, hi[0], 11, atDay(3), 0);     // 已掌握也属于该层统计
  setLearned(job.S, hi[1], 1, atDay(1), 0);
  setLearned(job.S, mid[0], 2, atDay(2), 1);
  job.S.proficient[job.W[mid[1]].w] = Date.now();
  b.T.show('stats');
  openPanel(b, 'statsFreqPanel');
  const data = b.T.frequencyMastery();
  const highRow = data.rows.find(r => r.key === 'high');
  const btn = b.query('#freqMastery [data-drill-freq="high"]');
  assert.ok(btn, '高频层应有查看按钮');
  assert.match(btn.textContent, new RegExp('\\(' + highRow.total + '\\)'));
  btn.click();
  assert.equal(b.query('#v-list').classList.contains('on'), true);
  assert.match(b.query('#listDrillSource').textContent, /词频层 · 高频/);
  const expected = [];
  for (let i = 0; i < job.W.length; i++) if (job.T.inScope(i) && !job.T.isProficient(i) && job.W[i].f >= 20) expected.push(i);
  eqSet(b.T.getStatsDrillIndices(), expected, '高频层下钻=当前范围非熟练且 f≥20');
  assert.equal(b.T.getFilterIndices().length, highRow.total);
  // 返回统计后仍保留词频面板展开
  b.query('#btnBackToStats').click();
  assert.equal(b.query('#statsFreqPanel').open, true);
  assert.equal(b.T.getStatsDrill(), null);
});

// ===========================================================================
// 阶段档下钻
// ===========================================================================
test('阶段档：选择档位后「查看该档词 (N)」，词集与阶段分布口径一致', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 8);
  setLearned(job.S, picks[0], 1, atDay(1), 0);
  setLearned(job.S, picks[1], 1, atDay(2), 0);
  setLearned(job.S, picks[2], 3, atDay(3), 0);
  setLearned(job.S, picks[3], 11, atDay(4), 0);   // 已掌握档
  setLearned(job.S, picks[4], 0, atDay(1), 3);    // 第零档（重学）
  job.S.progress[picks[5]] = [0, 0, 0, 2, 0];      // 特训占位：hasMainProgress=false，不进入任何档
  job.S.proficient[job.W[picks[6]].w] = Date.now();
  b.T.show('stats');
  openPanel(b, 'statsStagesPanel');
  const stageBars = b.all('#stages [data-stage-label]');
  assert.equal(stageBars.length, 12, '重学/第1–10档 + 已掌握');
  clickStageBar(b, 1);
  const btn = b.query('#btnDrillStage');
  assert.equal(btn.disabled, false);
  assert.match(btn.textContent, /查看第1档词 \(2\)/);
  btn.click();
  assert.match(b.query('#listDrillSource').textContent, /阶段 · 第1档/);
  const expected = [];
  for (let i = 0; i < job.W.length; i++) {
    if (!job.T.inScope(i) || job.T.isProficient(i)) continue;
    const p = job.S.progress[i];
    if (!p || !(p[4] > 0)) continue;
    if (Math.min(p[0], 11) === 1) expected.push(i);
  }
  eqSet(b.T.getStatsDrillIndices(), expected);
  assert.equal(b.T.getFilterIndices().length, 2);
  // 已掌握档同样可下钻
  b.query('#btnBackToStats').click();
  clickStageBar(b, 11);
  assert.match(b.query('#btnDrillStage').textContent, /已掌握词 \(1\)/);
  b.query('#btnDrillStage').click();
  eqSet(b.T.getStatsDrillIndices(), [picks[3]]);
});

test('阶段空档 disabled 并说明；空样本面板整体标记为空', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 2);
  setLearned(job.S, picks[0], 1, atDay(1), 0);
  b.T.show('stats');
  openPanel(b, 'statsStagesPanel');
  clickStageBar(b, 5);
  assert.equal(b.query('#btnDrillStage').disabled, true);
  assert.match(b.query('#stagesDrillNote').textContent, /没有可查看/);
  b.query('#btnDrillStage').click();
  assert.equal(b.T.getStatsDrill(), null);
  job.S.progress = {};
  b.T.show('stats');
  assert.equal(b.query('#statsStagesPanel').dataset.empty, '1');
});

// ===========================================================================
// 口径一致性 / 不改学习设置 / 列表临时层
// ===========================================================================
test('下钻词集严格跟随统计口径：范围、词性/套卷/大纲筛选与熟练排除', () => {
  const b = browser(), job = seed(b);
  Object.assign(job.S.settings, {fmin: 3, fmax: 0, pmin: 2, kyOnly: true, pos: ['n'], posMode: 'primary'});
  job.T.startSession();
  // 在口径内挑词安排到期
  const inScope = [];
  for (let i = 0; i < job.W.length && inScope.length < 8; i++) if (job.T.inScope(i) && !job.T.isProficient(i)) inScope.push(i);
  assert.ok(inScope.length >= 4, '应能找到范围内的词');
  setLearned(job.S, inScope[0], 2, atDay(3), 0);
  setLearned(job.S, inScope[1], 2, atDay(3), 1);
  setLearned(job.S, inScope[2], 11, atDay(3), 0);   // 已掌握不计入到期
  job.S.proficient[job.W[inScope[3]].w] = Date.now();
  const settings = JSON.stringify(job.S.settings);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  const fc = b.T.dueForecast(14);
  clickForecastBar(b, 3);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.T.getFilterIndices().length, fc.counts[3]);
  assert.equal(b.T.getFilterIndices().length, 2);
  for (const i of b.T.getStatsDrillIndices()) {
    assert.ok(job.T.inScope(i), '下钻词必须在当前背诵范围内');
    assert.ok(!job.T.isProficient(i), '下钻词必须非熟练');
    const p = job.S.progress[i];
    assert.ok(p && p[4] > 0 && p[0] < 11, '下钻词必须是未掌握的已学词');
    assert.equal(localBucket(p[1]), 3, '到期词必须落在该本地日桶');
  }
  assert.equal(JSON.stringify(job.S.settings), settings, '下钻不改学习范围设置');
  // 统计口径变化后重新下钻得到新词集：排除已掌握/熟练后再算
  b.T.show('stats');
  clickForecastBar(b, 3);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.T.getFilterIndices().length, fc.counts[3]);
});

test('下钻中显式搜索/改筛选：退出临时层并恢复进入前列表筛选，再套用本次改动', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 3);
  setLearned(job.S, picks[0], 2, atDay(1), 1);
  setLearned(job.S, picks[1], 2, atDay(1), 1);
  b.T.show('list');
  b.query('#q').value = ''; b.query('#q').dispatch('input');
  b.query('#fst').value = 'wrong'; b.query('#fst').dispatch('change');
  const baseFsc = b.query('#fsc').value;
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 1);
  b.query('#btnDrillDueDay').click();
  assert.match(b.query('#listCount').textContent, /统计下钻/);
  // 搜索：退出下钻，恢复进入前的 fst=wrong，同时套用新的搜索词
  b.query('#q').value = job.W[picks[0]].w;
  b.query('#q').dispatch('input');
  assert.equal(b.T.getStatsDrill(), null, '显式搜索清除下钻层');
  assert.equal(b.query('#listDrillChip').hidden, true);
  assert.equal(b.query('#fst').value, 'wrong', '恢复进入前列表状态筛选');
  assert.equal(b.query('#fsc').value, baseFsc, '恢复进入前范围筛选');
  assert.match(b.query('#listCount').textContent, /搜索「/);
  assert.ok(!b.query('#listCount').textContent.includes('统计下钻'));
  assert.ok(b.T.getFilterIndices().length <= 1, '搜索+原筛选后结果收敛');
  assert.equal(b.T.getFilterIndices().every(i => b.query('#q').value === '' || job.W[i].w.indexOf(b.query('#q').value) >= 0 || job.W[i].m.indexOf(b.query('#q').value) >= 0), true);
});

test('下钻只影响列表：进入时列表回顶部/首行焦点，持久筛选值不被改写', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 4);
  for (let k = 0; k < 4; k++) setLearned(job.S, picks[k], 2, atDay(1), 1);
  b.T.show('list');
  b.query('#q').value = ''; b.query('#q').dispatch('input');
  b.query('#fst').value = 'wrong'; b.query('#fst').dispatch('change');
  b.query('#listScroll').scrollTop = 520;
  b.query('#listScroll').dispatch('scroll');
  const savedScroll = b.query('#listScroll').scrollTop;
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 1);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.query('#listScroll').scrollTop, 0, '进入下钻回到顶部');
  const first = b.query('#listInner [data-open-word]');
  assert.ok(first, '下钻列表应有行');
  assert.equal(b.doc.activeElement, first, '焦点在首行单词');
  assert.equal(b.all('#listInner [tabindex="0"]').length, 1, '下钻列表仍只有一个 Tab 停靠点');
  // 返回统计后回词表，进入前滚动位置恢复
  b.query('#btnBackToStats').click();
  b.T.show('list');
  assert.equal(b.query('#listScroll').scrollTop, Math.min(savedScroll,
    Math.max(0, b.T.getFilterIndices().length * 52 - b.query('#listScroll').clientHeight)), '下钻未污染进入前滚动位置');
  assert.equal(b.query('#fst').value, 'wrong');
});

test('切书时清除下钻临时层，绝不把旧书索引套到新书', () => {
  const b = browser({multiBook: true}), job = seed(b);
  const picks = pickIndices(job.T, 2);
  setLearned(job.S, picks[0], 2, atDay(1), 1);
  setLearned(job.S, picks[1], 2, atDay(1), 1);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 1);
  b.query('#btnDrillDueDay').click();
  assert.equal(b.T.getStatsDrill() !== null, true);
  b.T.switchBook('cet4');
  assert.equal(b.T.getStatsDrill(), null, '切书清除下钻');
  assert.equal(b.query('#listDrillChip').hidden, true);
  b.T.show('list');
  const len = b.T.getW().length;
  for (const n of b.all('#listInner [data-open-word]')) assert.ok(Number(n.dataset.openWord) < len, '渲染行属于新词书');
  assert.match(b.query('#listCount').textContent, /英语四级|共 \d+ 词/);
});

// ===========================================================================
// 不可还原面板 & 导出上下文
// ===========================================================================
test('近 14 天学习量与热力图只说明不可还原，不提供假历史词集按钮', () => {
  const b = browser(), job = seed(b);
  job.S.days[b.today()] = {n: 2, r: 4, ok: 3, no: 1};
  b.T.show('stats');
  const dayNote = b.query('#daysDrillNote');
  const heatNote = b.query('#heatmapDrillNote');
  assert.match(dayNote.textContent, /没有逐词明细/);
  assert.match(dayNote.textContent, /不提供/);
  assert.match(heatNote.textContent, /没有逐词明细/);
  assert.equal(b.all('#statsDaysPanel button').filter(n => /^btnDrill/.test(n.id)).length, 0, '学习量面板没有下钻按钮');
  assert.equal(b.all('#statsHeatmapPanel button').filter(n => /^btnDrill/.test(n.id)).length, 0, '热力图面板没有下钻按钮');
  assert.equal(b.all('#v-stats [data-drill-day]').length, 0);
  assert.equal(b.all('#v-stats [data-drill-heatmap]').length, 0);
});

test('词表导出/打印沿用下钻上下文，学习范围导出不受影响', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 6);
  const hi = [];
  for (let i = 0; i < job.W.length && hi.length < 3; i++) if (job.T.inScope(i) && job.W[i].f >= 20) hi.push(i);
  setLearned(job.S, hi[0], 2, atDay(2), 0);
  setLearned(job.S, hi[1], 2, atDay(2), 0);
  const scopeTxt = b.T.wordBookTxt('scope');
  b.T.show('stats');
  openPanel(b, 'statsFreqPanel');
  b.query('#freqMastery [data-drill-freq="high"]').click();
  const drilled = b.T.getStatsDrillIndices();
  const filterTxt = b.T.wordBookTxt('filter').trimEnd().split('\n');
  assert.equal(filterTxt.length, drilled.length, '筛选导出=下钻词集');
  assert.equal(b.T.printBookEntries('filter').length, drilled.length, '打印生词本=下钻词集');
  assert.equal(b.T.wordBookTxt('scope'), scopeTxt, '学习范围导出不受下钻影响');
  b.T.openPrintBook();
  assert.match(b.query('#printCount').textContent, /统计下钻/);
  b.T.closeSheet();
  b.T.exportWordBookTxt('filter');
  assert.match(b.created.at(-1).download, /下钻筛选/);
});

test('选中日期柱后键盘方向键切换，下钻按钮文案随选中日期更新', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 5);
  for (let k = 0; k < 4; k++) setLearned(job.S, picks[k], 2, atDay(k), 1);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  const bars = b.all('#forecast [data-fc-label]');
  bars[1].click();
  assert.match(b.query('#btnDrillDueDay').textContent, new RegExp('\\(1\\)'));
  bars[1].focus?.();
  bars[1].dispatch('keydown', {key: 'ArrowRight'});
  assert.equal(b.T.getStatsSelection().forecast, 2, '方向键把选中日期移到第 3 柱');
  assert.match(b.query('#btnDrillDueDay').textContent, new RegExp('\\(1\\)'));
  assert.equal(b.all('#forecast [aria-pressed="true"]').length, 1, '始终只有一个日期柱选中');
});

test('统计页重渲染后仍保留已选日期柱与下钻按钮状态', () => {
  const b = browser(), job = seed(b);
  const picks = pickIndices(job.T, 4);
  for (let k = 0; k < 4; k++) setLearned(job.S, picks[k], 2, atDay(2), 1);
  b.T.show('stats');
  openPanel(b, 'statsForecastPanel');
  clickForecastBar(b, 2);
  assert.equal(b.query('#btnDrillDueDay').disabled, false);
  b.T.show('stats');   // 重新渲染统计
  assert.equal(b.query('#statsForecastPanel').open, true, '原生 details 展开状态保留');
  assert.equal(b.query('#btnDrillDueDay').disabled, false, '重渲染后按钮仍可用');
  const pressed = b.all('#forecast [aria-pressed="true"]');
  assert.equal(pressed.length, 1);
  assert.equal(b.all('#forecast [data-fc-label]').indexOf(pressed[0]), 2, '重渲染后恢复选中柱');
});

console.log(`\nG 统计下钻回归：${passed} 通过，${failed} 失败`);
process.exitCode = failed ? 1 : 0;
