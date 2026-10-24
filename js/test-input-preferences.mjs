/**
 * D1输入定制：真实键盘/指针事件与旧配置兼容回归
 * 受控时钟、DOM桩、四词书 + vm 沙箱执行真实 js/app.js，不复制业务逻辑。
 * 运行：node --max-old-space-size=512 js/test-input-preferences.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const PROF_KEY = "kaoyan_vocab_proficient_v1";
const appSource = () => fs.readFileSync(process.env.INPUT_APP_SOURCE || path.join(HERE, "app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");

const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 浏览器桩：受控 Date/performance、可捕获 setInterval、可切换可见性与写失败。 */
function browser({ initial = null, sharedStorage = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const T0 = now;
  let failWrites = false, selection = "";
  const writeLog = [];
  const registry = new Map();
  const documentEvents = new Map(); // type → [{fn, capture}]
  const windowEvents = new Map();
  const intervals = [];
  const storage = sharedStorage || new Map(initial === null ? [] : [[KEY, typeof initial === "string" ? initial : JSON.stringify(initial)]]);

  function element(tag = "div") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(), id: "", style: {}, dataset: {}, value: "",
      checked: false, disabled: false, hidden: false, files: [], scrollTop: 0,
      clientHeight: 600, textContent: "", onclick: null, onchange: null, oninput: null,
      offsetWidth: 100, offsetHeight: 40, children: [], parentNode: null,
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn, options) {
        if (!events.has(type)) events.set(type, []);
        const capture = typeof options === "boolean" ? options : !!(options && options.capture);
        events.get(type).push({ fn, capture });
      },
      removeEventListener() {},
      fire(type,data={}) {
        const event=Object.assign({type,target:el,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}},data);
        for(const rec of events.get(type)||[])if(rec.capture)rec.fn(event);
        for(const rec of events.get(type)||[])if(!rec.capture)rec.fn(event);
        return event;
      },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      click() { if (el.onclick) el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); },
      focus() { if (document) document.activeElement = el; },
      blur() { if (document && document.activeElement === el) document.activeElement = null; },
      closest() { return null; },
      contains(node) { return node === el; },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el._attrs || {},name) ? el._attrs[name] : null; },
      setAttribute(name,value) { (el._attrs ||= {})[name]=String(value); },
      removeAttribute(name) { if(el._attrs)delete el._attrs[name]; },
      querySelector() { return element("div"); },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html || ""; },
      set(v) { el._html = String(v); }
    });
    return el;
  }
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (!registry.has(selector)) registry.set(selector, element(selector.startsWith("input#") || /^#(dailyNew|pmin|fmin|fmax)$/.test(selector) ? "input" : "div"));
    return registry.get(selector);
  }
  const views = ["study", "list", "stats", "set"].map(v => query(`#v-${v}`));
  views[0].classList.add("on");
  const nav = ["study", "list", "stats", "set"].map(v => { const b = element("button"); b.dataset.v = v; return b; });
  const keyButtons = ["know", "dont", "next", "speak", "star", "proficient", "continue", "wait", "return", "listSearch"].map(k => { const b = element("button"); b.dataset.k = k; return b; });
  const closeButton = element("button");
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#helpSheet [data-close]" || selector === "#helpSheet button") return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  for (const id of ["helpSheet", "appAlert", "exPop", "wordSheet", "guideSheet", "bookSheet"]) query("#" + id).hidden = true;

  const document = {
    querySelector: query, querySelectorAll: queryAll,
    documentElement: { dataset: {}, style: {} }, body: element("body"),
    visibilityState: "visible", activeElement: null,
    addEventListener(type, fn, options) {
      if (!documentEvents.has(type)) documentEvents.set(type, []);
      const capture = typeof options === "boolean" ? options : !!(options && options.capture);
      documentEvents.get(type).push({ fn, capture });
    },
    removeEventListener() {},
    createElement(tag) { return element(tag); }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const window = {
    document,
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    getSelection:()=>({toString:()=>selection}),
    innerWidth: 1200, innerHeight: 800
  };
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem(k, v) {
      if (failWrites) throw new Error("QuotaExceededError: storage disabled");
      writeLog.push(k);
      storage.set(k, String(v));
    },
    removeItem: k => storage.delete(k)
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console, localStorage,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: class {}, SpeechSynthesisUtterance: class {},
    speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now - T0 }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  for (const file of ["cet-words-data.js", "combined-words-data.js"]) vm.runInContext(fs.readFileSync(path.join(HERE, file), "utf8"), context, {filename: file});
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试入口");
  const study = window.__vocabStudy;
  assert.ok(study, "app.js 应提供 window.__vocabStudy 只读计时钩子");

  const fireDocument = (type, ev = {}) => {
    const event = Object.assign({ type, target: document.body, defaultPrevented:false, preventDefault() {this.defaultPrevented=true;}, stopPropagation() {} }, ev);
    for (const rec of documentEvents.get(type) || []) if (rec.capture) rec.fn(event);
    for (const rec of documentEvents.get(type) || []) if (!rec.capture) rec.fn(event);
    return event;
  };
  return {
    T, study, window, document, context, storage, intervals, writeLog, query, views, keyButtons,
    selectText(text){selection=text;},
    get now() { return now; },
    advance(ms) { now += ms; },
    tick() { study.tick(); },
    act() { study.act(); },
    flush() { return study.flush(); },
    debug() { return study.getDebug(); },
    timer() {
      const ms = study.getDebug().tickMs;
      const timer = intervals.find(t => t.ms === ms);
      assert.ok(timer, `应注册 ${ms}ms 学习时长采样定时器`);
      return timer.fn;
    },
    fireDocument,
    setHidden() {
      document.visibilityState = "hidden";
      fireDocument("visibilitychange");
    },
    setVisible() {
      document.visibilityState = "visible";
      fireDocument("visibilitychange");
    },
    key(data) {
      return fireDocument("keydown", {
        key: "", code: "", ctrlKey: false, metaKey: false, altKey: false,
        shiftKey: false, repeat: false, isComposing: false, ...data
      });
    },
    documentClick() { return fireDocument("click"); },
    storageEvent() {
      const e = { key: KEY, newValue: storage.has(KEY) ? storage.get(KEY) : null };
      for (const fn of windowEvents.get("storage") || []) fn(e);
    },
    pageShow() { for (const fn of windowEvents.get("pageshow") || []) fn({ type: "pageshow" }); },
    windowFocus() { for (const fn of windowEvents.get("focus") || []) fn({ type: "focus" }); },
    setFailWrites(value) { failWrites = !!value; },
    timeSec() { return T.getS().timeSec || 0; },
    rawState() { return storage.has(KEY) ? JSON.parse(storage.get(KEY)) : null; }
  };
}

