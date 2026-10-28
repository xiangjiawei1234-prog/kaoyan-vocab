/**
 * 网页内多存档、只读快照与恢复安全回归。
 * 使用独立浏览器环境运行实际 app.js，不复制业务逻辑。
 * 运行：node --max-old-space-size=512 js/test-backup-archives.mjs
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
const appSource = () => fs.readFileSync(path.join(HERE, "app.js"), "utf8");
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function browser({ initial = null, raw = null, storageThrows = false, sharedStorage = null, deferredReads = false, failKey = null } = {}) {
  let now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const registry = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const intervals = [];
  const storage = sharedStorage || new Map(initial === null ? [] : [[KEY, typeof initial === "string" ? initial : JSON.stringify(initial)]]);
  const created = [], readers = [];
  function element(tag = "div", id = "") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(), id,
      _html: "", style: {}, dataset: {}, value: "", checked: false,
      hidden: false, disabled: false, files: [], scrollTop: 0, clientHeight: 600,
      textContent: "", onclick: null, onchange: null, offsetWidth: 100,
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
      removeEventListener() {},
      async dispatch(type, data = {}) { const e = { target: el, ...data }; if (el[`on${type}`]) await el[`on${type}`](e); for (const fn of events.get(type) || []) await fn(e); },
      click() { if (el.onclick) return el.onclick({ target: el, stopPropagation() {}, preventDefault() {} }); },
      focus() { document.activeElement = el; },
      blur() { document.activeElement = null; },
      closest(selector) { if (selector === "button" && el.tagName === "BUTTON") return el; if (selector === ".row" && classes.has("row")) return el; return null; },
      appendChild() {}, remove() {}, setAttribute(name, value) { el[name] = String(value); }, removeAttribute(name) { delete el[name]; },
      getAttribute(name) { return el[name] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
      querySelectorAll(selector) { return queryAll(selector); },
      querySelector(selector) { return query(selector); },
      contains(other) { return el === other; },
      setPointerCapture() {}, releasePointerCapture() {}
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return el._html; },
      set(value) { el._html = String(value); }
    });
    return el;
  }
  const tagById = new Map();
  for (const match of indexSource.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    tagById.set(match[2], match[1]);
  }
  function query(selector) {
    if (selector === ".view.on") return views.find(x => x.classList.contains("on")) || null;
    if (!registry.has(selector)) registry.set(selector, element(tagById.get(selector.slice(1)) || "div", selector.startsWith("#") ? selector.slice(1) : ""));
    return registry.get(selector);
  }
  const views = ["study", "list", "stats", "set"].map(v => query(`#v-${v}`));
  views[0].classList.add("on");
  const nav = ["study", "list", "stats", "set"].map(v => { const b = element("button"); b.dataset.v = v; return b; });
  const keyButtons = ["know", "dont", "next", "speak", "star", "proficient"].map(k => { const b = element("button"); b.dataset.k = k; return b; });
  const closeButton = element("button");
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#helpSheet [data-close]") return [closeButton];
    if (selector === "#helpSheet button" || selector.includes("[tabindex") && selector.includes("#helpSheet")) return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  query("#helpSheet").hidden = true;
  query("#importSheet").hidden = true;
  const document = {
    querySelector: query, querySelectorAll: queryAll,
    documentElement: { dataset: {}, style: {} }, body: element("body"),
    visibilityState: "visible", activeElement: null,
    addEventListener(type, fn) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(fn); },
    createElement(tag) { const el = element(tag); created.push(el); return el; }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class Reader {
    readAsText(file) { this.result = file.text; if (deferredReads) readers.push(this); else this.onload?.({ target: this }); }
    abort() { this.aborted = true; }
  }
  const window = {
    document, addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {}
  };
  const context = vm.createContext({
    window, document, Date: ClockDate, console,
    localStorage: { getItem: k => { if (storageThrows) throw Error("storage disabled"); return storage.get(k) ?? null; }, setItem: (k, v) => { if (storageThrows || k === failKey) throw Error("storage disabled"); storage.set(k, String(v)); }, removeItem: k => storage.delete(k) },
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: Reader,
    SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now }, structuredClone: clone
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  for (const file of ["cet-words-data.js", "combined-words-data.js"]) vm.runInContext(fs.readFileSync(path.join(HERE, file), "utf8"), context, { filename: file });
  if (raw) window.WORDS_RAW = raw;
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供测试入口");
  return {
    T, window, context, registry, storage, intervals, created, query, nav, keyButtons, readers,
    get now() { return now; }, advance(ms) { now += ms; }, setFailKey(key) { failKey = key; },
    storageEvent(key) { for (const fn of windowEvents.get("storage") || []) fn({ key, newValue: storage.get(key) ?? null }); },
    key(data) { const e = { key: "", code: "", target: document.body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, preventDefault() {}, stopPropagation() {}, ...data }; for (const fn of documentEvents.get("keydown") || []) fn(e); },
    async importFile(value, size = 100) { const el = query("#file"); await el.dispatch("change", { target: { files: [{ text: typeof value === "string" ? value : JSON.stringify(value), size, name: "backup.json" }], value: "backup.json" } }); }
  };
}

const ARCHIVES_KEY = "vocab_backup_archives_v1";
const snapshot = b => JSON.stringify({state:b.T.getS(),queue:b.T.Q,cur:b.T.cur,qi:b.T.qi,phase:b.T.phase,answered:b.T.answered,plan:b.T.getPlan()});
const seed = b => { b.T.getS().stars[0] = 1; };
let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS  " + name); }

test("备份入口属于设置分区，统计页不再含备份/重置", () => {
  const stats = indexSource.slice(indexSource.indexOf('id="v-stats"'), indexSource.indexOf('id="v-set"'));
  const settings = indexSource.slice(indexSource.indexOf('id="settings-backup"'), indexSource.indexOf('id="settings-offline"'));
  for (const id of ["exp","imp","archiveList","saveArchive","rst","resetProficient","btnPrintBook","backupExportTxt"]) {
    assert.ok(settings.includes('id="'+id+'"'), id); assert.ok(!stats.includes('id="'+id+'"'), id);
  }
});
test("保存两份独立命名全书存档，不改当前组/进度/原始主键或导出时间", () => {
  const b=browser();seed(b);const before=snapshot(b),main=b.storage.get(KEY);
  assert.equal(b.T.saveBackupArchive("第一轮").ok,true);
  b.advance(1000);assert.equal(b.T.saveBackupArchive("第二轮").ok,true);
  const store=b.T.readBackupArchives();assert.equal(store.archives.length,2);
  assert.equal(new Set(store.archives.map(a=>a.id)).size,2);
  assert.deepEqual(clone(store.archives.map(a=>a.name)),["第二轮","第一轮"]);
  assert.equal(Object.keys(store.archives[0].data.books).length,4);
  assert.equal(snapshot(b),before);assert.equal(b.storage.get(KEY),main);
  assert.equal(b.storage.has("vocab_last_export_v1"),false);
  assert.equal(JSON.stringify(b.T.buildExport()).includes(ARCHIVES_KEY),false);
});
test("存档可刷新保留，不递归包含存档库；同名另存不覆盖", () => {
  const b=browser();seed(b);b.T.saveBackupArchive("同名");b.T.getS().stars[1]=1;b.T.saveBackupArchive("同名");
  const c=browser({sharedStorage:new Map(b.storage)}), a=c.T.readBackupArchives().archives;
  assert.equal(a.length,2);assert.equal(Object.keys(a[0].data.books.kaoyan.stars).length,2);
  assert.equal(Object.keys(a[1].data.books.kaoyan.stars).length,1);
  assert.ok(!JSON.stringify(a[0].data).includes("vocab-backup-archives"));
});
test("恢复先完整预览，取消不写；确认恢复复用事务并保留熟练标记", () => {
  const b=browser();seed(b);const id=b.T.saveBackupArchive("回退点").id;
  b.T.getS().stars[1]=1;const before=snapshot(b);
  assert.equal(b.T.backupArchiveAction(id,"restore"),true);
  assert.equal(snapshot(b),before);assert.equal(b.query("#importSheet").hidden,false);
  assert.ok(b.query("#importTitle").textContent.includes("回退点"));
  b.T.closeSheet();assert.equal(snapshot(b),before);
  b.T.setProficient(2,true);b.T.backupArchiveAction(id,"restore");b.query("#importConfirm").click();
  assert.equal(b.T.getS().stars[0],1);assert.equal(b.T.getS().stars[1],undefined);
  assert.equal(b.T.isProficient(2),true);assert.equal(b.T.readBackupArchives().archives.length,1);
});
test("删除确认可取消，确认后只删除选中存档", () => {
  const b=browser();seed(b);const one=b.T.saveBackupArchive("保留").id,two=b.T.saveBackupArchive("删除").id,before=snapshot(b);
  b.context.confirm=()=>false;assert.equal(b.T.backupArchiveAction(two,"delete"),false);
  assert.equal(b.T.readBackupArchives().archives.length,2);
  b.context.confirm=()=>true;assert.equal(b.T.backupArchiveAction(two,"delete"),true);
  assert.equal(b.T.readBackupArchives().archives[0].id,one);assert.equal(snapshot(b),before);
});
test("配额失败保留整个旧目录和当前学习现场", () => {
  const b=browser();seed(b);b.T.saveBackupArchive("原存档");const raw=b.storage.get(ARCHIVES_KEY),before=snapshot(b);
  b.setFailKey(ARCHIVES_KEY);assert.equal(b.T.saveBackupArchive("失败").ok,false);
  assert.equal(b.T.deleteBackupArchive(b.T.readBackupArchives().archives[0].id).ok,false);
  assert.equal(b.storage.get(ARCHIVES_KEY),raw);assert.equal(snapshot(b),before);
});
test("损坏目录原文保留，禁止新增/删除，允许救援下载", () => {
  for(const raw of ['{broken',JSON.stringify({kind:"vocab-backup-archives",version:99,archives:[]})]) {
    const b=browser({sharedStorage:new Map([[ARCHIVES_KEY,raw]])});seed(b);const before=snapshot(b);
    assert.equal(b.T.readBackupArchives().ok,false);assert.equal(b.T.saveBackupArchive("x").ok,false);
    assert.equal(b.T.deleteBackupArchive("x").ok,false);b.query("#archiveRescue").click();
    assert.equal(b.storage.get(ARCHIVES_KEY),raw);assert.equal(snapshot(b),before);
  }
});
test("空记录/超长名字拒绝，不生成不可恢复存档", () => {
  const b=browser();assert.equal(b.T.saveBackupArchive("空").ok,false);seed(b);
  assert.equal(b.T.saveBackupArchive("x".repeat(41)).ok,false);assert.equal(b.storage.has(ARCHIVES_KEY),false);
});
test("20份上限不静默淘汰，仍可下载和删除", () => {
  const b=browser();seed(b);for(let i=0;i<20;i++)assert.equal(b.T.saveBackupArchive("存档"+i).ok,true);
  const raw=b.storage.get(ARCHIVES_KEY),id=b.T.readBackupArchives().archives[0].id;
  assert.equal(b.T.saveBackupArchive("第21份").ok,false);assert.equal(b.storage.get(ARCHIVES_KEY),raw);
  assert.equal(b.T.backupArchiveAction(id,"export"),true);assert.equal(b.storage.has("vocab_last_export_v1"),false);
  assert.equal(b.T.deleteBackupArchive(id).ok,true);assert.equal(b.T.saveBackupArchive("补一份").ok,true);
});
test("多页操作读最新目录，不把旧存档复活；删除的存档不能恢复", () => {
  const shared=new Map(),a=browser({sharedStorage:shared}),b=browser({sharedStorage:shared});seed(a);seed(b);
  const one=a.T.saveBackupArchive("A").id;const two=b.T.saveBackupArchive("B").id;
  assert.equal(a.T.readBackupArchives().archives.length,2);assert.equal(a.T.deleteBackupArchive(one).ok,true);
  assert.equal(b.T.backupArchiveAction(one,"restore"),false);
  b.T.saveBackupArchive("C");assert.equal(a.T.readBackupArchives().archives.length,2);
  assert.ok(a.T.readBackupArchives().archives.some(x=>x.id===two));
  a.storageEvent(ARCHIVES_KEY);assert.ok(a.query("#archiveStatus").textContent.includes("2 / 20"));
});
test("高数据版本存档拒恢复并保留原文/当前现场，仍可下载救援", () => {
  const b=browser();seed(b);const id=b.T.saveBackupArchive("未来版本").id;
  const store=JSON.parse(b.storage.get(ARCHIVES_KEY));store.archives[0].data.books.cet4.dv=999;
  const raw=JSON.stringify(store);b.storage.set(ARCHIVES_KEY,raw);const before=snapshot(b);
  assert.equal(b.T.backupArchiveAction(id,"restore"),false);assert.equal(snapshot(b),before);
  assert.equal(b.storage.get(ARCHIVES_KEY),raw);assert.equal(b.T.backupArchiveAction(id,"export"),true);
});
test("主记录损坏时常规存档拒绝，不把损坏词书当空白保存", () => {
  const b=browser();seed(b);b.storage.set("cet6_vocab_v1","{broken");const before=snapshot(b);
  assert.equal(b.T.saveBackupArchive("不完整").ok,false);assert.equal(b.storage.has(ARCHIVES_KEY),false);
  assert.equal(b.storage.get("cet6_vocab_v1"),"{broken");assert.equal(snapshot(b),before);
});
test("名称经HTML转义，不把存档名当作页面代码", () => {
  const b=browser();seed(b);assert.equal(b.T.saveBackupArchive('<img src=x onerror="x">').ok,true);
  assert.ok(!b.query("#archiveList").innerHTML.includes('<img'));assert.ok(b.query("#archiveList").innerHTML.includes('&lt;img'));
});
console.log("网页内存档专项通过："+count+"组");
