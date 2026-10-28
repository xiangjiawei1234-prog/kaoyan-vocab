/** Review regressions: real app.js pointer and keyboard handlers in a DOM stub. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("app.js", import.meta.url), "utf8");
const registry = new Map(), documentEvents = new Map(), windowEvents = new Map(), viewportEvents = new Map(), store = new Map();
const spoken = [], speechSynthesis = {cancel() {}, speak(utterance) { spoken.push(utterance.text); }};
let selection = "";
let document;
function element(tag = "div") {
  const classes = new Set(), events = new Map();
  const el = {
    tagName: tag.toUpperCase(), style: {}, dataset: {}, value: "", checked: false,
    hidden: false, disabled: false, textContent: "", innerHTML: "", files: [],
    scrollTop: 0, clientHeight: 520, offsetWidth: 100, parentElement: null,
    isConnected: true, focusables: [],
    classList: {
      add: (...items) => items.forEach(x => classes.add(x)),
      remove: (...items) => items.forEach(x => classes.delete(x)),
      contains: x => classes.has(x),
      toggle(x, on = !classes.has(x)) { if (on) classes.add(x); else classes.delete(x); return on; }
    },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    dispatch(type, data = {}) { for (const fn of events.get(type) || []) fn({target: el, ...data}); },
    setAttribute(name, value) { el[name] = String(value); },
    getAttribute(name) { return el[name] ?? null; },
    removeAttribute(name) { delete el[name]; },
    focus() { document.activeElement = el; }, blur() { document.activeElement = document.body; },
    querySelector(selector) { if (selector === ".sheet-panel") return el.panel ||= element(); return query(selector); },
    querySelectorAll() { return el.focusables; },
    closest(selector) {
      for (let cur = el; cur; cur = cur.parentElement) {
        if (selector.split(",").some(x => {
          const s = x.trim();
          return s === "[hidden]" ? cur.hidden : s === "[inert]" ? cur.inert : s.toUpperCase() === cur.tagName;
        })) return cur;
      }
      return null;
    },
    getClientRects() { return el.rendered === false ? [] : [{}]; },
    appendChild() {}, remove() {}, contains(other) {
      for (let node = other; node; node = node.parentElement) if (node === el) return true;
      return false;
    }
  };
  return el;
}
function query(selector) {
  if (selector === ".view.on") return views.find(x => x.classList.contains("on"));
  if (!registry.has(selector)) registry.set(selector, element());
  return registry.get(selector);
}
const views = ["study", "list", "stats", "set"].map(v => query("#v-" + v));
views[0].classList.add("on");
document = {
  querySelector: query,
  querySelectorAll: selector => selector === ".view" ? views : [],
  body: element("body"), documentElement: {dataset: {}, style: {}}, visibilityState: "visible",
  addEventListener(type, fn) { if (!documentEvents.has(type)) documentEvents.set(type, []); documentEvents.get(type).push(fn); },
  createElement: tag => element(tag)
};
document.activeElement = document.body;
query("#fst").value = "all"; query("#fsc").value = "scope";
const window = {
  document,
  addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
  visualViewport: {addEventListener(type, fn) { if (!viewportEvents.has(type)) viewportEvents.set(type, []); viewportEvents.get(type).push(fn); }},
  speechSynthesis,
  getSelection: () => ({toString: () => selection}),
  matchMedia: () => ({matches: false, addEventListener() {}}),
  WORDS_RAW: ["apple", "banana", "cherry"].map((w, i) => [w, "", "释义", 0, i + 1, 10, 3, "", "", 1, ""])
};
vm.runInNewContext(source, {
  window, document, console, structuredClone,
  localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
  setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  requestAnimationFrame: fn => fn(), confirm: () => false,
  Blob, URL: {createObjectURL: () => "blob:test", revokeObjectURL() {}}, FileReader: class {},
  speechSynthesis, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
}, {filename: "app.js"});
const T = window.__vocab, card = query("#card");
const pointer = {pointerType: "touch", isPrimary: true, button: 0, pointerId: 1, clientX: 100, clientY: 100};
function swipe(start = {}, end = {}) {
  card.dispatch("pointerdown", {...pointer, ...start});
  card.dispatch("pointerup", {...pointer, clientX: 180, ...end});
}
function reset() {
  T.getS().progress = {}; T.getS().days = {}; selection = "";
  T.startSession(); assert.equal(T.phase, "recall");
}
reset();
swipe({pointerType: "mouse"}, {pointerType: "mouse"});
assert.equal(T.phase, "recall", "鼠标拖选不判定");
swipe({isPrimary: false}); assert.equal(T.phase, "recall", "第二根手指不判定");
swipe({button: 2}); assert.equal(T.phase, "recall", "笔侧键或右键不判定");
swipe({target: element("button")}); assert.equal(T.phase, "recall", "控件上的手势不判定");
selection = "apple"; swipe(); assert.equal(T.phase, "recall", "已有文本选择不判定");
selection = "";
card.dispatch("pointerdown", pointer); selection = "apple";
card.dispatch("pointerup", {...pointer, clientX: 180});
assert.equal(T.phase, "recall", "手势中产生文本选择不判定"); selection = "";
swipe({}, {pointerId: 2}); assert.equal(T.phase, "recall", "其它指针抬起不判定");
swipe({}, {clientX: 180, clientY: 210}); assert.equal(T.phase, "recall", "竖向滚动不判定");
swipe(); assert.equal(T.verdict, true, "主触摸右滑仍可判会");
reset(); swipe({pointerType: "pen"}, {pointerType: "pen", clientX: 20});
assert.equal(T.verdict, false, "主笔尖左滑仍可判不会");
reset();
card.dispatch("pointerdown", pointer); card.dispatch("pointercancel", pointer);
card.dispatch("pointerup", {...pointer, clientX: 180});
assert.equal(T.phase, "recall", "取消的触摸不判定");

function key(data) {
  const e = {key: "", target: document.body, preventDefault() { this.prevented = true; }, ...data};
  for (const fn of documentEvents.get("keydown") || []) fn(e);
  return e;
}
T.openWord(0);
const sheet = query("#wordSheet"), first = element("button"), last = element("button");
const hiddenParent = element(), hiddenChild = element("button"), inertParent = element(), inertChild = element("button");
hiddenParent.hidden = true; hiddenChild.parentElement = hiddenParent;
inertParent.inert = true; inertChild.parentElement = inertParent;
const unrendered = element("button"); unrendered.rendered = false;
sheet.focusables = [first, last, hiddenChild, inertChild, unrendered];
last.focus(); assert.ok(key({key: "Tab"}).prevented); assert.equal(document.activeElement, first, "Tab 排除隐藏祖先/inert/未渲染控件");
first.focus(); assert.ok(key({key: "Tab", shiftKey: true}).prevented); assert.equal(document.activeElement, last, "Shift+Tab 回到最后可见控件");
T.showExPop("apple", null); assert.equal(query("#exPop").hidden, false);
key({key: "Escape"}); assert.equal(query("#exPop").hidden, true, "Escape 首先关闭例句查词");
assert.equal(sheet.hidden, false, "关闭查词不关闭详情");
key({key: "Escape"}); assert.equal(sheet.hidden, true, "再次 Escape 关闭详情");
for (const target of [document, query("#main"), card, query(".answer"), sheet.querySelector(".sheet-panel")]) {
  T.showExPop("apple", null);
  for (const fn of documentEvents.get("scroll") || []) fn({target});
  assert.equal(query("#exPop").hidden, true, "页面、卡片、答案或详情滚动后关闭过期查词");
}
const pop = query("#exPop"), popChild = element(); popChild.parentElement = pop;
T.showExPop("apple", null);
for (const target of [pop, popChild]) {
  for (const fn of documentEvents.get("scroll") || []) fn({target});
  assert.equal(pop.hidden, false, "浮层自身及内部滚动不关闭查词");
}
for (const [events, type] of [[windowEvents, "resize"], [viewportEvents, "resize"], [viewportEvents, "scroll"]]) {
  T.showExPop("apple", null);
  for (const fn of events.get(type) || []) fn({});
  assert.equal(pop.hidden, true, "窗口或可视视口变化后关闭查词");
}
reset(); T.judge(false);
const originalWord = T.getW()[T.cur].w;
T.showExPop("banana", null);
const beforeLookupKeys = JSON.stringify(T.getS()), spokenBefore = spoken.length, curBefore = T.cur;
for (const data of [{key: "m"}, {key: "f"}, {key: "j"}, {key: "s"}, {key: "z", ctrlKey: true}]) {
  key(data);
  assert.equal(JSON.stringify(T.getS()), beforeLookupKeys, "查词时学习快捷键不修改背后的学习记录");
  assert.equal(T.cur, curBefore); assert.equal(T.verdict, false);
  assert.equal(spoken.length, spokenBefore, "查词时 S 不朗读背后的当前单词");
}
assert.equal(key({key: "Tab"}).prevented, true, "查词中 Tab 在浮层内循环，不跑回背后页面");
for (const data of [{key: "Enter", target: element("button")}, {key: " ", target: element("button")}]) {
  assert.equal(key(data).prevented, undefined, "查词中保留按钮原生激活");
}
key({key: "Escape"}); assert.equal(pop.hidden, true);
key({key: "f"}); assert.equal(T.verdict, true, "关闭查词后 F 恢复改判");
key({key: "j"}); assert.equal(T.verdict, true, "关闭查词后普通判定键仍受同卡一次改判保护");
assert.equal(T.runStudyAction("dont", {source: "button"}).ok, true, "关闭查词后明确改判按钮仍可继续修改");
assert.equal(T.verdict, false);
key({key: "s"}); assert.equal(spoken.at(-1), originalWord, "关闭查词后 S 恢复发音");
key({key: "z", ctrlKey: true}); assert.equal(T.verdict, true, "关闭查词后 Ctrl+Z 恢复撤销");
key({key: "m"}); assert.equal(Boolean(T.getS().proficient[originalWord]), true, "关闭查词后 M 恢复标记熟练");
console.log("PASS interaction review: pointer safety, modal focus, popup lifecycle and shortcut isolation");
