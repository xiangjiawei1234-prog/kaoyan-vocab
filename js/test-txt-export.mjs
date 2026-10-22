/** TXT 词书导出：真实 app.js + 小型词库/浏览器桩，不复制筛选业务逻辑。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const elements = new Map(), created = [], blobs = [];
const views = ["study", "list", "stats", "set"];
function element(id = "", tag = "div") {
  const classes = new Set(), events = new Map();
  return {
    id, tagName: tag.toUpperCase(), style: {}, dataset: {}, value: "", checked: false,
    textContent: "", innerHTML: "", hidden: false, disabled: false, scrollTop: 0, clientHeight: 600,
    classList: {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
      contains: x => classes.has(x), toggle(x, on) { if (on === undefined) on = !classes.has(x); on ? classes.add(x) : classes.delete(x); }},
    addEventListener(type, fn) { events.set(type, fn); },
    dispatch(type, extra = {}) { return events.get(type)?.({target:this,...extra}); },
    setAttribute() {}, removeAttribute() {}, getAttribute() {}, focus() {}, blur() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, closest() { return null; },
    click() { this.clicked = true; return this.onclick?.({target:this}); }
  };
}
function query(sel) {
  if (sel === ".view.on") return views.map(v => query("#v-" + v)).find(x => x.classList.contains("on"));
  if (!elements.has(sel)) elements.set(sel, element(sel.slice(1)));
  return elements.get(sel);
}
query("#v-study").classList.add("on");
query("#fst").value = "all"; query("#fsc").value = "scope";
const document = {
  querySelector: query, querySelectorAll: sel => sel === ".view" ? views.map(v => query("#v-" + v)) : [],
  documentElement: {dataset:{}}, body: element("body", "body"), visibilityState:"visible",
  addEventListener() {}, createElement(tag) { const el = element("", tag); created.push(el); return el; }
};
const row = (w, f, c, p = 0, ky = 1) => [w, "", "n. 测试释义", p, f === 10 ? 1 : f === 5 ? 2 : 3, f, c, "", "", ky, ""];
const window = {
  WORDS_RAW: [row("alpha",10,3),row("beta",5,2,1),row("gamma",2,1,2,0)],
  WORDS_CET4: [row("alpha",10,3),row("theta",5,2,1)],
  WORDS_CET6: [row("omega",10,3),row("sigma",5,2,1)],
  WORD_BOOK_META: {kaoyan:{paperCount:46},cet4:{paperCount:80},cet6:{paperCount:83}},
  matchMedia: () => ({matches:false,addEventListener(){}}), addEventListener() {}
};
const storage = new Map();
const context = vm.createContext({
  window, document, console, Date, TextEncoder,
  localStorage: {getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,String(v))},
  setTimeout() {}, clearTimeout() {}, setInterval() {},
  confirm: () => false, FileReader: class {},
  Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
  URL: {createObjectURL(blob) { blobs.push(blob); return "blob:txt-test"; }, revokeObjectURL() {}}
});
vm.runInContext(fs.readFileSync(new URL("./txt-zip.js", import.meta.url), "utf8"), context);
vm.runInContext(fs.readFileSync(new URL("./app.js", import.meta.url), "utf8"), context);
const T = window.__vocab;
let passed = 0;
function test(label, run) { run(); passed++; console.log("PASS  " + label); }
function reset() {
  const S = T.getS();
  Object.assign(S.settings, {fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,dailyNew:1});
  S.proficient = {}; S.progress = {}; S.days = {};
  storage.delete(T.getStorageKeys().books[T.getBook()].prof);
  query("#q").value = ""; query("#fst").value = "all"; query("#fsc").value = "scope";
  T.startSession();
  return S;
}
test("完整范围每行一词，无标题/释义/BOM，不受每日额度截断", () => {
  reset();
  assert.equal(T.wordBookTxt(), "alpha\nbeta\ngamma\n");
});
test("组合设置控制导出范围，熟练词被排除", () => {
  const S = reset();
  S.settings.pmin = 2; S.settings.pos = ["v"]; S.settings.kyOnly = true;
  assert.equal(T.wordBookTxt(), "beta\n");
  S.proficient.beta = Date.now();
  assert.equal(T.wordBookTxt(), "");
});
test("设置导出不受词表搜索/状态影响，词表导出对应所见结果", () => {
  reset(); query("#q").value = "gamma"; query("#fst").value = "new";
  assert.equal(T.wordBookTxt(), "alpha\nbeta\ngamma\n");
  assert.equal(T.wordBookTxt("filter"), "gamma\n");
});
test("导出不改变学习队列、判定、配额或学习记录", () => {
  const S = reset(); T.judge(false);
  const before = JSON.stringify([S,T.Q,T.qi,T.cur,T.phase,T.verdict]);
  T.wordBookTxt(); T.wordBookTxt("filter"); T.exportWordBookTxt();
  assert.equal(JSON.stringify([S,T.Q,T.qi,T.cur,T.phase,T.verdict]), before);
});
test("下载文件内容/MIME/文件名正确，两个入口都连接到导出", () => {
  reset();
  query("#btnExportBookTxt").click();
  assert.equal(blobs.at(-1).parts.join(""), "alpha\nbeta\ngamma\n");
  assert.equal(blobs.at(-1).type, "text/plain;charset=utf-8");
  assert.match(created.at(-1).download, /^考研英语_背诵范围_3词_\d{4}-\d{2}-\d{2}\.txt$/);
  assert.equal(created.at(-1).clicked, true);
  query("#q").value = "beta"; query("#btnExportListTxt").click();
  assert.equal(blobs.at(-1).parts.join(""), "beta\n");
  assert.match(created.at(-1).download, /筛选结果_1词/);
});
test("空范围不会下载空文件，而是提示调整筛选", () => {
  const S = reset(); S.settings.fmin = 9999;
  const before = blobs.length;
  assert.equal(T.exportWordBookTxt(), false);
  assert.equal(blobs.length, before);
  assert.match(query("#toast").textContent, /没有可导出/);
});
test("下载前同步另一窗口最新熟练名单", () => {
  reset();
  storage.set(T.getStorageKeys().books.kaoyan.prof, JSON.stringify({alpha:Date.now()}));
  T.exportWordBookTxt();
  assert.equal(blobs.at(-1).parts.join(""), "beta\ngamma\n");
});
test("切换词书后导出当前词书，其他书数据不混入", () => {
  reset(); T.switchBook("cet4"); reset();
  assert.equal(T.wordBookTxt(), "alpha\ntheta\n");
  T.exportWordBookTxt(); assert.match(created.at(-1).download, /^英语四级_/);
  T.switchBook("cet6"); reset();
  assert.equal(T.wordBookTxt(), "omega\nsigma\n");
});
test("8000词按每份4000拆为两份，8001词余词完整保留", () => {
  const words = Array.from({length:8001}, (_,i)=>"word"+i);
  const exact = T.splitTxtWords(words.slice(0,8000), "words", 4000);
  assert.equal(exact.length,2); assert.equal(exact[0].length,4000); assert.equal(exact[1].length,4000);
  const parts = T.splitTxtWords(words,"words",4000);
  assert.equal(parts.map(x=>x.length).join(","),"4000,4000,1");
  assert.equal(parts.flat().join("\n"),words.join("\n"));
  assert.equal(new Set(parts.flat()).size,words.length);
});
test("按份数均分时不重不漏，各份最多相差一个词", () => {
  const words = Array.from({length:8000},(_,i)=>"word"+i);
  const parts = T.splitTxtWords(words,"parts",3);
  assert.equal(parts.map(x=>x.length).join(","),"2667,2667,2666");
  assert.equal(parts.flat().join("\n"),words.join("\n"));
  assert.equal(T.splitTxtWords(words,"words",9999).length,1);
  assert.equal(T.splitTxtWords([],"words",4000).length,0);
  assert.equal(T.splitTxtWords(["alpha"],"parts",1)[0][0],"alpha");
});
test("无效份数/词数被拒绝，不产生空片或异常预览", () => {
  for (const n of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>T.splitTxtWords(["alpha"],"words",n));
  }
  assert.throws(()=>T.splitTxtWords(["alpha"],"parts",2));
  assert.throws(()=>T.splitTxtWords(["alpha"],"bad",1));
  reset(); T.openTxtSplit();
  for (const value of ["", "0", "-1", "1.2", "Infinity"]) {
    query("#txtSplitAmount").value=value;
    query("#txtSplitAmount").dispatch("input");
    assert.equal(T.getTxtSplitFiles().length,0);
    assert.equal(query("#txtSplitZip").disabled,true);
    assert.equal(query("#txtSplitPrev").disabled,true);
    assert.equal(query("#txtSplitNext").disabled,true);
  }
});
test("拆分预览与逐份TXT内容/编号/词数一致，原学习状态不变", () => {
  T.switchBook("kaoyan"); const S = reset(); T.judge(false);
  const before=JSON.stringify([S,T.Q,T.qi,T.cur,T.phase,T.verdict]);
  query("#btnSplitBookTxt").click();
  query("#txtSplitAmount").value="2"; query("#txtSplitAmount").dispatch("input");
  const files=T.getTxtSplitFiles();
  assert.equal(files.length,2);
  assert.equal(files[0].text,"alpha\nbeta\n");
  assert.equal(files[0].count,2);
  assert.equal(JSON.stringify([S,T.Q,T.qi,T.cur,T.phase,T.verdict]),before);
  T.switchBook("kaoyan"); reset(); T.openTxtSplit();
  query("#txtSplitAmount").value="2"; T.renderTxtSplit();
  const kaoyan=T.getTxtSplitFiles();
  assert.equal(kaoyan.map(x=>x.count).join(","),"2,1");
  assert.equal(kaoyan.map(x=>x.text).join(""),"alpha\nbeta\ngamma\n");
  assert.match(kaoyan[0].name,/考研英语_背诵范围_第01份_1-2_2词_/);
  const beforeDownloads=blobs.length;
  query("#txtSplitFiles").dispatch("click",{target:{closest:()=>({dataset:{txtPart:"1"}})}});
  assert.equal(blobs.length,beforeDownloads+1);
  assert.equal(blobs.at(-1).parts.join(""),"gamma\n");
  assert.equal(created.at(-1).download,kaoyan[1].name);
});
test("按份数切换会更新预览，ZIP一次下载全部且仍可逐份下载", () => {
  reset(); T.openTxtSplit();
  query("#txtSplitMode").value="parts"; query("#txtSplitMode").dispatch("change");
  assert.equal(query("#txtSplitAmount").value,"2");
  assert.equal(T.getTxtSplitFiles().map(x=>x.count).join(","),"2,1");
  const before=blobs.length;
  query("#txtSplitZip").click();
  assert.equal(blobs.length,before+1);
  assert.equal(blobs.at(-1).type,"application/zip");
  const bytes=blobs.at(-1).parts[0];
  assert.equal(bytes[0],0x50); assert.equal(bytes[1],0x4b);
  assert.match(created.at(-1).download,/考研英语_背诵范围_2份_3词_.*\.zip$/);
});
test("拆分范围在预览打开时固定，搜索变化不会使各片边界漂移", () => {
  reset(); query("#q").value="beta";
  query("#btnSplitListTxt").click();
  assert.equal(T.getTxtSplitFiles()[0].text,"beta\n");
  query("#q").value="gamma"; T.applyFilter();
  query("#txtSplitAmount").value="1"; T.renderTxtSplit();
  assert.equal(T.getTxtSplitFiles()[0].text,"beta\n");
  T.closeSheet();
  assert.equal(T.getTxtSplitFiles().length,0);
  assert.equal(T.downloadTxtPart(0),false);
  assert.equal(T.downloadTxtSplitZip(),false);
});
test("切书和重新打开会丢弃旧预览，空范围不会打开拆分窗", () => {
  reset(); T.openTxtSplit(); T.switchBook("cet4");
  assert.equal(T.getTxtSplitFiles().length,0);
  reset(); T.openTxtSplit();
  assert.equal(T.getTxtSplitFiles()[0].text,"alpha\ntheta\n");
  T.closeSheet();
  T.getS().settings.fmin=9999;
  assert.equal(T.openTxtSplit(),false);
  assert.equal(T.getTxtSplitFiles().length,0);
});
test("大量分片分页呈现，ZIP仍包含全部分片", () => {
  T.switchBook("kaoyan"); reset(); T.openTxtSplit();
  // 用真实拆分逻辑生成大量片段，再由同一预览渲染器分页。
  const original=T.getW().slice();
  for (let i=0;i<50;i++) T.getW().push({w:"extra"+i,m:"n. 额外词",p:0,r:i+4,f:1,c:1,ky:0});
  T.openTxtSplit(); query("#txtSplitAmount").value="1"; T.renderTxtSplit();
  assert.equal(T.getTxtSplitFiles().length,53);
  assert.equal((query("#txtSplitFiles").innerHTML.match(/data-txt-part=/g)||[]).length,20);
  assert.equal(query("#txtSplitPager").hidden,false);
  query("#txtSplitNext").click(); assert.match(query("#txtSplitFiles").innerHTML,/第 21 份/);
  query("#txtSplitNext").click();
  assert.equal((query("#txtSplitFiles").innerHTML.match(/data-txt-part=/g)||[]).length,13);
  assert.equal(query("#txtSplitNext").disabled,true);
  T.downloadTxtSplitZip();
  assert.match(created.at(-1).download,/_53份_53词_/);
  T.getW().splice(0,T.getW().length,...original); T.closeSheet();
});
console.log(`TXT 导出结果：${passed} 通过，0 失败`);
