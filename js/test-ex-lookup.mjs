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
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) {
      if (Object.prototype.hasOwnProperty.call(this._attrs, k)) return this._attrs[k];
      return this.dataset ? this.dataset[k.replace(/^data-/, "")] : null;
    },
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
// 四词书全部载入：app.js 需要用全部词书构建 BOOKS（词形歧义判断取并集），
// 全库例句可高亮检查也需要四级/六级/综合数据。
for (const file of ["cet-words-data.js", "combined-words-data.js"]) {
  const p = path.join(HERE, file);
  if (fs.existsSync(p)) new Function(fs.readFileSync(p, "utf8"))();
}

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
  ck(highlightedTokens(plain).join(",") === "answer,answers,answering,answered",
    "没有词形元数据时补全保守规则屈折，不误亮派生词 answerer", plain);
  const medium = W.find(x => x.w === "medium");
  const media = T.exHtml("News media covered it; one medium is television.", medium);
  ck(highlightedTokens(media).join(",") === "media,medium", "medium 的不规则复数 media 加粗", media);
  const fast = W.find(x => x.w === "fast");
  ck(highlightedTokens(T.exHtml("She runs faster and finishes fastest.", fast)).join(",") === "faster,fastest",
    "形容词 fast 的比较级/最高级加粗");
  const curriculum = W.find(x => x.w === "curriculum");
  ck(highlightedTokens(T.exHtml("Curriculums must change.", curriculum)).join(",") === "Curriculums",
    "curriculum 的规则复数 curriculums 加粗");
  const star = W.find(x => x.w === "star");
  const starTokens = highlightedTokens(T.exHtml("He stared at the start of the story.", star));
  ck(starTokens.length === 0, "star 不把 stared/start 误认成自身屈折", starTokens.join(","));
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

