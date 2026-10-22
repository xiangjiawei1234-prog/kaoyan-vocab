/** 综合词书静态数据、生成器稳定性及真实 app.js 集成回归。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sources = ["js/words-data.js", "js/cet-words-data.js", "js/combined-words-data.js"].map(read);
const app = read("js/app.js");
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("PASS  " + name); };
function dataBox(data = sources) {
  const box = vm.createContext({ window: {} });
  data.forEach(source => vm.runInContext(source, box));
  return box.window;
}

const data = dataBox();
check("综合词书是三源去重并集，排名完整，频次/套卷数/大纲标记逐词一致", () => {
  const map = new Map();
  for (const key of ["WORDS_RAW", "WORDS_CET4", "WORDS_CET6"]) for (const t of data[key]) {
    const v = map.get(t[0]) || { f:0, c:0, ky:0 };
    v.f += t[5]; v.c += t[6]; v.ky = Math.max(v.ky, t[9]); map.set(t[0], v);
  }
  assert.equal(data.WORDS_COMBINED.length, map.size);
  const seen = new Set(), ranks = new Set();
  for (const t of data.WORDS_COMBINED) {
    assert.equal(t.length, 11);
    assert.equal(seen.has(t[0]), false); seen.add(t[0]); ranks.add(t[4]);
    const v = map.get(t[0]);
    assert.equal(t[5], v.f); assert.equal(t[6], v.c); assert.equal(t[9], v.ky);
    assert.ok(t[2]); assert.ok(t[6] <= 209);
  }
  assert.equal(ranks.size, map.size);
  assert.equal(Math.min(...ranks), 1); assert.equal(Math.max(...ranks), map.size);
  assert.equal(data.WORD_BOOK_META.combined.paperCount, 209);
});
check("综合词书优先保留考研人工释义，其他来源补充不覆盖", () => {
  const meanings = new Map(data.WORDS_RAW.map(t => [t[0], t[2]]));
  for (const t of data.WORDS_COMBINED) if (meanings.has(t[0])) assert.equal(t[2], meanings.get(t[0]));
});

function browser({ withoutCET = false, withoutCombined = false, storage = new Map() } = {}) {
  const nodes = new Map(), listeners = new Map(), blobs = [];
  const document = {};
  function element(tag = "div") {
    const classes = new Set(), attrs = new Map();
    return {
      tagName:tag.toUpperCase(), value:"", style:{}, dataset:{}, textContent:"", innerHTML:"", hidden:false,
      disabled:false, scrollTop:0, clientHeight:600, offsetWidth:100, files:[],
      classList: { add(...cs){ cs.forEach(c=>classes.add(c)); }, remove(...cs){ cs.forEach(c=>classes.delete(c)); },
        contains(c){ return classes.has(c); }, toggle(c,on){ if(on) classes.add(c); else classes.delete(c); } },
      setAttribute(k,v){attrs.set(k,String(v));}, getAttribute(k){return attrs.get(k) ?? null;}, removeAttribute(k){attrs.delete(k);},
      addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];}, closest(){return null;},
      focus(){ document.activeElement=this; }, blur(){ document.activeElement=null; }, remove(){}, appendChild(){},
      click(){return this.onclick?.({target:this,preventDefault(){},stopPropagation(){}});}
    };
  }
  const views = [];
  function $(selector) {
    if (selector === ".view.on") return views.find(v => v.classList.contains("on")) || null;
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }
  for (const v of ["study", "list", "stats", "set"]) views.push($("#v-" + v));
  views[0].classList.add("on");
  $("#fst").value = "all"; $("#fsc").value = "scope";
  Object.assign(document, {querySelector:$, querySelectorAll:s=>s===".view"?views:[], documentElement:{dataset:{}},
    body:element("body"), visibilityState:"visible", createElement:element, addEventListener(){}});
  const window = {document, innerWidth:1200,innerHeight:800, matchMedia:()=>({matches:false,addEventListener(){}}),
    addEventListener(type, fn){listeners.set(type, fn);}};
  const localStorage = { getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,String(v)), removeItem:k=>storage.delete(k) };
  const box = vm.createContext({window,document,localStorage,console,Date,
    setTimeout(){},clearTimeout(){},setInterval(){},confirm:()=>true,
    Blob:class{constructor(parts){this.parts=parts;blobs.push(this);}},URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},FileReader:class{}});
  vm.runInContext(sources[0], box);
  if (!withoutCET) vm.runInContext(sources[1], box);
  if (!withoutCombined) vm.runInContext(sources[2], box);
  vm.runInContext(app, box);
  return {T:window.__vocab,$,storage,blobs,listeners};
}
check("综合词书可切换、来源标签正确、学习和熟练记录与原书隔离", () => {
  const b = browser(), T = b.T;
  assert.equal(T.getBooks().filter(b=>b.available).length, 4);
  assert.equal(T.switchBook("combined"), true);
  assert.equal(T.getBook(), "combined");
  assert.equal(+b.$("#pmin").max, 209);
  // 默认顺序已改为随机乱序，不能依赖首张卡恰好是三书同名词；显式选 study。
  const idx = T.getW().findIndex(x => x.w === "study");
  assert.ok(idx >= 0);
  T.setCur(idx);
  const word = T.getW()[T.cur].w;
  T.judge(true);
  assert.ok(b.storage.get("combined_vocab_v1"));
  T.openWord(T.cur);
  assert.match(b.$("#wordDetail").innerHTML, /考研英语/);
  assert.match(b.$("#wordDetail").innerHTML, /英语四级/);
  assert.match(b.$("#wordDetail").innerHTML, /英语六级/);
  T.setProficient(T.cur, true);
  assert.ok(JSON.parse(b.storage.get("combined_vocab_proficient_v1"))[word]);
  T.switchBook("kaoyan");
  assert.equal(Object.keys(T.getS().progress).length, 0);
  assert.equal(Object.keys(T.getS().proficient).length, 0);
  T.switchBook("combined");
  assert.equal(T.isProficient(T.getW().findIndex(x=>x.w===word)), true);
});
check("备份包含综合词书并可全量往返，旧三书备份不覆盖综合进度", () => {
  const b = browser(), T = b.T;
  T.switchBook("combined"); T.judge(false);
  // 给备份保留一条其它书的有效记录，避免整份备份被空备份规则拒绝。
  T.switchBook("kaoyan"); T.judge(true); T.switchBook("combined");
  const own = clone(T.getS());
  b.$("#exp").click();
  const backup = JSON.parse(b.blobs.at(-1).parts.join(""));
  assert.equal(backup.version, 3);
  assert.ok(backup.books.combined);
  assert.equal(backup.activeBook,"combined");
  const restored = browser(); restored.T.importState(backup);
  assert.equal(restored.T.getBook(),"combined");
  assert.deepEqual(clone(restored.T.getS()),own);
  delete backup.books.combined; backup.activeBook="kaoyan";
  T.importState(backup);
  assert.deepEqual(clone(T.getBookState("combined")),own);
});
check("缺任一数据脚本时综合书不可用，其他词书仍可学习", () => {
  for (const options of [{withoutCET:true},{withoutCombined:true}]) {
    const {T} = browser(options);
    assert.equal(T.getBooks().find(b=>b.id==="combined").available,false);
    assert.equal(T.switchBook("combined"),false);
    assert.equal(T.getBook(),"kaoyan"); T.judge(true);
  }
});
check("生成器保留已发布索引，频次变动不重排，新词追加，删词须显式迁移", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),"combined-book-"));
  fs.mkdirSync(path.join(temp,"js"));
  const tuple = (word,f) => [word,"a","释义",0,1,f,1,"A test sentence.","fixture",0,""];
  const save = (words) => {
    fs.writeFileSync(path.join(temp,"js/words-data.js"),"window.WORDS_RAW="+JSON.stringify(words)+";");
    fs.writeFileSync(path.join(temp,"js/cet-words-data.js"),"window.WORDS_CET4="+JSON.stringify([tuple("shared",1)])+";window.WORDS_CET6="+JSON.stringify([tuple("shared",2)])+";");
  };
  const generate = (...args) => spawnSync(process.execPath,[path.join(root,"scripts/build-combined.mjs"),"--root",temp,...args],{encoding:"utf8"});
  const result = () => {
    const box = vm.createContext({window:{}});
    vm.runInContext(fs.readFileSync(path.join(temp,"js/combined-words-data.js"),"utf8"),box);
    return box.window;
  };
  try {
    save([tuple("alpha",10),tuple("beta",5)]); assert.equal(generate().status,0);
    const initial = result().WORDS_COMBINED.map(t=>t[0]);
    save([tuple("alpha",1),tuple("beta",100),tuple("gamma",200)]); assert.equal(generate().status,0);
    assert.equal(JSON.stringify(result().WORDS_COMBINED.map(t=>t[0])),JSON.stringify([...initial,"gamma"]));
    const before=fs.readFileSync(path.join(temp,"js/combined-words-data.js"),"utf8");
    assert.equal(generate().status,0); assert.equal(fs.readFileSync(path.join(temp,"js/combined-words-data.js"),"utf8"),before);
    save([tuple("beta",100),tuple("gamma",200)]); assert.notEqual(generate().status,0);
    assert.equal(generate("--allow-removals").status,0);
    const meta=result().WORD_BOOK_META.combined;
    assert.equal(meta.dataVersion,2); assert.equal(meta.previousWordCount,initial.length+1);
    assert.equal(meta.migrations[0].removed[0],initial.indexOf("alpha"));
    assert.equal(JSON.stringify(meta.migrations[0].removedWords),JSON.stringify(["alpha"]));
    assert.equal(meta.migrations[0].previousWordCount,initial.length+1);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
console.log("综合词书结果："+passed+" 组通过，0 失败");
