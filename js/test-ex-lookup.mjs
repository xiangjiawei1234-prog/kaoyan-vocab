/**
 * 例句点词查义验收
 * 运行：node js/test-ex-lookup.mjs
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

function mkEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    _h: "",
    style: {},
    dataset: {},
    value: "",
    checked: false,
    textContent: "",
    hidden: true,
    files: [],
    scrollTop: 0,
    clientHeight: 600,
    onclick: null,
    _events: new Map(),
    offsetWidth: 240,
    offsetHeight: 120,
    classList: {
      _s: new Set(),
      add(...a) { a.forEach(x => this._s.add(x)); },
      remove(...a) { a.forEach(x => this._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (f) this._s.add(c); else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(type, fn) {
      if (!this._events.has(type)) this._events.set(type, []);
      this._events.get(type).push(fn);
    },
    appendChild() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute(k) { return this.dataset ? this.dataset[k.replace(/^data-/, "")] : null; },
    querySelector() { return mkEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 10, top: 10, right: 40, bottom: 30, width: 30, height: 20 }; },
    focus() {},
    blur() {}
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._h; },
    set(v) { this._h = v; }
  });
  return el;
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const els = new Map();
function ensureEl(sel) {
  if (!els.has(sel)) els.set(sel, mkEl(sel.startsWith("#") ? "div" : "div"));
  return els.get(sel);
}
globalThis.document = {
  querySelector: (s) => ensureEl(s),
  querySelectorAll: () => [],
  getElementById: (id) => ensureEl("#" + id),
  documentElement: { dataset: {} },
  activeElement: null,
  addEventListener() {},
  execCommand: () => true
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener() {},
  matchMedia: () => ({ matches: false }),
  innerWidth: 1200,
  innerHeight: 800,
  __vocab: null
};
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true
  });
} catch (_) { /* Node 自带 navigator 只读时跳过 */ }
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.HTMLElement = class {};
globalThis.Node = class {};
globalThis.Event = class {};
globalThis.CustomEvent = class {};
globalThis.getComputedStyle = () => ({});
globalThis.setInterval = () => 0;
globalThis.setTimeout = (fn) => 0;
globalThis.clearTimeout = () => {};
globalThis.confirm = () => false;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.FileReader = class {};
globalThis.SpeechSynthesisUtterance = class {};
globalThis.speechSynthesis = { cancel() {}, speak() {} };

const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
// 执行真实数据脚本，同时载入 WORD_BOOK_META 的数据版本与迁移信息。
new Function(wordsJs)();
globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;

const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");
try { new Function(appJs)(); }
catch (e) { console.error("app.js 执行失败:", e.stack || e.message); process.exit(1); }

const T = globalThis.window.__vocab;
if (!T) { console.error("未找到 window.__vocab"); process.exit(1); }
const W = T.getW();

console.log("== 1. 例句分词 ==");
{
  const parts = T.exTokens("People's lives are not the same.");
  ck(parts.some(p => p === "People's" || p === "People") || parts.includes("People's"), "撇号词保持完整", parts.join("|"));
  ck(parts.includes("lives") && parts.includes("the"), "普通词成为独立片段");
  ck(parts.filter(p => /^[A-Za-z]/.test(p)).length >= 5, "英文片段数量合理", `n=${parts.filter(p => /^[A-Za-z]/.test(p)).length}`);
  ck(T.exTokens("").length === 0, "空串返回空数组");
  ck(T.exTokens("2020 年 reform").filter(p => /^[A-Za-z]/.test(p)).join(",") === "reform", "数字中文不拆成可点词");
}

console.log("== 2. 例句 HTML ==");
{
  const html = T.exHtml("The answer is simple.");
  ck(html.includes('class="ex-word"'), "英文词带 ex-word");
  ck(html.includes('data-exw="answer"'), "携带 data-exw", html.slice(0, 120));
  ck(html.includes("The") && html.includes("simple"), "词面保留");
  ck(!/<script/i.test(html), "无脚本注入");
  const evil = T.exHtml('<img src=x onerror=alert(1)> fail');
  ck(!evil.includes("<img") && evil.includes("&lt;"), "HTML 被转义");
  const multi = T.exHtml("Don't stop — it's fine.");
  ck((multi.match(/ex-word/g) || []).length === 4, "Don't/stop/it's/fine 共 4 个可点词", multi);
  ck(!multi.includes("<strong>"), "未指定当前词时保留普通点词样式");
}