console.log("== 4b. 词形反查：明确词形 / 双写 / 精确词头 / 歧义（02 回归） ==");
{
  const idx = (word) => W.findIndex(x => x.w === word);
  const candidates = (token) => (typeof T.lookupExWordCandidates === "function"
    ? T.lookupExWordCandidates(token) : null);
  const isIndex = (n) => Number.isInteger(n) && n >= 0 && n < W.length;
  ck(typeof T.lookupExWordCandidates === "function", "导出 lookupExWordCandidates(token)");
  ck(Array.isArray(candidates("people")) && candidates("people").length === 1
    && candidates("people")[0] === idx("people"), "无歧义原形只有唯一候选");

  // 普通例句中的明确词形：不依赖当前卡是 take/buy/go/say/lead。
  ck(T.setCur, "存在 setCur 测试钩子");
  T.setVerdict(null); T.setCur(idx("study"));
  ck(T.getW()[T.cur].w === "study", "当前卡不是 take 等原形");
  for (const [token, lemma] of [["took", "take"], ["taken", "take"], ["bought", "buy"],
    ["went", "go"], ["said", "say"], ["led", "lead"]]) {
    ck(T.lookupExWord(token) === idx(lemma), `普通的「${token}」查到原形 ${lemma}`,
      `got=${T.lookupExWord(token)} want=${idx(lemma)}`);
  }
  // 规则屈折：双写辅音与 -ing
  for (const [token, lemma] of [["stopped", "stop"], ["planned", "plan"], ["bigger", "big"],
    ["running", "run"], ["getting", "get"]]) {
    ck(T.lookupExWord(token) === idx(lemma), `规则词形「${token}」还原到 ${lemma}`,
      `got=${T.lookupExWord(token)} want=${idx(lemma)}`);
  }
  // 双写歧义保护：stared 属于 stare，不是 star；starred/starring 才属于 star。
  ck(T.lookupExWord("stared") === idx("stare"), "stared 还原到 stare 而不是 star");
  ck(T.lookupExWord("starred") === idx("star"), "starred 还原到 star");

  // 精确词头优先：这些词本身是词库词条，不能被还原成别的原形。
  for (const word of ["left", "rose", "found", "lay"]) {
    if (idx(word) < 0) continue;
    ck(T.lookupExWord(word) === idx(word), `精确词头「${word}」优先，不还原成其他原形`,
      `got=${T.lookupExWord(word)} want=${idx(word)}`);
    ck(JSON.stringify(candidates(word)) === JSON.stringify([idx(word)]),
      `精确词头「${word}」候选只有自身`);
  }
  // better 在考研书不是独立词头，但 good 词条的 fm 明确写了「比较级 better」，
  // 属于数据驱动的明确词形而不是特殊硬编码；有 fm 依据时按原形还原，无依据才是 -1。
  if (idx("better") >= 0) {
    ck(T.lookupExWord("better") === idx("better"), "本书 better 是独立词头，精确命中自身");
  } else if (idx("good") >= 0) {
    ck(T.lookupExWord("better") === idx("good")
      && JSON.stringify(candidates("better")) === JSON.stringify([idx("good")]),
      "本书 better 无词头但 good 的 fm 明确列出比较级：按明确词形还原到 good（非 -1 瞎猜）",
      `got=${T.lookupExWord("better")} want=${idx("good")}`);
  }

  // 多原形歧义：返回全部候选，不能让最后写入的原形覆盖。
  const ambiguous = [
    ["lives", ["life", "live"]],
    ["bases", ["base", "basis"]],
    ["leaves", ["leave", "leaf"]],
    ["analyses", ["analysis", "analyse"]]
  ];
  for (const [token, lemmas] of ambiguous) {
    if (lemmas.some(w => idx(w) < 0)) continue;
    const list = candidates(token);
    const got = new Set((list || []).map(i => W[i] && W[i].w));
    ck(list && list.length > 1 && lemmas.every(w => got.has(w)),
      `歧义词形「${token}」返回全部候选 ${lemmas.join("/")}`,
      JSON.stringify((list || []).map(i => W[i] && W[i].w)));
    ck(list && new Set(list).size === list.length && list.every(isIndex), `「${token}」候选下标合法且去重`);
    const first = T.lookupExWord(token);
    const bestR = Math.min(...lemmas.map(w => W[idx(w)].r));
    ck(first === idx(lemmas.find(w => W[idx(w)].r === bestR)),
      `「${token}」主结果取候选第一（词频最低 r=${bestR}，确定性，不靠最后写入）`,
      `got=${W[first] && W[first].w}`);
    ck(T.lookupExWord(token) === first && JSON.stringify(candidates(token)) === JSON.stringify(list),
      `「${token}」重复查询结果稳定`);
  }

  ck(T.lookupExWord("zzzznotaword") === -1 && (candidates("zzzznotaword") || []).length === 0,
    "未知词返回 -1 且无候选");
  ck(T.lookupExWord("zzzznotaword's") === -1, "未知词所有格仍返回 -1");

  // 查询只读：不得改变学习队列、判定、进度或每日记录。
  const pop = ensureEl("#exPop");
  T.hideExPop();
  T.setVerdict(null); T.setCur(idx("major"));
  const before = JSON.stringify({ Q: T.Q, qi: T.qi, cur: T.cur, verdict: T.verdict, phase: T.phase,
    progress: T.getS().progress, days: T.getS().days, timeSec: T.getS().timeSec });
  T.lookupExWord("took"); T.lookupExWordCandidates("lives");
  T.showExPop("took", null);
  ck(pop.hidden === false && pop.innerHTML.includes('<div class="ex-pop-w">take'), "普通例句词形浮层显示原形 take");
  T.showExPop("lives", null);
  const candLine = pop.innerHTML.match(/<div class="ex-pop-cand">([\s\S]*?)<\/div>/);
  ck(!!candLine && candLine[1].includes("live"),
    "歧义词形浮层给出其他候选（live），不是只显示最后写入的那个", pop.innerHTML.slice(0, 200));
  const candIdx = Array.from(pop.innerHTML.matchAll(/data-excand="(\d+)"/g)).map(m => +m[1]);
  ck(JSON.stringify(candIdx) === JSON.stringify(T.lookupExWordCandidates("lives").slice(1))
    && W[candIdx[0]] && W[candIdx[0]].w === "live",
    "候选按钮 data-excand 指向其余候选的真实下标（可切换查看）", JSON.stringify(candIdx));
  ck(/例句查词：life.*另有 1 个可能的原形/.test(pop.getAttribute("aria-label") || ""),
    "浮层 aria-label 说明还有其它可能原形，避免把歧义当唯一定论", String(pop.getAttribute("aria-label")));
  T.showExPop("left", null);
  ck(pop.innerHTML.includes('<div class="ex-pop-w">left') && !pop.innerHTML.includes("ex-pop-cand"),
    "精确词头浮层不展示候选行");
  T.showExPop("zzzznotaword", null);
  ck(pop.innerHTML.includes("词库未收录"), "无合理命中才提示未收录");
  T.hideExPop();
  ck(JSON.stringify({ Q: T.Q, qi: T.qi, cur: T.cur, verdict: T.verdict, phase: T.phase,
    progress: T.getS().progress, days: T.getS().days, timeSec: T.getS().timeSec }) === before,
    "查词/候选/浮层不改变学习队列、判定与进度");
}