function setup(b, {dailyNew = 2, groupSize = 2, cap = 0, used = 0, dayN = 0, extra = 0, due = 0} = {}) {
  const T = b.T, s = T.getS(), d = today(b.now);
  s.progress = {}; s.days = {[d]: {n: dayN, r: dayN, ok: dayN, no: 0}};
  s.stars = {}; s.proficient = {}; s.timeSec = 0;
  Object.assign(s.settings, {dailyNew, groupSize, fmin: 1, fmax: 0, pmin: 0, kyOnly: false,
    pos: [], posMode: 'primary', order: 'freq', backlogGuard: false, autoSpk: false});
  s.reviewDay = {d, used}; s.extraDay = {d, extra};
  for (let i = 0; i < due; i++) s.progress[i] = [1, b.now - 5000, 1, 0, b.now - 86400000];
  T.setReviewCap(cap); T.startSession(); T.show('study'); return T;
}
function finish(T) { let i = 0; while (T.cur != null && i++ < 120) { T.judge(true); T.tryNext(); } assert.ok(T.cur == null); }
const group = T => JSON.stringify({Q: T.Q, qi: T.qi, cur: T.cur, phase: T.phase, verdict: T.verdict, answered: T.answered, plan: T.getPlan()});
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS  ' + name); } catch (error) { failed++; console.log('FAIL  ' + name + ': ' + error.message); } }

