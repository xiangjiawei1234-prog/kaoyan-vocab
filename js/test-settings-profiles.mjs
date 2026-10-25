/**
 * 下一大版本：设置目录、命名方案与纯配置导入/导出真实脚本回归。
 * 用解析真实 index.html 的 DOM 桩执行真实 js/app.js；关键点：桩的 focus() 会像浏览器一样
 * 派发 focusin 冒泡事件（C-07b 的根因是 renderRows 把焦点还回旧行 → focusin 改写活动行）。
 * 同时回归 ArrowUp / End / Home / 行内 Tab / ArrowLeft-Right / roving tabindex=1。
 * 运行：node --max-old-space-size=512 js/test-settings-profiles.mjs
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
function browser({multiBook = true} = {}) {
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
  const intervals = [], storage = new Map(), failRead = new Set(), failWrite = new Set();
  const window = {document: doc, location: {protocol: 'https:', href: 'https://vocab.test/'},
    addEventListener() {}, matchMedia: () => ({matches:false, addEventListener(){}}),
    getSelection: () => ({toString: () => ''}),
    getComputedStyle: () => ({fontSize: '32px'}), innerWidth: 1200, innerHeight: 800};
  const context = vm.createContext({
    window, document: doc, console, Date,
    localStorage: {getItem: k => { if (failRead.has(k)) throw new Error("read blocked"); return storage.has(k) ? storage.get(k) : null; }, setItem: (k, v) => { if (failWrite.has(k)) throw new Error("quota"); storage.set(k, String(v)); }, removeItem: k => storage.delete(k)},
    setInterval() { return 0; }, clearInterval() {},
    setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, cancelAnimationFrame() {},
    confirm: () => true, Blob: class {}, URL: {createObjectURL: () => 'blob:test', revokeObjectURL(){}},
    FileReader: class {}, performance: {now: () => Date.now()},
    SpeechSynthesisUtterance: class {}, speechSynthesis: {cancel(){}, speak(){}, getVoices(){ return []; }}
  });
  vm.runInContext(words, context, {filename: 'words-data.js'});
  if (multiBook) for (const file of ['cet-words-data.js', 'combined-words-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), context, {filename: file});
  }
  vm.runInContext(app, context, {filename: 'app.js'});
  const T = window.__vocab;
  assert.ok(T, 'app.js 应提供 window.__vocab');
  return {
    T, P: window.__vocabSettingsProfiles, doc, storage, failRead, failWrite, query: s => doc.querySelector(s), all: s => doc.querySelectorAll(s),
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
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a,b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const live = b => clone({state: b.T.getS(), cur: b.T.cur, phase: b.T.phase, verdict: b.T.verdict,
  Q: b.T.Q, qi: b.T.qi, answered: b.T.answered, plan: b.T.getPlan(), total: b.T.getGroupTotal()});
const scene = b => { const s=live(b); delete s.state.settings; return s; };
const KEY = 'kaoyan_vocab_v1';
const save = (b, name='日常', cats=['plan','scope','rhythm']) => {
  const result = b.P.saveSettingsProfile(name,cats); assert.equal(result.ok,true,result.error); return result.profile;
};

test('设置目录逐字段覆盖真实默认，不增加进度或瞬时控件', () => {
  const b=browser(), catalog=b.P.getCatalog();
  same(catalog.map(x=>x.key).sort(),Object.keys(b.T.getS().settings).sort());
  assert.equal(new Set(catalog.map(x=>x.key)).size,catalog.length);
  for(const entry of catalog) {
    assert.ok(entry.label && entry.search && entry.target.startsWith('#'));
    assert.ok(b.query(entry.target), "目录定位目标存在：" + entry.key);
    assert.ok(['now','next'].includes(entry.effect));
    assert.ok(['book','carry'].includes(entry.scope));
    same(entry.defaultValue,b.T.getS().settings[entry.key]);
  }
  assert.equal(catalog.some(x=>['progress','timeSec','reviewDay','extraDay','printSource','txtSplitAmount'].includes(x.key)),false);
  catalog[0].label='changed'; assert.notEqual(b.P.getCatalog()[0].label,'changed');
});

test('保存仅包含选类配置，命名方案不写主记录或学习现场', () => {
  const b=browser(), before=live(b), raw=b.storage.get(KEY); const p=save(b);
  assert.equal(p.bookId,'kaoyan'); assert.equal(p.name,'日常');
  same(p.categories,['plan','scope','rhythm']);
  assert.equal('theme' in p.settings,false); assert.equal('progress' in p.settings,false);
  same(live(b),before); assert.equal(b.storage.get(KEY),raw);
  const fetched=b.P.readSettingsProfiles(); assert.equal(fetched.profiles.length,1);
  fetched.profiles[0].settings.dailyNew=499; assert.equal(b.P.readSettingsProfiles().profiles[0].settings.dailyNew,20);
});

test('重命名与复制保留原方案配置，不偷偷读取当前配置', () => {
  const b=browser(), p=save(b); assert.equal(b.P.applySettingsPatch({dailyNew:77}).ok,true);
  const renamed=b.P.renameSettingsProfile(p.id,'工作日'); assert.equal(renamed.ok,true); assert.equal(renamed.profile.settings.dailyNew,20);
  const copy=b.P.duplicateSettingsProfile(p.id,'周末'); assert.equal(copy.ok,true); assert.notEqual(copy.profile.id,p.id);
  same(copy.profile.settings,p.settings); assert.equal(b.P.readSettingsProfiles().profiles.length,2);
  assert.equal(b.P.deleteSettingsProfile(p.id).ok,true); assert.equal(b.P.readSettingsProfiles().profiles.length,1);
  assert.equal(b.P.deleteSettingsProfile(p.id).ok,false);
});

test('名称、类别、30个上限严格拒绝，保留既有目录', () => {
  const b=browser(); save(b);
  for(const [name,cats] of [['', ['plan']],['x'.repeat(41),['plan']],['\n',['plan']],['日常',['plan']],['bad',[]],['bad',['plan','plan']],['bad',['progress']]]) {
    const raw=b.storage.get(b.P.key); assert.equal(b.P.saveSettingsProfile(name,cats).ok,false); assert.equal(b.storage.get(b.P.key),raw);
  }
  for(let i=1;i<30;i++) save(b,'方案'+i,['appearance']);
  const raw=b.storage.get(b.P.key); assert.equal(b.P.saveSettingsProfile('第31个',['plan']).ok,false); assert.equal(b.storage.get(b.P.key),raw);
  assert.equal(b.P.duplicateSettingsProfile(b.P.readSettingsProfiles().profiles[0].id,'复制第31个').ok,false);
});

test('主配置下组应用保留真实当前组、判定、撤销与快照', () => {
  const b=browser(); b.T.judge(true); b.T.persistSessionSnapshot();
  const before=scene(b), snapKey=b.T.getSessionSnapshotKey('kaoyan'), snap=b.storage.get(snapKey);
  const result=b.P.applySettingsPatch({dailyNew:35,groupSize:17,order:'wrong',fmin:2,stages:[2,4,8,16,32,64,128,256,512,1024],relearn:2});
  assert.equal(result.ok,true,result.error); same(scene(b),before); assert.equal(b.storage.get(snapKey),snap);
  assert.equal(b.T.hasPendingScopeSettings(),true); assert.equal(b.T.getS().settings.stagePreset,'custom');
  assert.equal(JSON.parse(b.storage.get(KEY)).settings.dailyNew,35);
  assert.ok(result.changes.some(x=>x.key==='dailyNew'&&x.effect==='next'));
  b.T.undo(); assert.equal(b.T.phase,'recall'); assert.equal(b.T.answered,0);
});

test('即时外观/语音/按键应用保留学习数据，复习上限即时生效', () => {
  const b=browser(), before=scene(b);
  const result=b.P.applySettingsPatch({theme:'dark',fontSize:'large',speechRate:1.1,voiceURI:'English Voice',dailyReviewCap:7,
    keys:{know:'a',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},singleCharKeys:false});
  assert.equal(result.ok,true,result.error); same(scene(b),before);
  assert.equal(b.doc.documentElement.dataset.theme,'dark'); assert.equal(b.doc.documentElement.dataset.fontSize,'large');
  assert.equal(b.T.getReviewCap(),7); assert.equal(b.T.getSpeechPrefs().rate,1.1);
  assert.equal(b.T.hasPendingScopeSettings(),false);
});

test('局部应用不覆盖未选类别，差异/目标匹配量来自真实统一筛选', () => {
  const b=browser(); const p=save(b,'混合',['plan','scope','appearance']);
  assert.equal(b.P.applySettingsPatch({dailyNew:99,theme:'dark',fmin:3,posMode:'all',pos:['v']}).ok,true);
  const before=scene(b); const preview=b.P.previewSettingsProfile(p,['plan']);
  assert.equal(preview.ok,true); assert.equal(preview.changes.some(x=>x.category!=='plan'),false);
  assert.equal(preview.scopeCount,b.T.getW().reduce((n,x,i)=>n+(b.T.inScope(i)&&!b.T.isProficient(i)?1:0),0));
  const result=b.P.applySettingsProfile(p,['plan']); assert.equal(result.ok,true,result.error); same(scene(b),before);
  assert.equal(b.T.getS().settings.dailyNew,20); assert.equal(b.T.getS().settings.theme,'dark'); assert.equal(b.T.getS().settings.fmin,3);
  assert.equal(b.P.previewSettingsProfile(p,['rhythm']).ok,false);
});

test('预览新范围为纯读取，匹配数等于应用后统一筛选', () => {
  const b=browser(), before=live(b), stored=Array.from(b.storage.entries());
  const preview=b.P.previewSettingsPatch({fmin:4,pmin:3,posMode:'all',pos:['v']});
  assert.equal(preview.ok,true,preview.error); same(live(b),before); same(Array.from(b.storage.entries()),stored);
  assert.equal(b.P.applySettingsPatch({fmin:4,pmin:3,posMode:'all',pos:['v']}).ok,true);
  assert.equal(preview.scopeCount,b.T.inScopeCount());
});

test('预览匹配数排除熟练词，与既有范围摘要一致且不改熟练记录', () => {
  const b=browser(), idx=b.T.getW().findIndex((x,i)=>b.T.inScope(i));
  assert.ok(idx>=0); b.T.setProficient(idx,true); const before=live(b), raw=b.storage.get('kaoyan_vocab_proficient_v1');
  const preview=b.P.previewSettingsPatch({dailyNew:21}); assert.equal(preview.ok,true);
  assert.equal(preview.scopeCount,b.T.inScopeCount()); same(live(b),before); assert.equal(b.storage.get('kaoyan_vocab_proficient_v1'),raw);
});

test('跨书复制明确来源与目标，超出目标套卷上限整次拒绝', () => {
  const b=browser(); assert.equal(b.T.switchBook('combined'),true);
  const max=b.T.getBooks().find(x=>x.id==='combined').paperCount;
  assert.equal(b.P.applySettingsPatch({pmin:max}).ok,true); const p=save(b,'综合精确范围',['scope']);
  assert.equal(b.T.switchBook('cet4'),true); const before=live(b), raw=b.storage.get('cet4_vocab_v1');
  const preview=b.P.previewSettingsProfile(p); assert.equal(preview.ok,false); assert.equal(preview.crossBook,true);
  assert.equal(preview.sourceBook,'combined'); assert.equal(preview.targetBook,'cet4'); assert.match(preview.error,/套卷/);
  assert.equal(b.P.applySettingsProfile(p).ok,false); same(live(b),before); assert.equal(b.storage.get('cet4_vocab_v1'),raw);
});

test('所有可写字段错误均整次拒绝且不半写有效同伴字段', () => {
  const b=browser(), baseline=live(b), raw=b.storage.get(KEY);
  const invalid=[{dailyNew:0},{groupSize:101},{dailyReviewCap:-1},{fmin:0},{fmin:10,fmax:2},{pmin:9999},{order:'abc'},
    {posMode:'any'},{theme:'blue'},{fontSize:'huge'},{voiceURI:' '+ 'v'}, {speechRate:0.4},{speechRate:1.123},{pos:['n','n']},
    {pos:['z']},{keys:{know:'f'}},{keys:{know:'f',dont:'f',next:' ',speak:'s',star:'b',proficient:'m'}},
    {autoResume:{enabled:true,threshold:0,idleMs:30000,countdownMs:3000}},{showPh:1},{stages:[1,2]},{relearn:0},
    {stagePreset:'custom'},{progress:{}},JSON.parse('{"__proto__":{"polluted":true}}')];
  for(const patch of invalid) {
    const result=b.P.applySettingsPatch({...patch,...(Object.hasOwn(patch,'theme')?{dailyNew:41}:{theme:'dark'})});
    assert.equal(result.ok,false,JSON.stringify(patch)); same(live(b),baseline); assert.equal(b.storage.get(KEY),raw);
  }
});

test('主记录写失败与读取失败严格原子；恢复存储后可正常重试', () => {
  const b=browser(), before=live(b), raw=b.storage.get(KEY);
  b.failWrite.add(KEY); assert.equal(b.P.applySettingsPatch({dailyNew:42,theme:'dark'}).ok,false);
  same(live(b),before); assert.equal(b.storage.get(KEY),raw); b.failWrite.clear();
  b.failRead.add(KEY); assert.equal(b.P.applySettingsPatch({dailyNew:42}).ok,false); same(live(b),before); b.failRead.clear();
  assert.equal(b.P.applySettingsPatch({dailyNew:42}).ok,true);
});

test('未送达的跨标签权威更新与独立熟练变化不会被配置覆盖', () => {
  const b=browser(); assert.equal(b.P.applySettingsPatch({dailyNew:22}).ok,true);
  const before=live(b), newer=JSON.parse(b.storage.get(KEY)); newer.timeSec=77;
  b.storage.set(KEY,JSON.stringify(newer)); const raw=b.storage.get(KEY);
  assert.equal(b.P.applySettingsPatch({dailyNew:23}).ok,false); same(live(b),before); assert.equal(b.storage.get(KEY),raw);
  const c=browser(), cBefore=live(c); c.storage.set('kaoyan_vocab_proficient_v1',JSON.stringify({[c.T.getW()[0].w]:Date.now()}));
  assert.equal(c.P.applySettingsPatch({theme:'dark'}).ok,false); same(live(c),cBefore);
});

test('目录损坏、读取失败和写入失败均保留原文并拒绝全部写动作', () => {
  const b=browser(); const p=save(b); const raw=b.storage.get(b.P.key);
  b.failWrite.add(b.P.key); assert.equal(b.P.renameSettingsProfile(p.id,'修改').ok,false); assert.equal(b.storage.get(b.P.key),raw); b.failWrite.clear();
  b.failRead.add(b.P.key); assert.equal(b.P.saveSettingsProfile('新',['plan']).ok,false); b.failRead.clear(); assert.equal(b.storage.get(b.P.key),raw);
  for(const bad of ['{broken',JSON.stringify({kind:b.P.kind,version:9,profiles:[]}),JSON.stringify({kind:b.P.kind,version:1,profiles:[{...p,progress:{}}]})]) {
    b.storage.set(b.P.key,bad); const result=b.P.readSettingsProfiles(); assert.equal(result.ok,false); assert.equal(result.raw,bad);
    for(const fn of [()=>b.P.saveSettingsProfile('新',['plan']),()=>b.P.renameSettingsProfile(p.id,'新'),()=>b.P.duplicateSettingsProfile(p.id,'新'),()=>b.P.deleteSettingsProfile(p.id)]) {
      assert.equal(fn().ok,false); assert.equal(b.storage.get(b.P.key),bad);
    }
  }
});

test('每次目录修改重读最新存储，保留别标签新增方案', () => {
  const b=browser(); const one=save(b,'一'), old=b.P.readSettingsProfiles();
  const external={...one,id:'external',name:'其他标签'}; b.storage.set(b.P.key,JSON.stringify({kind:b.P.kind,version:1,profiles:old.profiles.concat(external)}));
  save(b,'二'); assert.equal(b.P.readSettingsProfiles().profiles.length,3);
  assert.equal(b.P.deleteSettingsProfile(one.id).ok,true); assert.ok(b.P.readSettingsProfiles().profiles.some(p=>p.id==='external'));
});

test('配置导出独立kind/version，预览只读，导入合并不应用且重复可跳过', () => {
  const a=browser(); const p=save(a); const exported=a.P.exportSettingsProfiles(); assert.equal(exported.ok,true);
  assert.equal(exported.envelope.kind,a.P.kind); assert.equal(exported.envelope.version,1); assert.equal('books' in exported.envelope,false);
  const b=browser(), before=live(b), allRaw=Array.from(b.storage.entries()); const text=JSON.stringify(exported.envelope);
  const preview=b.P.prepareSettingsProfilesImport(text); assert.equal(preview.ok,true); assert.equal(preview.count,1);
  same(live(b),before); same(Array.from(b.storage.entries()),allRaw);
  const imported=b.P.importSettingsProfiles(text); assert.equal(imported.ok,true); assert.equal(imported.count,1); same(live(b),before);
  assert.equal(b.P.importSettingsProfiles(text).count,0); assert.equal(b.P.readSettingsProfiles().profiles.length,1);
  const backup=b.T.buildExport(); assert.equal(backup.version,3); assert.equal(JSON.stringify(backup).includes(p.id),false);
});

test('配置导入全量拒绝坏字段/未知字段/进度备份/重名冲突，不半写第一份合法方案', () => {
  const source=browser(), p=save(source); const b=browser(), before=live(b), store=Array.from(b.storage.entries());
  const env=profiles=>({kind:b.P.kind,version:1,profiles});
  const bad=[env([p,{...clone(p),id:'bad',name:'坏方案',settings:{...clone(p.settings),dailyNew:0}}]),
    env([{...p,settings:{...clone(p.settings),progress:{}}}]),env([{...p,categories:['unknown']}]),env([{...p,bookId:'unknown'}]),
    env([{...p,updatedAt:0}]),{...env([p]),version:2},b.T.buildExport(),env([])];
  for(const input of bad) { assert.equal(b.P.importSettingsProfiles(JSON.stringify(input)).ok,false); same(live(b),before); same(Array.from(b.storage.entries()),store); }
  assert.equal(b.P.importSettingsProfiles(env([p])).ok,true); const raw=b.storage.get(b.P.key);
  assert.equal(b.P.importSettingsProfiles(env([{...p,settings:{...p.settings,dailyNew:99}}])).ok,false); assert.equal(b.storage.get(b.P.key),raw);
  assert.equal(b.P.importSettingsProfiles(env([{...p,id:'different'}])).ok,false); assert.equal(b.storage.get(b.P.key),raw);
});

test('导入写入失败不留半份目录，备份v3及旧记录兼容入口不受方案影响', () => {
  const a=browser(); save(a); const b=browser(), before=live(b), raw=b.storage.get(b.P.key);
  b.failWrite.add(b.P.key); assert.equal(b.P.importSettingsProfiles(a.P.exportSettingsProfiles().envelope).ok,false);
  assert.equal(b.storage.get(b.P.key),raw); same(live(b),before);
  const legacy=b.T.normalizeState({settings:{dailyNew:33},progress:{},days:{}},'kaoyan');
  assert.equal(legacy.settings.dailyNew,33); assert.equal(legacy.settings.dailyReviewCap,0); assert.equal(legacy.settings.autoResume.enabled,false);
  assert.equal(legacy.settings.stagePreset,'legacy'); assert.equal(b.T.buildExport().version,3);
});

test('切换方案保留今天暂停和临时加量，自动续背配置仅重新计时', () => {
  const b=browser(); b.T.pauseAutoResumeToday(); const pause=b.storage.get(b.T.autoResumePauseKey), extra=clone(b.T.getS().extraDay);
  const result=b.P.applySettingsPatch({autoResume:{enabled:true,threshold:1,idleMs:30000,countdownMs:3000}});
  assert.equal(result.ok,true,result.error); assert.equal(b.storage.get(b.T.autoResumePauseKey),pause); same(b.T.getS().extraDay,extra);
  assert.equal(b.T.getAutoResumePause().pausedToday,true); assert.equal(b.T.getAutoResume().threshold,1);
});

test('内置方案是可预览的配置起点，不持久化、不夹带范围外观或按键', () => {
  const b=browser(), before=live(b), raw=Array.from(b.storage.entries()), builtins=b.P.getBuiltinSettingsProfiles();
  assert.equal(builtins.length,2); for(const p of builtins) { assert.equal(b.P.previewSettingsProfile(p).ok,true); same(p.categories,['plan','rhythm']); }
  assert.equal(b.P.importSettingsProfiles({kind:b.P.kind,version:1,profiles:[builtins[0]]}).ok,false,'独立个人目录拒绝内置保留标识');
  same(live(b),before); same(Array.from(b.storage.entries()),raw);
  assert.equal(b.P.applySettingsPatch({theme:'dark',fmin:3}).ok,true); const sceneBefore=scene(b);
  assert.equal(b.P.applySettingsProfile(builtins[1]).ok,true); same(scene(b),sceneBefore);
  assert.equal(b.T.getS().settings.dailyNew,10); assert.equal(b.T.getS().settings.theme,'dark'); assert.equal(b.T.getS().settings.fmin,3);
  assert.equal(b.P.readSettingsProfiles().profiles.length,0);
});

test('个人方案的界面偏好只应用本书，不广播设备或其他词书', () => {
  const b=browser(); assert.equal(b.P.applySettingsPatch({fontSize:'large'}).ok,true);
  const profile=save(b,'本书阅读',['appearance']);
  assert.equal(b.P.applySettingsPatch({fontSize:'standard'}).ok,true);
  const deviceKey='vocab_device_preferences_v1', beforeDevice=JSON.parse(b.storage.get(deviceKey)), beforeScene=scene(b);
  const result=b.P.applySettingsProfile(profile); assert.equal(result.ok,true,result.error);
  same(scene(b),beforeScene); assert.equal(b.T.getS().settings.fontSize,'large');
  const afterDevice=JSON.parse(b.storage.get(deviceKey)); same(afterDevice.shared,beforeDevice.shared);
  const chosen=b.P.getCatalog().filter(x=>x.category==='appearance').map(x=>x.key);
  same(afterDevice.overrides.kaoyan,chosen.filter(k=>afterDevice.overrides.kaoyan.includes(k)));
  assert.equal(afterDevice.overrides.kaoyan.length,chosen.length);
  b.T.switchBook('cet4'); assert.equal(b.T.getS().settings.fontSize,'standard');
});

test('方案与继承值相同也建立本书覆盖，之后设备变更不改变已应用方案', () => {
  const b=browser(), profile=save(b,'同值阅读',['appearance']), beforeScene=scene(b);
  const preview=b.P.previewSettingsProfile(profile);
  assert.equal(preview.changes.length,0); assert.ok(preview.ownershipChanges.includes('fontSize'));
  const result=b.P.applySettingsProfile(profile); assert.equal(result.ok,true,result.error);
  assert.ok(result.ownershipChanges.includes('fontSize')); same(scene(b),beforeScene);
  assert.equal(b.T.applyPreferencePatch({fontSize:'large'},{target:'device'}).ok,true);
  assert.equal(b.T.getS().settings.fontSize,'standard','已应用本书方案不随设备字号变化');
  b.T.switchBook('cet4'); assert.equal(b.T.getS().settings.fontSize,'large','未覆盖书仍跟随设备');
});

test('局部应用方案只冻结所选类别，未选语音和按键沿用当前归属与值', () => {
  const b=browser(), profile=save(b,'多类方案',['appearance','speech','keys']);
  assert.equal(b.P.applySettingsPatch({fontSize:'large',speechRate:1.2,gestures:{enabled:false,recall:{left:'dont',right:'know'},revealed:{left:'none',right:'none'}}}).ok,true);
  const before=clone(b.T.getS().settings), deviceKey='vocab_device_preferences_v1', shared=JSON.parse(b.storage.get(deviceKey)).shared;
  const result=b.P.applySettingsProfile(profile,['appearance']);assert.equal(result.ok,true,result.error);
  assert.equal(b.T.getS().settings.fontSize,'standard'); assert.equal(b.T.getS().settings.speechRate,before.speechRate);
  same(b.T.getS().settings.gestures,before.gestures);
  const device=JSON.parse(b.storage.get(deviceKey));same(device.shared,shared);
  assert.equal(device.overrides.kaoyan.includes('speechRate'),false);
  assert.equal(device.overrides.kaoyan.includes('gestures'),false);
});

test('方案同时改计划与偏好时设备/主记录任一写失败均整份回滚', () => {
  for(const failKey of ['vocab_device_preferences_v1',KEY]) {
    const b=browser(), profile=save(b,'计划阅读',['plan','appearance']);
    assert.equal(b.P.applySettingsPatch({dailyNew:42,fontSize:'large'}).ok,true);
    const before=live(b), main=b.storage.get(KEY), device=b.storage.get('vocab_device_preferences_v1');
    b.failWrite.add(failKey);const result=b.P.applySettingsProfile(profile);assert.equal(result.ok,false);
    same(live(b),before);assert.equal(b.storage.get(KEY),main);assert.equal(b.storage.get('vocab_device_preferences_v1'),device);
    assert.equal(b.storage.has('vocab_preferences_journal_v1'),false,'成功回滚不遗留恢复日志');
    b.failWrite.delete(failKey);assert.equal(b.P.applySettingsProfile(profile).ok,true);
    assert.equal(b.T.getS().settings.dailyNew,profile.settings.dailyNew);assert.equal(b.T.getS().settings.fontSize,profile.settings.fontSize);
  }
});

test('工作台两个入口的关闭按钮与遮罩真正关闭，并释放背景与保留当前组', () => {
  for (const entry of ['#btnQuickSettings', '#btnStudyProfiles']) {
    for (const closer of ['.sheet-head [data-close]', '.sheet-backdrop[data-close]']) {
      const b=browser();b.T.judge(true);
      const before=scene(b),sheet=b.query('#settingsWorkspaceSheet');
      b.query(entry).click();assert.equal(sheet.hidden,false);
      assert.equal(b.query('#main').inert,true);
      const close=sheet.querySelector(closer);assert.ok(close,closer);
      close.click();
      assert.equal(sheet.hidden,true,entry+' '+closer+' 应关闭窗口');
      assert.equal(b.query('#main').inert,false);
      assert.equal(b.query('.top').inert,false);
      assert.equal(b.doc.activeElement.id,'card');
      same(scene(b),before);
    }
  }
});

test('设置搜索确认候选与AltGraph/长按不提前转移焦点，普通Enter和方向键仍可用', () => {
  const b=browser();b.T.show('set');
  const input=b.query('#settingsSearch');input.value='字号';input.dispatch('input');
  const result=b.query('#settingsSearchResults button');assert.ok(result,'应有可选择的搜索结果');
  const before=scene(b);
  for(const opts of [{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'},{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true}]) {
    input.focus();const event=b.key('Enter',opts);
    assert.equal(b.doc.activeElement,input,'确认输入候选不能跳到搜索结果');
    assert.equal(event.defaultPrevented,false,'保留输入法/设备自己的确认行为');
    same(scene(b),before);
  }
  input.focus();assert.equal(b.key('Enter').defaultPrevented,true);assert.equal(b.doc.activeElement,result);
  input.focus();assert.equal(b.key('ArrowDown').defaultPrevented,true);assert.equal(b.doc.activeElement,result);
});

test('工作台标签不截获浏览器修饰组合或输入法，裸方向键与长按仍切页', () => {
  const b=browser();b.query('#btnQuickSettings').click();const quick=b.query('#workspaceQuickTab');quick.focus();
  for(const opts of [{altKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'}]) {
    const event=b.key('ArrowRight',opts);assert.equal(event.defaultPrevented,false);assert.equal(b.doc.activeElement,quick);
    assert.equal(b.query('#workspaceQuick').hidden,false);assert.equal(b.query('#workspaceProfiles').hidden,true);
  }
  assert.equal(b.key('ArrowRight',{repeat:true}).defaultPrevented,true);
  assert.equal(b.doc.activeElement,b.query('#workspaceProfilesTab'));assert.equal(b.query('#workspaceProfiles').hidden,false);
});

console.log(`\n设置方案核心回归：${passed} 通过，${failed} 失败`);
process.exitCode=failed?1:0;