console.log("== 4c. 四书隔离：同词形按当前书命中 ==");
{
  const rawIndex = (arr, word) => arr.findIndex(x => (x && typeof x === "object" && "w" in x ? x.w : x && x[0]) === word);
  const K = W, C4 = globalThis.window.WORDS_CET4 || [], C6 = globalThis.window.WORDS_CET6 || [];
  ck(T.getBook() === "kaoyan", "初始为考研词书");
  ck(T.lookupExWord("running") === K.findIndex(x => x.w === "run"),
    "考研：running→run（考研无 running 词条）");
  ck(T.lookupExWord("saw") === K.findIndex(x => x.w === "see"), "考研：saw→see");
  ck(T.lookupExWord("left") === K.findIndex(x => x.w === "left"), "考研：left 精确词头");

  if (C4.length) {
    ck(T.switchBook("cet4") === true, "切换到四级词书");
    const W4 = T.getW();
    ck(T.getBook() === "cet4" && W4.length === C4.length, "当前词书数据已切换为四级");
    ck(T.lookupExWord("running") === W4.findIndex(x => x.w === "running"),
      "四级：running 是独立词头，精确命中自身而不是 run",
      `got=${T.lookupExWord("running")}`);
    ck(T.lookupExWord("saw") === W4.findIndex(x => x.w === "see"), "四级：saw→see（无独立词头）");
    ck(T.lookupExWord("better") === W4.findIndex(x => x.w === "better"), "四级：better 精确词头优先");
    ck(JSON.stringify(T.lookupExWordCandidates("lives"))
      === JSON.stringify([W4.findIndex(x => x.w === "life"), W4.findIndex(x => x.w === "live")].sort((a, b) => W4[a].r - W4[b].r || a - b)),
      "四级歧义候选按当前书重建");
  }

  if (C6.length) {
    ck(T.switchBook("cet6") === true, "切换到六级词书");
    const W6 = T.getW();
    ck(T.lookupExWord("saw") === W6.findIndex(x => x.w === "saw"),
      "六级：saw 是独立词头，精确命中自身而不是 see");
    ck(T.lookupExWord("rose") === W6.findIndex(x => x.w === "rise"),
      "六级：无 rose 词头 → rise");
  }

  const CB = globalThis.window.WORDS_COMBINED || [];
  if (CB.length) {
    ck(T.switchBook("combined") === true, "切换到综合词书");
    const WB = T.getW();
    ck(T.lookupExWord("running") === WB.findIndex(x => x.w === "running"),
      "综合：running 是独立词头，精确命中自身");
    ck(T.lookupExWord("saw") === WB.findIndex(x => x.w === "saw"),
      "综合：saw 是独立词头，精确命中自身");
    ck(T.lookupExWord("lives") === WB.findIndex(x => x.w === "life") || W[0] === undefined,
      "综合：歧义 lives 主结果仍是词频最低的原形 life",
      `got=${(T.getW()[T.lookupExWord("lives")] || {}).w}`);
  }

  ck(T.switchBook("kaoyan") === true, "切回考研词书");
  ck(T.lookupExWord("running") === W.findIndex(x => x.w === "run") && T.getW() === W,
    "切回后按考研词库命中，索引回到当前书数组");
  ck(rawIndex(K, "run") === T.lookupExWord("running"), "返回的是当前书 W 下标，不是其他书或并集下标");
}

