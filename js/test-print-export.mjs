/**
 * 打印生词本导出验收（纯逻辑，Node DOM 桩）
 * 运行：node js/test-print-export.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

// ---------------- DOM 桩 ----------------
function mkEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    _h: "",
    style: {},
    dataset: {},
    value: "",
    checked: false,
    textContent: "",
    hidden: false,
    files: [],
    scrollTop: 0,
    clientHeight: 600,
    onclick: null,
    children: [],
    selected: false,
    removed: false,
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      if (child.id) registry.set("#" + child.id, child);
    },
    remove() {
      this.removed = true;
      if (this.id && registry.get("#" + this.id) === this) registry.delete("#" + this.id);
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this);
    },
    setAttribute(name, value) { this[name] = String(value); },
    focus() { document.activeElement = this; },
    select() { this.selected = true; },
    click() {},
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._h; },
    set(v) { this._h = String(v); }
  });
  Object.defineProperty(el, "offsetWidth", { get() { return 100; } });
  return el;
}

const registry = new Map();
const createdElements = [];
function getEl(sel) {
  if (!registry.has(sel)) {
    const el = mkEl(sel.includes("input") ? "input" : sel.includes("select") ? "select" : sel.includes("button") ? "button" : "div");
    if (sel === "#v-study") el.classList.add("on");
    registry.set(sel, el);
  }
  return registry.get(sel);
}

globalThis.document = {
  querySelector: (s) => getEl(s),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (t) => { const el = mkEl(t); createdElements.push(el); return el; },
  documentElement: { dataset: {} },
  visibilityState: "visible",
  body: { appendChild() {} }
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  WORDS_RAW: null,
  print() {}
};
let store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
globalThis.setInterval = () => 0;
globalThis.setTimeout = (fn) => 0;
globalThis.clearTimeout = () => {};
globalThis.confirm = () => false;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };
getEl("#fst").value = "all";
getEl("#fsc").value = "scope";

// ---------------- 加载数据与脚本 ----------------
const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
// 执行真实数据脚本，同时载入 WORD_BOOK_META 的数据版本与迁移信息。
new Function(wordsJs)();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;

const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try {
  new Function(appJs)();
} catch (e) {
  console.error("app.js 执行失败:", e.stack || e.message);
  process.exit(1);
}
const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab 调试钩子"); process.exit(1); }

const W = T.getW();
function S() { return T.getS(); }
function clearRecords() {
  const s = S();
  s.progress = {}; s.days = {}; s.stars = {}; s.proficient = {};
}
function resetFilter() {
  const s = S();
  s.settings.fmin = 1; s.settings.fmax = 0; s.settings.pmin = 0;
  s.settings.kyOnly = false; s.settings.pos = [];
}

console.log("== 0. 首次从统计页直接导出 ==");
{
  const queueBefore = JSON.stringify({ Q: T.Q, qi: T.qi, cur: T.cur });
  T.show("stats");
  T.openPrintBook();
  ck(getEl("#printSource").value === "filter", "无错词和收藏时默认导出筛选结果");
  const first = T.renderPrintBook();
  ck(first.length > 0 && first.length === T.inScopeCount(),
    "尚未进入词表时也导出完整当前范围", `print=${first.length} scope=${T.inScopeCount()}`);
  ck(JSON.stringify({ Q: T.Q, qi: T.qi, cur: T.cur }) === queueBefore, "导出不改变学习队列");
  T.closeSheet();
}

function findIdx(w) {
  for (let i = 0; i < W.length; i++) if (W[i].w === w) return i;
  return -1;
}

// 选取互不相同的测试词条
const iA = findIdx("abandon");
const iB = findIdx("ability");
const iC = findIdx("absorb");
const iD = findIdx("absolute");
ck(iA >= 0 && iB >= 0 && iC >= 0 && iD >= 0, "测试词条存在",
  `abandon=${iA} ability=${iB} absorb=${iC} absolute=${iD}`);
if (iA < 0 || iB < 0 || iC < 0 || iD < 0) {
  console.error("缺少测试词条，终止");
  process.exit(1);
}

function seedPrintFixture() {
  clearRecords();
  resetFilter();
  const s = S();
  // A 错 2 次、第 3 档；B 错 1 次、未学（仅有错次）；C 错 3 次、第 1 档；D 无进度、仅收藏
  s.progress[iA] = [3, Date.now() + 1000, 2, 2, Date.now()];
  s.progress[iB] = [0, 0, 0, 1, 0];
  s.progress[iC] = [1, Date.now() + 1000, 1, 3, Date.now()];
  s.stars[iD] = 1;
  s.stars[iA] = 1;
}

console.log("== 1. 打印条目 · 来源=错词本 ==");
seedPrintFixture();
{
  const wrong = T.printBookEntries("wrong");
  ck(wrong.length === 3, "只收 wrong>0 的词", `len=${wrong.length}`);
  const words = wrong.map(e => e.w);
  ck(words.includes(W[iA].w) && words.includes(W[iB].w) && words.includes(W[iC].w),
    "错词 A/B/C 入选", words.join(","));
  ck(!words.includes(W[iD].w), "无错次的 D 不入错词本");
  ck(wrong[0].wrong === 3 && wrong[1].wrong === 2 && wrong[2].wrong === 1,
    "按错次降序排列", wrong.map(e => e.wrong).join(","));
}

console.log("== 2. 打印条目 · 熟练词排除 ==");
seedPrintFixture();
{
  S().proficient[W[iC].w] = Date.now();
  const wrong = T.printBookEntries("wrong");
  const words = wrong.map(e => e.w);
  ck(!words.includes(W[iC].w), "熟练错词不入错词本", words.join(","));
  ck(wrong.length === 2, "熟练排除后剩余 2 词", `len=${wrong.length}`);
}

console.log("== 3. 打印条目 · 来源=收藏 ==");
seedPrintFixture();
{
  const star = T.printBookEntries("star");
  const words = star.map(e => e.w);
  ck(star.length === 2, "收藏 2 词（A、D）", `len=${star.length}`);
  ck(words.includes(W[iA].w) && words.includes(W[iD].w), "收藏 A/D 入选", words.join(","));
  ck(star.every(e => e.star === true), "收藏条目 star=true");
  S().proficient[W[iD].w] = Date.now();
  const star2 = T.printBookEntries("star");
  ck(!star2.map(e => e.w).includes(W[iD].w), "熟练收藏词不入打印收藏列表");
}

console.log("== 4. 打印条目 · 来源=筛选结果 ==");
seedPrintFixture();
{
  getEl("#q").value = "";
  getEl("#fst").value = "wrong";
  getEl("#fsc").value = "";
  T.applyFilter();
  const filtered = T.printBookEntries("filter");
  ck(filtered.length === 3, "筛选「错词本」与 print 错词对齐",
    `len=${filtered && filtered.length}`);
  ck(filtered.every(e => e.wrong > 0), "筛选结果均为错词");
  S().progress[iD] = [0, 0, 0, 1, 0];
  const refreshed = T.printBookEntries("filter");
  ck(refreshed.length === 4 && refreshed.some(e => e.i === iD),
    "离开词表后新产生的错词也按当前筛选导出");
  delete S().progress[iD];

  getEl("#fst").value = "star";
  T.applyFilter();
  const starFiltered = T.printBookEntries("filter");
  ck(starFiltered.length === 2 && starFiltered.every(e => e.star),
    "筛选「收藏」与 print 收藏对齐", `len=${starFiltered && starFiltered.length}`);

  getEl("#fst").value = "new";
  T.applyFilter();
  const newFiltered = T.printBookEntries("filter");
  ck(newFiltered.every(e => e.status === "未学"), "筛选「未学」状态一致",
    (newFiltered[0] && newFiltered[0].status) || "empty");

  getEl("#fst").value = "";
  getEl("#fsc").value = "cold";
  T.applyFilter();
  const cold = T.printBookEntries("filter");
  const expectCold = [];
  for (let i = 0; i < W.length; i++) {
    if (T.isProficient(i)) continue;
    if (W[i].f <= 2) expectCold.push(i);
  }
  ck(cold.length === expectCold.length, "筛选「冷门」与词表一致",
    `print=${cold.length} expect=${expectCold.length}`);
  getEl("#fst").value = "";
  getEl("#fsc").value = "";
  T.applyFilter();
}

console.log("== 5. 条目字段完整性 ==");
seedPrintFixture();
{
  const wrong = T.printBookEntries("wrong");
  const e = wrong.find(x => x.w === W[iA].w) || wrong[0];
  ck(e && typeof e.i === "number", "含下标 i");
  ck(e && typeof e.w === "string" && e.w.length > 0, "含单词 w");
  ck(e && typeof e.ph === "string", "含音标 ph");
  ck(e && typeof e.m === "string" && e.m.length > 0, "含释义 m");
  ck(e && e.wrong === 2, "含错次 wrong", e && String(e.wrong));
  ck(e && typeof e.status === "string" && e.status.length > 0, "含状态 status", e && e.status);
  ck(e && e.status.indexOf("3") >= 0, "状态含档位信息", e && e.status);
}

console.log("== 6. 状态与元信息文案 ==");
{
  ck(T.printMetaText(2, "第 3 档", false) === "错 2 次 · 第 3 档",
    "错次 + 档位拼接", T.printMetaText(2, "第 3 档", false));
  ck(T.printMetaText(0, "未学", true) === "收藏 · 未学",
    "收藏 + 未学拼接", T.printMetaText(0, "未学", true));
  ck(T.printMetaText(1, "已掌握", true) === "错 1 次 · 收藏 · 已掌握",
    "三项拼接", T.printMetaText(1, "已掌握", true));
  ck(T.printMetaText(0, "未学", false) === "未学",
    "无错次无收藏只留状态", T.printMetaText(0, "未学", false));
}

console.log("== 7. Markdown 格式 ==");
seedPrintFixture();
{
  const entries = T.printBookEntries("wrong");
  const md = T.printBookMarkdown(entries, { date: "2025-10-15", sourceLabel: "错词本" });
  ck(md.indexOf("# 考研英语生词本 · 错词本") === 0, "首行为标题", md.split("\n")[0]);
  ck(md.indexOf("日期：2025-10-15") >= 0, "含日期行");
  ck(md.indexOf("共 3 词") >= 0, "含词条数", md.split("\n").slice(0, 5).join(" | "));
  ck(md.split("\n").filter(l => l.indexOf("- [ ]") === 0).length === 3,
    "每条一个复选框任务项");
  const lineA = md.split("\n").find(l => l.indexOf(W[iA].w) >= 0) || "";
  ck(lineA.indexOf("**" + W[iA].w + "**") >= 0, "单词加粗");
  ck(!W[iA].ph || lineA.indexOf("/" + W[iA].ph + "/") >= 0, "含音标斜杠", lineA);
  ck(lineA.indexOf("错 2 次") >= 0, "含错次", lineA);
  ck(lineA.indexOf(W[iA].m.slice(0, 4)) >= 0, "含释义", lineA);
}

console.log("== 8. Markdown 空列表与默认参数 ==");
{
  const md0 = T.printBookMarkdown([], { date: "2025-01-01", sourceLabel: "收藏" });
  ck(md0.indexOf("共 0 词") >= 0, "空列表写明 0 词");
  ck(md0.indexOf("· 收藏") >= 0, "来源标签写入标题");
  ck(md0.split("\n").filter(l => l.indexOf("- [ ]") === 0).length === 0, "空列表无任务项");
  const md1 = T.printBookMarkdown(T.printBookEntries("wrong"));
  ck(md1.indexOf("# 考研英语生词本") === 0, "缺省参数仍产出标题");
  ck(md1.indexOf("日期：") >= 0, "缺省参数仍产出日期");
}

console.log("== 9. renderPrintBook 产出打印结构 ==");
seedPrintFixture();
{
  getEl("#printSource").value = "wrong";
  const n = T.renderPrintBook();
  const html = getEl("#printBody").innerHTML;
  ck(Array.isArray(n) && n.length === 3, "render 返回条目", `len=${n && n.length}`);
  ck(html.indexOf("print-book") >= 0, "生成 print-book 容器");
  ck(html.indexOf("考研英语生词本") >= 0, "页眉含标题");
  ck(html.indexOf("2025") >= 0 || html.indexOf("生词本") >= 0, "页眉含日期/来源");
  ck(html.split('class="print-entry"').length - 1 === 3, "渲染 3 条词条", html.split('class="print-entry"').length - 1);
  ck(html.indexOf('type="checkbox"') >= 0, "含自测复选框");
  ck(html.indexOf(W[iC].w) >= 0, "含错次最多的词", W[iC] && W[iC].w);
}

console.log("== 10. Markdown 复制等待结果并处理权限拒绝 ==");
seedPrintFixture();
getEl("#printSource").value = "wrong";
{
  let finishCopy, copiedText;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: text => {
      copiedText = text;
      return new Promise(resolve => { finishCopy = resolve; });
    } }
  } });
  getEl("#toast").textContent = "等待结果";
  const pending = T.copyPrintMarkdown();
  ck(getEl("#toast").textContent === "等待结果", "剪贴板 Promise 未完成前不报告成功");
  finishCopy();
  const md = await pending;
  ck(copiedText === md && md.includes("共 3 词"), "等待复制完成后返回实际 Markdown");
  ck(getEl("#toast").textContent.includes("已复制为 Markdown"), "复制完成才报告成功");
}
{
  navigator.clipboard.writeText = () => Promise.reject(new Error("permission denied"));
  let fallbackCalls = 0;
  document.execCommand = command => {
    fallbackCalls++;
    const field = document.activeElement;
    ck(command === "copy" && field.tagName === "TEXTAREA" && field.selected,
      "权限拒绝后使用已聚焦且选中的文本框回退");
    return true;
  };
  const md = await T.copyPrintMarkdown();
  ck(fallbackCalls === 1, "异步拒绝触发一次复制回退");
  ck(createdElements.at(-1).value === md && createdElements.at(-1).removed,
    "回退复制正确内容并清理临时文本框");
  ck(getEl("#toast").textContent.includes("已复制为 Markdown"), "回退成功后才报告成功");
}
{
  document.execCommand = () => false;
  const md = await T.copyPrintMarkdown();
  const field = createdElements.at(-1);
  ck(field.value === md && field.selected && !field.removed && field.style.position === "static",
    "两种自动复制均失败时保留可见且选中的 Markdown");
  ck(field.parentElement === getEl("#printSheet .print-toolbar"),
    "手动复制框位于浮层内，且随打印工具栏隐藏于打印稿");
  ck(getEl("#toast").textContent.includes("Ctrl/Cmd+C") && !getEl("#toast").textContent.includes("已复制"),
    "失败时提示手动复制，不谎报成功");
  navigator.clipboard.writeText = async () => {};
  await T.copyPrintMarkdown();
  ck(field.removed, "再次复制会清理旧的手动复制框");
}

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