function highlightedTokens(html) {
  return Array.from(html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g))
    .filter(m => /\bclass="[^"]*\bex-current\b/.test(m[1]) && /^<strong>[\s\S]*<\/strong>$/.test(m[2]))
    .map(m => m[1].match(/\bdata-exw="([^"]*)"/)[1]);
}

console.log("== 3. 当前词与明确词形加粗 ==");
{
  const take = W.find(x => x.w === "take"), study = W.find(x => x.w === "study"), can = W.find(x => x.w === "can");
  const irregular = T.exHtml("TAKE took Taken taking takes takeover retake taker.", take);
  ck(JSON.stringify(highlightedTokens(irregular)) === JSON.stringify(["TAKE", "took", "Taken", "taking", "takes"]),
    "take 的原形与不规则/大小写词形加粗，派生词不误亮", irregular);
  const regular = T.exHtml("Study studies Studied studying students studious.", "study");
  ck(JSON.stringify(highlightedTokens(regular)) === JSON.stringify(["Study", "studies", "Studied", "studying"]),
    "study 的词库词形精确匹配，字符串参数可查当前词书", regular);
  const canned = T.exHtml("can Canada Canadian candy canned scanning CANNING cans can't.", can);
  ck(JSON.stringify(highlightedTokens(canned)) === JSON.stringify(["can", "canned", "CANNING", "cans"]),
    "can/canned 精确高亮，不误亮 Canada、scanning 或收缩词", canned);
  const plain = T.exHtml("answer answers answering answered answerer", { w: "answer", fm: "" });
  ck(highlightedTokens(plain).join(",") === "answer", "没有词形元数据时不猜测后缀");
  const variants = T.exHtml("learned learnt learner learning", { w: "learn", fm: "过去式 learned/learnt；现在分词 learning；派生词 learner" });
  ck(highlightedTokens(variants).join(",") === "learned,learnt,learning", "斜线分隔词形均可强调，非屈折标签不参与");
  const text = '<img src=x onerror=alert(1)> Study & studies "studious".';
  const safe = T.exHtml(text, study), plainSafe = T.exHtml(text);
  ck(!safe.includes("<img") && safe.includes("&lt;") && safe.includes("&amp;") && safe.includes("&quot;"),
    "高亮时仍转义原文 HTML、引号与连接符");
  ck((safe.match(/data-exw=/g) || []).length === (plainSafe.match(/data-exw=/g) || []).length,
    "加粗保留所有单词的可点查词按钮与原词面");
  ck(safe.includes('data-exlemma="study"') && !T.exHtml("students", study).includes("data-exlemma"),
    "仅明确高亮的当前词形携带原形查词标记");
}

console.log("== 4. 点词查库 ==");
{
  const iPeople = W.findIndex(x => x.w === "people");
  const iAnswer = W.findIndex(x => x.w === "answer");
  const iTime = W.findIndex(x => x.w === "time");
  ck(iPeople >= 0 && iAnswer >= 0 && iTime >= 0, "基础词条存在");

  ck(T.lookupExWord("people") === iPeople, "原形命中");
  ck(T.lookupExWord("People") === iPeople, "首字母大写命中");
  ck(T.lookupExWord("PEOPLE") === iPeople, "全大写命中");
  ck(T.lookupExWord("answers") === iAnswer, "复数 -s 还原");
  ck(T.lookupExWord("answered") === iAnswer, "过去式 -ed 还原");
  ck(T.lookupExWord("answering") === iAnswer, "进行时 -ing 还原");
  ck(T.lookupExWord("times") === iTime, "复数 times→time");
  ck(T.lookupExWord("people's") === iPeople, "所有格 's 还原");
  ck(T.lookupExWord("xyzzynotaword") === -1, "未登录词返回 -1");
  ck(T.lookupExWord("") === -1, "空 token 返回 -1");
  ck(T.lookupExWord(null) === -1, "null 返回 -1");
}