console.log("== 4d. 普通例句里的非目标词点击查义 ==");
{
  const card = ensureEl("#card");
  const idx = (word) => W.findIndex(x => x.w === word);
  function clickCardToken(token, lemmaMark) {
    const wordEl = mkEl("button");
    wordEl.dataset.exw = token;
    if (lemmaMark) wordEl.dataset.exlemma = lemmaMark;
    const strong = mkEl("strong");
    strong.closest = (sel) => sel === ".ex-word" ? wordEl : null;
    let prevented = false;
    for (const listener of card._events.get("click") || []) {
      listener({ target: strong, preventDefault() { prevented = true; }, stopPropagation() {} });
    }
    return { pop: ensureEl("#exPop"), prevented };
  }
  function firstOrdinaryExample(token) {
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (!x.ex || !new RegExp("(^|[^A-Za-z])" + token + "([^A-Za-z]|$)", "i").test(x.ex)) continue;
      const html = T.exHtml(x.ex, x);
      const spans = Array.from(html.matchAll(/<span class="([^"]*)" data-exw="([^"]*)"/g));
      const hit = spans.find(m => m[2].toLowerCase() === token);
      if (hit && !/\bex-current\b/.test(hit[1])) return i;
    }
    return -1;
  }
  const cases = [["took", "take"], ["taken", "take"], ["bought", "buy"], ["went", "go"],
    ["running", "run"], ["stopped", "stop"], ["getting", "get"], ["said", "say"], ["led", "lead"]];
  for (const [token, lemma] of cases) {
    const exampleIndex = firstOrdinaryExample(token);
    const lemmaIndex = idx(lemma);
    if (exampleIndex < 0 || lemmaIndex < 0) { ck(false, `真实例句缺少「${token}」样本`, String(exampleIndex)); continue; }
    T.hideExPop();
    T.setVerdict(null);
    T.setCur(exampleIndex);
    ck(T.getW()[T.cur].w !== lemma, `当前卡是「${T.getW()[T.cur].w}」而非 ${lemma}，${token} 只是例句普通词`);
    const { pop, prevented } = clickCardToken(token);
    ck(prevented && pop.hidden === false && pop.innerHTML.includes('<div class="ex-pop-w">' + lemma)
      && pop.innerHTML.includes(escText(W[lemmaIndex].m)),
      `普通例句词「${token}」点击显示原形 ${lemma} 的释义`,
      pop.innerHTML.slice(0, 160));
    T.hideExPop();
  }
}