const prefs = b => b.window.__vocabSettingsProfiles;
const scene = T => JSON.stringify({group:JSON.parse(group(T)),progress:T.getS().progress,days:T.getS().days,
  review:T.getS().reviewDay,extra:T.getS().extraDay,time:T.getS().timeSec});
function swipe(b,dx,{phase=null,type='touch',dy=0,id=1,between=null}={}) {
  const card=b.query('#card'),e={target:card,pointerType:type,isPrimary:true,pointerId:id,button:0,clientX:200,clientY:200};
  card.fire('pointerdown',e); if(between)between();
  return card.fire('pointerup',{...e,clientX:200+dx,clientY:200+dy});
}

test('D1新默认与旧v3缺字段兼容，备份仍为3且不改词库/学习字段',()=>{
  const b=browser(),T=setup(b),s=T.getS();
  assert.equal(s.actionKeys,undefined);
  assert.deepEqual(clone(s.settings.actionKeys),{continue:null,wait:null,return:null,listSearch:null});
  assert.deepEqual(clone(s.settings.gestures),{enabled:true,recall:{left:'dont',right:'know'},revealed:{left:'none',right:'none'}});
  assert.equal(s.settings.actionLayout,'standard');
  const old=clone(s);for(const k of ['actionKeys','gestures','actionLayout'])delete old.settings[k];
  const normalized=T.normalizeState(old);
  assert.deepEqual(clone(normalized.settings.gestures),clone(s.settings.gestures));assert.equal(normalized.settings.actionLayout,'standard');
  const exported=T.buildExport();assert.equal(exported.version,3);assert.deepEqual(clone(exported.books.kaoyan.settings.actionKeys),clone(s.settings.actionKeys));
});
test('D1归一化逐子项修复，保留合法手势、六键和独立新映射',()=>{
  const b=browser(),T=setup(b),raw=clone(T.getS());
  raw.settings.keys.know='shift+f';raw.settings.gestures={enabled:false,recall:{left:'speak',right:'bad'},revealed:{left:'next',right:'bad'}};
  raw.settings.actionLayout='bad';raw.settings.actionKeys={continue:'f',wait:'x',return:'shift+j',listSearch:'shift+f'};
  const normalized=T.normalizeState(raw).settings;
  assert.equal(normalized.keys.know,'shift+f');assert.equal(normalized.actionLayout,'standard');
  assert.deepEqual(clone(normalized.gestures),{enabled:false,recall:{left:'speak',right:'know'},revealed:{left:'next',right:'none'}});
  assert.equal(normalized.actionKeys.continue,'f');assert.equal(normalized.actionKeys.wait,'x');
  assert.equal(normalized.actionKeys.return,'shift+j');assert.equal(normalized.actionKeys.listSearch,null);
});
test('D1严格配置拒绝坏手势/未知键/上下文冲突，原子保持现场和原文',()=>{
  const b=browser(),T=setup(b),P=prefs(b),before=scene(T),disk=b.storage.get(KEY),settings=JSON.stringify(T.getS().settings);
  for(const patch of [{gestures:{enabled:true,recall:{left:'next',right:'know'},revealed:{left:'none',right:'none'}}},
    {gestures:{...clone(T.getS().settings.gestures),rogue:true}},{actionLayout:'free'},
    {actionKeys:{continue:'f',wait:'f',return:null,listSearch:null}},{keys:{...clone(T.getS().settings.keys),dont:'f'}}]) {
    assert.equal(P.applySettingsPatch(patch).ok,false);assert.equal(scene(T),before);assert.equal(b.storage.get(KEY),disk);assert.equal(JSON.stringify(T.getS().settings),settings);
  }
});
test('D1旧个人方案只补明确新增字段，读取不写回，原旧缺项和未知项仍拒绝',()=>{
  const b=browser(),T=setup(b),P=prefs(b),saved=P.saveSettingsProfile('旧输入方案',['keys']);assert.equal(saved.ok,true);
  const old=clone(saved.profile);for(const k of ['actionKeys','gestures','actionLayout'])delete old.settings[k];
  const raw=JSON.stringify({kind:P.kind,version:1,profiles:[old]});b.storage.set(P.key,raw);
  const read=P.readSettingsProfiles();assert.equal(read.ok,true);assert.equal(b.storage.get(P.key),raw);
  assert.deepEqual(clone(read.profiles[0].settings.gestures),clone(T.getS().settings.gestures));
  assert.equal(P.previewSettingsProfile(old,['keys']).ok,true);
  assert.equal(P.exportSettingsProfiles().envelope.profiles[0].settings.actionLayout,'standard');
  const missing=clone(old);delete missing.settings.keys;assert.equal(P.prepareSettingsProfilesImport({kind:P.kind,version:1,profiles:[missing]}).ok,false);
  const unknown=clone(old);unknown.settings.unknown='x';assert.equal(P.prepareSettingsProfilesImport({kind:P.kind,version:1,profiles:[unknown]}).ok,false);
});
test('D1键名统一且Shift精确优先，bare与CapsLock旧行为兼容',()=>{
  const b=browser(),T=setup(b);assert.equal(T.setInputBinding('dont','shift+f').ok,true);
  assert.equal(T.keyName('shift+f'),'Shift + F');assert.equal(T.keyName(null),'未绑定');
  b.key({key:'f',code:'KeyF'});assert.equal(T.verdict,true);T.undo();
  b.key({key:'F',code:'KeyF',shiftKey:true});assert.equal(T.verdict,false);T.undo();
  b.key({key:'F',code:'KeyF',shiftKey:false,getModifierState:k=>k==='CapsLock'});assert.equal(T.verdict,true);
});
test('D1无显式Shift时回退旧字母，Shift数字/AltGraph/Dead/229不执行',()=>{
  const b=browser(),T=setup(b);
  for(const ev of [{key:'@',code:'Digit2',shiftKey:true},{key:'f',getModifierState:k=>k==='AltGraph'},
    {key:'Dead',code:'KeyF'},{key:'Unidentified',code:'KeyF'},{key:'f',keyCode:229},{key:'f',repeat:true},{key:'f',isComposing:true}]) {
    b.key(ev);assert.equal(T.verdict,null);
  }
  b.key({key:'F',shiftKey:true,code:'KeyF'});assert.equal(T.verdict,true);
});
test('D1捕获Shift及冲突保留捕获，Ctrl浏览器组合不被preventDefault',()=>{
  const b=browser(),T=setup(b);b.keyButtons.find(x=>x.dataset.k==='dont').click();
  const ctrl=b.key({key:'r',ctrlKey:true});assert.equal(ctrl.defaultPrevented,false);assert.equal(T.getS().settings.keys.dont,'j');
  b.key({key:'f'});assert.equal(T.getS().settings.keys.dont,'j');
  b.key({key:'F',shiftKey:true});assert.equal(T.getS().settings.keys.dont,'shift+f');assert.equal(T.verdict,null);
  b.keyButtons.find(x=>x.dataset.k==='listSearch').click();b.key({key:'x'});assert.equal(T.getS().settings.actionKeys.listSearch,'x');
  b.keyButtons.find(x=>x.dataset.k==='listSearch').click();b.key({key:'Backspace'});assert.equal(T.getS().settings.actionKeys.listSearch,null);
});
test('D1上下文允许继续和判定共用，重叠动作冲突且失败不清旧映射',()=>{
  const b=browser(),T=setup(b);assert.equal(T.setInputBinding('continue','f').ok,true);
  assert.equal(T.setInputBinding('wait','f').ok,false);assert.equal(T.getS().settings.actionKeys.wait,null);
  assert.equal(T.setInputBinding('listSearch','f').ok,false);assert.equal(T.setInputBinding('return','f').ok,false);
  const disk=b.storage.get(KEY),before=scene(T);b.setFailWrites(true);
  assert.equal(T.setInputBinding('continue','x').ok,false);assert.equal(T.getS().settings.actionKeys.continue,'f');assert.equal(b.storage.get(KEY),disk);assert.equal(scene(T),before);
});
test('收尾 续组沿用键的可见名称与辅助名称一致，并随翻页键和独立绑定更新',()=>{
  const b=browser(),T=setup(b),button=b.keyButtons.find(x=>x.dataset.k==='continue');
  assert.equal(button.textContent,'沿用 空格');
  assert.ok(button.getAttribute('aria-label').includes('当前 沿用 空格'));
  assert.ok(!button.getAttribute('aria-label').includes('未绑定'));
  assert.equal(T.setInputBinding('next','k').ok,true);
  assert.equal(button.textContent,'沿用 K');
  assert.ok(button.getAttribute('aria-label').includes('当前 沿用 K'));
  assert.equal(T.setInputBinding('continue','x').ok,true);
  assert.equal(button.textContent,'X');
  assert.ok(button.getAttribute('aria-label').endsWith('当前 X'));
  assert.equal(T.resetInputBinding('continue').ok,true);
  assert.equal(button.textContent,'沿用 K');
  assert.ok(button.getAttribute('aria-label').includes('当前 沿用 K'));
});
test('D1单项恢复碰冲突拒绝，整套按键恢复不重置手势布局和单字符开关',()=>{
  const b=browser(),T=setup(b),P=prefs(b);assert.equal(T.setInputBinding('know','x').ok,true);assert.equal(T.setInputBinding('dont','f').ok,true);
  assert.equal(T.resetInputBinding('know').ok,false);assert.equal(T.getS().settings.keys.know,'x');
  const g=clone(T.getS().settings.gestures);g.recall={left:'know',right:'dont'};
  assert.equal(P.applySettingsPatch({gestures:g,actionLayout:'left',singleCharKeys:false}).ok,true);
  assert.equal(T.resetInputBindings().ok,true);assert.equal(T.getS().settings.keys.know,'f');
  assert.deepEqual(clone(T.getS().settings.actionKeys),{continue:null,wait:null,return:null,listSearch:null});
  assert.deepEqual(clone(T.getS().settings.gestures),g);assert.equal(T.getS().settings.actionLayout,'left');assert.equal(T.getS().settings.singleCharKeys,false);
});
test('D1单字符关闭不让Shift旁路，固定方向/撤销保持；输入框和选择不判定',()=>{
  const b=browser(),T=setup(b),P=prefs(b);assert.equal(T.setInputBinding('dont','shift+f').ok,true);
  assert.equal(P.applySettingsPatch({singleCharKeys:false}).ok,true);
  for(const e of [{key:'f'},{key:'F',shiftKey:true},{key:' ',code:'Space'}]){b.key(e);assert.equal(T.verdict,null);}
  b.key({key:'ArrowRight'});assert.equal(T.verdict,true);b.key({key:'z',ctrlKey:true});assert.equal(T.verdict,null);
  b.key({key:'ArrowRight',target:{tagName:'INPUT'}});assert.equal(T.verdict,null);
  b.selectText('some text');b.key({key:'ArrowRight'});assert.equal(T.verdict,null);b.selectText('');
  b.key({key:'ArrowRight'});assert.equal(T.verdict,true);
});
test('收尾 关闭字符键仍可方向判定与Enter翻页续组，松键和repeat守卫保持',()=>{
  const b=browser(),T=setup(b,{dailyNew:3,groupSize:1}),P=prefs(b);
  assert.equal(P.applySettingsPatch({singleCharKeys:false}).ok,true);
  const first=T.cur;
  b.key({key:'ArrowRight',code:'ArrowRight'});
  b.key({key:'Enter',code:'Enter'});
  assert.equal(T.cur,null);assert.equal(T.answered,1);
  assert.ok(b.query('#hint').textContent.includes('Enter'));
  const done=scene(T);
  b.key({key:'Enter',code:'Enter',repeat:true});assert.equal(scene(T),done);
  const samePress=b.key({key:'Enter',code:'Enter'});
  assert.equal(samePress.defaultPrevented,true);assert.equal(scene(T),done);
  b.fireDocument('keyup',{key:'Enter',code:'Enter'});
  b.key({key:'Enter',code:'Enter'});
  assert.notEqual(T.cur,null);assert.notEqual(T.cur,first);assert.equal(T.answered,0);assert.equal(T.verdict,null);
  assert.equal(T.getS().settings.singleCharKeys,false);
  b.key({key:'f'});b.key({key:' ',code:'Space'});assert.equal(T.verdict,null,'字符键仍关闭');
});
test('收尾 完成页Enter不接管原生按钮或summary，也不穿透输入和浮层',()=>{
  const b=browser(),T=setup(b,{dailyNew:3,groupSize:1});finish(T);const done=scene(T);
  for(const tagName of ['BUTTON','SUMMARY','INPUT','TEXTAREA','SELECT']){
    const e=b.key({key:'Enter',code:'Enter',target:{tagName}});
    assert.equal(e.defaultPrevented,false);assert.equal(scene(T),done);
  }
  T.openGuide();const before=scene(T);b.key({key:'Enter',code:'Enter'});
  assert.equal(scene(T),before);assert.equal(T.cur,null);T.closeSheet();
  b.key({key:'Enter',code:'Enter'});assert.notEqual(T.cur,null);
});
test('收尾 Enter不在空页隐式等待或加量，额度暂停不推进判定',()=>{
  const b=browser(),T=setup(b,{dailyNew:1,groupSize:1});finish(T);const done=scene(T);
  b.key({key:'Enter',code:'Enter'});assert.equal(scene(T),done,'无候选不空开组或加量');
  T.getS().settings.fmin=999999;T.startSession();const empty=scene(T);
  b.key({key:'Enter',code:'Enter'});assert.equal(scene(T),empty,'普通空页不获取等待资格');
  assert.equal(T.getAutoResumeState().waitingForDue,false);
  setup(b,{dailyNew:2,groupSize:1,due:1,cap:1,used:1});const paused=scene(T);
  b.key({key:'Enter',code:'Enter'});assert.equal(scene(T),paused);assert.equal(T.isCapPaused(),true);
});
test('收尾 完成纯新词子组或特训后Enter返回原组，不重开子组',()=>{
  const b=browser(),T=setup(b,{dailyNew:2,groupSize:1,due:1,cap:1,used:1});
  const original=T.cur;assert.equal(T.startNewOnlySubgroup(),true);finish(T);
  b.key({key:'Enter',code:'Enter'});assert.equal(T.isNewOnlySubgroup(),false);assert.equal(T.cur,original);
  assert.equal(T.getReviewLedger().used,1);
  setup(b,{dailyNew:2,groupSize:1});T.getS().progress[0]=[1,b.now-5000,1,2,b.now-86400000];
  const parent=group(T);assert.equal(T.startDrill(),true);finish(T);
  b.key({key:'Enter',code:'Enter'});assert.equal(T.drillMode,false);assert.equal(group(T),parent);
});
test('D1未判定next仍给门控，已揭示改判和撤销不叠加账本',()=>{
  const b=browser(),T=setup(b,{due:1,cap:10});const before=scene(T);
  const gate=b.key({key:'Enter'});assert.equal(T.verdict,null);assert.equal(scene(T),before);assert.equal(gate.defaultPrevented,true);
  b.key({key:'f'});const used=T.getS().reviewDay.used;assert.equal(used,1);
  b.key({key:'j'});assert.equal(T.verdict,false);assert.equal(T.getS().reviewDay.used,used);
  b.key({key:'z',ctrlKey:true});assert.equal(T.verdict,true);assert.equal(T.getS().reviewDay.used,used);
});
test('D1新搜索键进入词表保留现场；完成/等待映射仅在相应上下文执行',()=>{
  const b=browser(),T=setup(b);assert.equal(T.setInputBinding('listSearch','x').ok,true);const before=scene(T);
  b.key({key:'x'});assert.equal(b.query('#v-list').classList.contains('on'),true);assert.equal(b.document.activeElement,b.query('#q'));assert.equal(scene(T),before);
  T.show('study');assert.equal(T.setInputBinding('continue','c').ok,true);b.key({key:'c'});assert.equal(scene(T),before);
  finish(T);const after=scene(T);b.key({key:'c'});assert.equal(scene(T),after,'无入组候选不空开组');
});
test('D1真实指针默认左右、关闭和反转；鼠标/纵向/短拖动不判定',()=>{
  const b=browser(),T=setup(b),P=prefs(b);
  for(const [dx,opts] of [[100,{type:'mouse'}],[30,{}],[80,{dy:100}]]){swipe(b,dx,opts);assert.equal(T.verdict,null);}
  swipe(b,100);assert.equal(T.verdict,true);T.undo();
  const g=clone(T.getS().settings.gestures);g.enabled=false;assert.equal(P.applySettingsPatch({gestures:g}).ok,true);
  swipe(b,-100);assert.equal(T.verdict,null);g.enabled=true;g.recall={left:'know',right:'dont'};assert.equal(P.applySettingsPatch({gestures:g}).ok,true);
  swipe(b,-100);assert.equal(T.verdict,true);T.undo();swipe(b,100);assert.equal(T.verdict,false);
});
test('D1判定后手势默认不执行，可显式next/改判且同pointer仅消费一次',()=>{
  const b=browser(),T=setup(b),P=prefs(b);T.judge(true);const cur=T.cur,after=scene(T);swipe(b,100);assert.equal(scene(T),after);
  const g=clone(T.getS().settings.gestures);g.revealed={left:'dont',right:'next'};assert.equal(P.applySettingsPatch({gestures:g}).ok,true);
  swipe(b,-100);assert.equal(T.verdict,false);assert.equal(T.cur,cur);
  swipe(b,100);assert.notEqual(T.cur,cur);assert.equal(T.verdict,null);
  b.query('#card').fire('pointerup',{target:b.query('#card'),pointerType:'touch',isPrimary:true,pointerId:1,clientX:300,clientY:200});
  assert.equal(T.verdict,null);
});
test('D1手势中途映射/换阶段/浮层/选择/取消/后台失效，不补执行',()=>{
  const b=browser(),T=setup(b),P=prefs(b),card=b.query('#card');
  swipe(b,100,{between:()=>{const g=clone(T.getS().settings.gestures);g.recall.right='dont';P.applySettingsPatch({gestures:g});}});assert.equal(T.verdict,null);
  swipe(b,100,{between:()=>T.openGuide()});assert.equal(T.verdict,null);T.closeSheet();
  swipe(b,100,{between:()=>{T.judge(true);T.undo();}});assert.equal(T.verdict,null);
  swipe(b,100,{between:()=>b.selectText('selected')});assert.equal(T.verdict,null);b.selectText('');
  swipe(b,100,{between:()=>card.fire('pointercancel')});assert.equal(T.verdict,null);
  swipe(b,100,{between:()=>b.setHidden()});assert.equal(T.verdict,null);b.setVisible();
  swipe(b,100,{between:()=>card.fire('pointerdown',{target:card,pointerType:'touch',isPrimary:false,pointerId:2,clientX:200,clientY:200})});assert.equal(T.verdict,null);
});
test('D1布局/映射只改即刻偏好，不造待应用、不动学习/快照；四书与备份往返',()=>{
  const b=browser(),T=setup(b),P=prefs(b);T.judge(true);const before=scene(T),plan=JSON.stringify(T.getPlan()),pending=T.hasPendingScopeSettings();
  assert.equal(P.applySettingsPatch({actionLayout:'right',actionKeys:{continue:'c',wait:'w',return:'r',listSearch:'x'}}).ok,true);
  assert.equal(scene(T),before);assert.equal(JSON.stringify(T.getPlan()),plan);assert.equal(T.hasPendingScopeSettings(),pending);
  const old=clone(T.getS().settings);const exp=T.buildExport();assert.equal(exp.version,3);assert.equal(exp.books.kaoyan.settings.actionLayout,'right');
  T.switchBook('cet4');assert.equal(T.getS().settings.actionLayout,'right');assert.deepEqual(clone(T.getS().settings.actionKeys),old.actionKeys);
  assert.equal(T.normalizeState(exp.books.kaoyan,'kaoyan').settings.actionLayout,'right');
});
test('D1持续保存错误仍可手动判定/改判/撤销，开组/加量/等待保持阻断',()=>{
  const b=browser(),T=setup(b);b.query('#appAlert').hidden=false;
  assert.equal(T.runStudyAction('know').ok,true);assert.equal(T.verdict,true);
  assert.equal(T.runStudyAction('dont').ok,true);assert.equal(T.verdict,false);
  assert.equal(T.runStudyAction('undo').ok,true);assert.equal(T.verdict,true);
  assert.equal(T.runStudyAction('addExtraAndStudy',{amount:10}).error,'alert');
  assert.equal(T.runStudyAction('wait').error,'alert');assert.equal(T.runStudyAction('continue').error,'alert');
});
test('D1统一动作保留判定后undo/熟练指针保护，键盘与程序立即生效',()=>{
  const b=browser(),T=setup(b),point={type:'click',target:{tagName:'BUTTON'},detail:1,clientX:100,clientY:100};
  assert.equal(T.runStudyAction('know',{event:point,source:'button'}).ok,true);
  assert.equal(T.runStudyAction('undo',{event:{...point,detail:2},source:'button'}).error,'duplicate-pointer');assert.equal(T.verdict,true);
  assert.equal(T.runStudyAction('undo',{event:{...point,detail:0},source:'button'}).ok,true);assert.equal(T.verdict,null);
  const i=T.cur;assert.equal(T.runStudyAction('know',{event:point,source:'button'}).ok,true);
  assert.equal(T.runStudyAction('proficient',{event:{...point,detail:2},source:'button'}).error,'duplicate-pointer');assert.equal(T.isProficient(i),false);
  assert.equal(T.runStudyAction('proficient').ok,true);assert.equal(T.isProficient(i),true);
});
test('D1 revealed改判不重新布防连击保护，改判后立即撤销正常',()=>{
  const b=browser(),T=setup(b),point={type:'click',target:{tagName:'BUTTON'},detail:1,clientX:100,clientY:100};
  assert.equal(T.runStudyAction('dont',{event:point,source:'button'}).ok,true);
  assert.equal(T.runStudyAction('next',{event:{...point,detail:2},source:'button'}).error,'duplicate-pointer');
  b.advance(720);assert.equal(T.runStudyAction('know',{event:point,source:'button'}).ok,true);
  b.advance(10);assert.equal(T.runStudyAction('undo',{event:{...point,clientX:120},source:'button'}).ok,true);
  assert.equal(T.verdict,false);
});
console.log(`\n输入定制回归：${passed} 组通过 / ${failed} 失败`);
process.exit(failed?1:0);