console.log("== 5. 浮层内容 ==");
{
  const iAnswer = W.findIndex(x => x.w === "answer");
  const pop = ensureEl("#exPop");
  T.showExPop("answer", null);
  ck(pop.hidden === false, "浮层打开");
  ck(pop.innerHTML.includes("answer"), "显示词头");
  ck(pop.innerHTML.includes(escText(W[iAnswer].m)) || pop.innerHTML.includes("释义") || pop.innerHTML.includes(W[iAnswer].m || "（暂无释义）"), "显示释义");
  ck(pop.innerHTML.includes("exPopDetail"), "提供详情入口");
  T.hideExPop();
  ck(pop.hidden === true, "浮层关闭");

  T.showExPop("zzzznotaword", null);
  ck(pop.innerHTML.includes("词库未收录"), "未收录提示");
  T.hideExPop();
}

function escText(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

console.log("== 6. 渲染接入 ==");
{
  const i = W.findIndex(x => x.w === "study");
  const queue = JSON.stringify(T.Q);
  T.getS().settings.showEx = true;
  T.setVerdict(null); T.setCur(i); T.judge(true);
  ck(highlightedTokens(ensureEl("#card").innerHTML).includes("studies"), "背诵答案用 study 词条高亮真实例句中的 studies");
  const wordEl = mkEl("span"); wordEl.dataset.exw = "studies"; wordEl.textContent = "studies";
  const strong = mkEl("strong"); strong.closest = selector => selector === ".ex-word" ? wordEl : null;
  let prevented = false;
  for (const listener of ensureEl("#card")._events.get("click") || []) {
    listener({ target: strong, preventDefault() { prevented = true; }, stopPropagation() {} });
  }
  ck(prevented && ensureEl("#exPop").hidden === false && ensureEl("#exPop").innerHTML.includes(escText(W[i].m)),
    "点击加粗 strong 子节点仍通过真实委托打开 study 查词释义");
  for (const [lemma, token] of [["take", "took"], ["take", "taken"], ["can", "canned"]]) {
    const entry = W.find(x => x.w === lemma);
    const rendered = T.exHtml("They " + token + ".", entry);
    const attrs = Array.from(rendered.matchAll(/<span\b([^>]*)>/g))
      .map(m => m[1]).find(a => a.includes('data-exw="' + token + '"'));
    const marked = attrs?.match(/data-exlemma="([^"]*)"/);
    const formButton = mkEl("button"); formButton.dataset.exw = token;
    if (marked) formButton.dataset.exlemma = marked[1];
    const formStrong = mkEl("strong"); formStrong.closest = selector => selector === ".ex-word" ? formButton : null;
    T.hideExPop();
    for (const listener of ensureEl("#card")._events.get("click") || []) {
      listener({ target: formStrong, preventDefault() {}, stopPropagation() {} });
    }
    const pop = ensureEl("#exPop");
    ck(marked?.[1] === lemma && !pop.hidden && pop.innerHTML.includes('<div class="ex-pop-w">' + lemma)
      && pop.innerHTML.includes(escText(entry.m)), token + " 高亮按钮点击显示 " + lemma + " 的当前词条释义");
  }
  const invalidAnchor = mkEl("button"); invalidAnchor.dataset.exlemma = "not-a-real-lemma";
  T.showExPop("answers", invalidAnchor);
  ck(ensureEl("#exPop").innerHTML.includes('<div class="ex-pop-w">answer'), "无效原形标记安全回退到普通点词查库");
  T.openWord(i);
  ck(highlightedTokens(ensureEl("#wordDetail").innerHTML).includes("studies"), "词表详情同样强调真实例句词形");
  ck(JSON.stringify(T.Q) === queue, "打开含高亮例句的详情不替换学习队列");
  const html = fs.readFileSync(path.join(HERE, "..", "index.html"), "utf8");
  ck(html.includes('id="exPop"'), "页面含浮层节点");
  const css = fs.readFileSync(path.join(HERE, "..", "css", "app.css"), "utf8");
  ck(css.includes(".ex-word") && css.includes(".ex-pop"), "含点词与浮层样式");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