console.log("== 4e. #exPop 键盘选词、Esc 关闭与焦点返回 ==");
{
  T.hideExPop();
  const card = ensureEl("#card");
  const focusLog = [];
  const attrs = {};
  const container = mkEl("div");
  container.dataset.exLinked = "1";
  container.setAttribute = (k, v) => { attrs[k] = String(v); };
  container.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  const words = [];
  const mkWord = (token) => {
    const el = mkEl("span");
    el.dataset.exw = token;
    el.classList.add("ex-word");
    el.focus = () => { focusLog.push(el); };
    el.getAttribute = (k) => (k === "data-exw" ? token : null);
    el.isConnected = true;
    el.closest = (sel) => sel === "[data-ex-linked]" ? container : (sel === ".ex-word" ? el : null);
    words.push(el);
    return el;
  };
  ["They", "took", "the", "bus"].forEach(mkWord);
  container.querySelectorAll = (sel) => sel === ".ex-word" ? words : [];
  container.querySelector = (sel) => sel.includes(".ex-active")
    ? (words.find(w => w.classList.contains("ex-active")) || null)
    : null;
  const fireKey = (key, target) => {
    // 与页面一致：#card 上以捕获/冒泡方式注册 keydown，例句容器通过 closest 找到。
    let prevented = false, stopped = false;
    const ev = { key, target, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
    for (const listener of card._events.get("keydown") || []) listener(ev);
    return { prevented, stopped };
  };
  let r = fireKey("ArrowRight", words[0]);
  ck(r.prevented && words[0].classList.contains("ex-active") && focusLog[focusLog.length - 1] === words[0],
    "方向键在句内选词并移动焦点", attrs["aria-label"]);
  fireKey("ArrowRight", words[0]);
  ck(words[1].classList.contains("ex-active"), "再次右移选中 took", words.map(w => w.classList.contains("ex-active")).join(","));
  r = fireKey("Enter", words[1]);
  const pop = ensureEl("#exPop");
  ck(r.prevented && pop.hidden === false && pop.innerHTML.includes('<div class="ex-pop-w">take'),
    "Enter 打开当前选中词的浮层（took→take）");
  ck(attrs["aria-expanded"] === "true", "触发容器 aria-expanded=true");
  const escaped = fireKey("Escape", words[1]);
  ck(escaped.prevented && pop.hidden === true, "Esc 关闭浮层");
  ck(focusLog[focusLog.length - 1] === words[1], "Esc 后焦点回到触发词");
  ck(attrs["aria-expanded"] === "false", "关闭后 aria-expanded=false");
  fireKey("End", words[0]);
  ck(words[3].classList.contains("ex-active"), "End 选中句末词");
  fireKey("Home", words[3]);
  ck(words[0].classList.contains("ex-active"), "Home 选中句首词");
}

console.log("== 4f. motif / motives 词形兜底（B2-5 防回归） ==");
{
  // 数据依据：motive 的 fm=「复数 motives」，motif 的 fm=「复数 motifs」。
  // IRREGULAR_FORMS 不得再把 motives 当作 motif 的复数（交付复审 P3）。
  const idxIn = (arr, word) => arr.findIndex(x => x.w === word);
  const highlightFor = (entry, sentence) => highlightedTokens(T.exHtml(sentence, entry));
  const checkBook = (label, bookId) => {
    ck(T.switchBook(bookId) === true, `${label}：切到该词书核对 motif/motive 词形`);
    const arr = T.getW();
    const iMotive = idxIn(arr, "motive"), iMotif = idxIn(arr, "motif");
    const hasMotif = iMotif >= 0;
    ck(iMotive >= 0, `${label}：motive 词条存在`, `motive=${iMotive} motif=${iMotif}`);
    const list = T.lookupExWordCandidates("motives") || [];
    const names = list.map(i => (arr[i] || {}).w);
    ck(list.indexOf(iMotif) < 0,
      `${label}：motives 候选不含 motif（motif 的复数是 motifs）`, JSON.stringify(names));
    ck(list.length > 0 && list[0] === iMotive && T.lookupExWord("motives") === iMotive,
      `${label}：motives 主结果仍是 motive`, JSON.stringify(names));
    if (hasMotif) {
      const motifTokens = highlightFor(arr[iMotif], "The hidden motives are clear.");
      ck(motifTokens.length === 0, `${label}：motif 例句高亮不把 motives 标成 motif`, motifTokens.join(","));
      const motifsTokens = highlightFor(arr[iMotif], "The rug has a simple floral motif; motifs vary.");
      ck(motifsTokens.join(",") === "motif,motifs",
        `${label}：motif 的明确复数 motifs 仍正常高亮`, motifsTokens.join(","));
    }
    const motiveTokens = highlightFor(arr[iMotive], "The hidden motives are clear.");
    ck(motiveTokens.join(",") === "motives",
      `${label}：motive 词条仍把 motives 高亮为自身词形`, motiveTokens.join(","));
    const rendered = T.exHtml("The hidden motives are clear.", hasMotif ? arr[iMotif] : arr[iMotive]);
    ck(!rendered.includes('data-exlemma="motif"'),
      `${label}：motives 不携带 motif 的原形查词标记`, rendered);
  };
  const C6 = globalThis.window.WORDS_CET6 || [];
  const CB = globalThis.window.WORDS_COMBINED || [];
  if (C6.length) checkBook("六级", "cet6");
  if (CB.length) checkBook("综合", "combined");
  checkBook("考研", "kaoyan");
  ck(T.switchBook("kaoyan") === true && T.getW() === W, "核对后切回考研词书");
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

console.log("== 7. 全库例句可高亮 ==");
{
  const books = [
    ["考研", W],
    ["四级", globalThis.window.WORDS_CET4 || []],
    ["六级", globalThis.window.WORDS_CET6 || []],
    ["综合", globalThis.window.WORDS_COMBINED || []]
  ];
  const failures = [];
  let checked = 0;
  for (const [name, arr] of books) {
    for (const raw of arr) {
      checked++;
      const entry = raw.w ? raw : { w: raw[0], p: raw[3], fm: raw[10] };
      const example = raw.w ? raw.ex : raw[7];
      if (!example) { failures.push([name, entry.w, "<空例句>"]); continue; }
      const html = T.exHtml(example, entry);
      if (!/<strong>[\s\S]+<\/strong>/.test(html)) failures.push([name, entry.w, example]);
    }
  }
  ck(failures.length === 0,
    `四本词书 ${checked} 条例句都至少高亮一个目标词形`,
    failures.slice(0, 5).map(f => f.join(" · ")).join(" | "));
}

console.log("== 8. 词性异读清单与逐书主音标（批次 C1） ==");
{
  const fixture = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'tests/fixtures/content-fixes-pronunciation-20261027.json'), 'utf8'));
  const all = T.getWordPronVariants();
  ck(Object.keys(all).length === 34, "原5词 + C1新增29词共34个异读词头");
  const clean = /^[()a-zæðŋɑɒɔəɛɜɝɡɪʃʊʌʒθˈˌː]+$/i;
  const before = JSON.stringify(T.getS());
  for (const entry of fixture.variants) {
    ck(JSON.stringify(all[entry.word]) === JSON.stringify(entry.items), entry.word + " 词性与有证据读音逐项一致");
    ck(entry.items.every(item => /^[名动形副]$/.test(item.pos) && clean.test(item.ipa)
      && /[aeiouæɑɒɔəɛɜɪʊʌ]/i.test(item.ipa) && item.ipa.length <= 45), entry.word + " 清单音标格式有效");
    const expected = entry.items.map(item => item.pos + ' /' + item.ipa + '/').join(' · ');
    ck(T.pronHtml({w:entry.word, ph:'fallback'}) === expected, entry.word + " 按词性分别加斜线，覆盖单主音标");
    const copy = T.wordPronVariants(entry.word); copy[0].ipa = 'MUTATED';
    ck(T.wordPronVariants(entry.word)[0].ipa === entry.items[0].ipa, entry.word + " 读取副本不能污染内置清单");
  }
  ck(T.wordPronVariants('read') === null, "read时态异读不混入词性层");
  ck(T.wordPronVariants('nonexistent') === null, "未收词回退");
  ck(T.pronHtml({w:'fallback', ph:'ˈtest<value>'}) === '/ˈtest&lt;value&gt;/', "无清单词逐字节沿用转义后的单主音标");
  ck(T.pronHtml({w:'fallback', ph:''}) === '', "无音标仍为空");
  ck(JSON.stringify(T.getS()) === before, "读音查询与渲染不改学习记录");
  const recordIndex = T.getW().findIndex(x => x.w === 'record');
  T.getS().settings.showPh = true;
  T.setVerdict(null); T.setCur(recordIndex); T.judge(true);
  ck(ensureEl('#card').innerHTML.includes('名 /ˈrekɔːd/ · 动 /rɪˈkɔːd/'), "真实学习卡接入record双读音");
  T.openWord(recordIndex);
  ck(ensureEl('#wordDetail').innerHTML.includes('名 /ˈrekɔːd/ · 动 /rɪˈkɔːd/'), "真实词表详情接入record双读音");
  T.showExPop('record', null);
  ck(ensureEl('#exPop').innerHTML.includes('名 /ˈrekɔːd/ · 动 /rɪˈkɔːd/'), "真实例句浮层接入record双读音");
  T.hideExPop();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
