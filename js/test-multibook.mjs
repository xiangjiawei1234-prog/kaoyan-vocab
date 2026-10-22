/**
 * 多词书验收（qa-verify 独立实现，契约 4.2 / 4.3 / 4.4 / 4.5 + 既有行为回归）
 * 运行：node js/test-multibook.mjs
 * 退出码：有失败 → 1
 *
 * 做法：vm 沙箱载入 js/words-data.js + js/cet-words-data.js + 真实 js/app.js，
 * 用 DOM/浏览器桩驱动真实业务逻辑（不复制实现）。结构参考 js/test-regressions.mjs 的 browser()，
 * 但本文件独立维护，覆盖三词书注册、存储键、切换隔离、偏好携带、pmin 上限、
 * 备份 v3 导出导入往返、非法备份整份拒绝、缺 CET 数据降级、window.__vocab 新钩子，
 * 以及 task-9 的 dataVersion/migrations 进度无损迁移（合成数据 + 真实数据一致性）。
 *
 * 开发期可用 CET_DATA_FILE 指向 fixture；正式验收不设置该变量。
 * 迁移测试用 browser({ cetSourceOverride }) 注入合成 CET 数据，不依赖真实数据版本。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const wordsSource = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const CET_PATH = process.env.CET_DATA_FILE || path.join(HERE, "cet-words-data.js");
const cetSource = fs.existsSync(CET_PATH) ? fs.readFileSync(CET_PATH, "utf8") : null;
const combinedPath = path.join(HERE, "combined-words-data.js");
const combinedSource = fs.existsSync(combinedPath) ? fs.readFileSync(combinedPath, "utf8") : null;
const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cleanupAudit = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/wordbook-cleanup-20261021.json"), "utf8"));
const repairPlan = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/wordbook-repair-20261021.json"), "utf8"));
const appSource = () => fs.readFileSync(path.join(HERE, "app.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const today = now => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const STORAGE = {
  kaoyan: { state: "kaoyan_vocab_v1", prof: "kaoyan_vocab_proficient_v1", survey: "kaoyan_vocab_survey_v1" },
  cet4: { state: "cet4_vocab_v1", prof: "cet4_vocab_proficient_v1", survey: "cet4_vocab_survey_v1" },
  cet6: { state: "cet6_vocab_v1", prof: "cet6_vocab_proficient_v1", survey: "cet6_vocab_survey_v1" },
  combined: { state: "combined_vocab_v1", prof: "combined_vocab_proficient_v1", survey: "combined_vocab_survey_v1" },
};
const ACTIVE_KEY = "vocab_active_book_v1";
const BOOK_IDS = ["kaoyan", "cet4", "cet6", "combined"];
const SOURCE_BOOK_IDS = ["kaoyan", "cet4", "cet6"];
const RAW_KEYS = {kaoyan: "WORDS_RAW", cet4: "WORDS_CET4", cet6: "WORDS_CET6", combined: "WORDS_COMBINED"};

// 读取真实 CET 数据（仅用于断言 meta/词数，不参与运行）
let cetMeta = null, cetLengths = null;
if (cetSource) {
  try {
    const box = { window: {} };
    vm.createContext(box);
    vm.runInContext(wordsSource, box, { filename: "words-data.js", timeout: 30000 });
    vm.runInContext(cetSource, box, { filename: "cet-words-data.js", timeout: 30000 });
    if (combinedSource) vm.runInContext(combinedSource, box, {filename: "combined-words-data.js", timeout: 30000});
    cetMeta = box.window.WORD_BOOK_META || null;
    cetLengths = {
      kaoyan: box.window.WORDS_RAW.length,
      combined: box.window.WORDS_COMBINED?.length || 0,
      cet4: Array.isArray(box.window.WORDS_CET4) ? box.window.WORDS_CET4.length : 0,
      cet6: Array.isArray(box.window.WORDS_CET6) ? box.window.WORDS_CET6.length : 0,
    };
  } catch (e) {
    console.error(`[警告] js/cet-words-data.js 解析失败：${e.message}`);
  }
}


// ---------------------------------------------------------------------------
// 合成 CET 数据（dataVersion / migrations 迁移测试专用；不读真实数据文件）
// 结构照 task-9 契约：meta.dataVersion + migrations[{from,to,removed}] + previousWordCount
// ---------------------------------------------------------------------------
function synthTuple(word, rank, paperCount){
  return [word, "ˈsyn", "释义 " + word, 0, rank, 3, 1 + (rank % paperCount),
    "Example of " + word + ".", "四级 2020.06", rank % 2, "复数 " + word + "s"];
}
/**
 * 构造一本合成词书：旧数组 = prefix+"w0".."w{baseLen-1}"，按 steps 逐级删词。
 * steps[i] 为第 i 步（from=i+1 → to=i+2）删除的旧下标数组。
 */
function buildSynthBook({ id, name, mark, tagLabel, prefix, baseLen, steps, paperCount }){
  const oldWords = Array.from({length: baseLen}, (_, i) => prefix + "w" + i);
  let cur = oldWords.slice();
  const migrations = [];
  steps.forEach((removed, idx) => {
    const removedSet = new Set(removed);
    migrations.push({ from: idx + 1, to: idx + 2, removed: removed.slice() });
    cur = cur.filter((w, i) => !removedSet.has(i));
  });
  const words = cur.map((w, i) => synthTuple(w, i + 1, paperCount));
  const meta = {
    id: id, name: name, mark: mark, paperCount: paperCount, paperLabel: name + "真题",
    yearRange: "2019–2022", tagLabel: tagLabel,
    wordCount: words.length, previousWordCount: oldWords.length,
    dataVersion: steps.length + 1, migrations: migrations, generatedAt: "synth-fixture"
  };
  return { id: id, meta: meta, oldWords: oldWords, words: words, migrations: migrations };
}
/** 默认合成数据：四级旧 15 词删 [2,5,11] → 新 12 词；六级旧 9 词删 [1,4] → 新 7 词 */
function makeSynthCET(opts = {}){
  const c4 = buildSynthBook({ id: "cet4", name: "英语四级", mark: "四", tagLabel: "四级大纲",
    prefix: "c4", baseLen: 15, steps: opts.broken ? [[3, 1]] : [[2, 5, 11]], paperCount: 10 });
  const c6 = buildSynthBook({ id: "cet6", name: "英语六级", mark: "六", tagLabel: "六级大纲",
    prefix: "c6", baseLen: 9, steps: [[1, 4]], paperCount: 8 });
  if (opts.gap) {        // 迁移链缺 2→3：应整组忽略并回退 version 1
    c4.meta.dataVersion = 3;
    c4.meta.migrations = [{ from: 1, to: 2, removed: [2] }];
  }
  if (opts.outOfRange) { // removed 下标越界：应整组忽略并回退 version 1
    c4.meta.migrations = [{ from: 1, to: 2, removed: [2, 99] }];
  }
  const source =
    "window.WORD_BOOK_META = Object.assign(window.WORD_BOOK_META || {}, " + JSON.stringify({ cet4: c4.meta, cet6: c6.meta }) + ");\n" +
    "window.WORDS_CET4 = " + JSON.stringify(c4.words) + ";\n" +
    "window.WORDS_CET6 = " + JSON.stringify(c6.words) + ";\n";
  return { c4: c4, c6: c6, source: source };
}

// ---------------------------------------------------------------------------
// 浏览器桩
// ---------------------------------------------------------------------------
function browser({ initial = null, withoutCET = false, sharedStorage = null, storageThrows = false, raw = null, matchMediaDark = false, cetSourceOverride = null } = {}) {
  const now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const registry = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const intervals = [];
  const storage = sharedStorage || new Map();
  const created = [];
  const blobs = [];
  if (initial) {
    for (const [k, v] of Object.entries(initial)) storage.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  function element(tag = "div", id = "") {
    const events = new Map();
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(), id,
      _html: "", style: {}, dataset: {}, value: "", checked: false,
      hidden: false, disabled: false, files: [], scrollTop: 0, clientHeight: 600,
      textContent: "", onclick: null, onchange: null, oninput: null, offsetWidth: 100, max: "",
      classList: {
        add(...names) { names.forEach(n => classes.add(n)); },
        remove(...names) { names.forEach(n => classes.delete(n)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; }
      },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
      removeEventListener() {},
      async dispatch(type, data = {}) {
        const e = { target: el, currentTarget: el, ...data };
        if (el[`on${type}`]) await el[`on${type}`](e);
        for (const fn of events.get(type) || []) await fn(e);
      },
      click() {
        const e = { target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
        let ret;
        if (el.onclick) ret = el.onclick(e);
        for (const fn of events.get("click") || []) ret = fn(e) ?? ret;
        return ret;
      },
      focus() { document.activeElement = el; },
      blur() { document.activeElement = null; },
      closest(selector) { if (selector === "button" && el.tagName === "BUTTON") return el; if (selector === ".row" && classes.has("row")) return el; return null; },
      appendChild() {}, remove() {},
      setAttribute(name, value) { el[name] = String(value); },
      removeAttribute(name) { delete el[name]; },
      getAttribute(name) { return el[name] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      contains(other) { return el === other; },
      setPointerCapture() {}, releasePointerCapture() {},
    };
    Object.defineProperty(el, "innerHTML", { get() { return el._html; }, set(value) { el._html = String(value); } });
    return el;
  }
  const tagById = new Map();
  for (const match of indexSource.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) tagById.set(match[2], match[1]);
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
  const themeButtons = ["auto", "light", "dark"].map(t => { const b = element("button"); b.dataset.theme = t; return b; });
  function queryAll(selector) {
    if (selector === ".view") return views;
    if (selector === ".nav button") return nav;
    if (selector === ".keybtn") return keyButtons;
    if (selector === "#themeSeg button") return themeButtons;
    if (selector.startsWith("#helpSheet")) return [closeButton];
    if (selector.includes("[data-close]")) return [closeButton];
    return [];
  }
  query("#fst").value = "all";
  query("#fsc").value = "scope";
  query("#helpSheet").hidden = true;
  query("#wordSheet").hidden = true;
  query("#printSheet").hidden = true;
  query("#bookSheet").hidden = true;
  const document = {
    querySelector: query, querySelectorAll: queryAll, title: "",
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
    readAsText(file) { this.result = file.text; this.onload?.({ target: this }); }
    readAsDataURL() { this.onload?.({ target: this }); }
  }
  class BlobStub {
    constructor(parts, options) { this.parts = parts || []; this.options = options || {}; blobs.push(this); }
  }
  const window = {
    document,
    location: { href: "http://127.0.0.1:8765/index.html", hash: "" },
    innerWidth: 1280, innerHeight: 800,
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    matchMedia: () => ({ matches: matchMediaDark, addEventListener() {}, addListener() {} }),
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    scrollTo() {}, print() {},
    navigator: { language: "zh-CN" },
    localStorage: null,
  };
  const localStorageStub = {
    getItem: k => { if (storageThrows) throw Error("storage disabled"); return storage.get(k) ?? null; },
    setItem: (k, v) => { if (storageThrows) throw Error("storage disabled"); storage.set(k, String(v)); },
    removeItem: k => { if (storageThrows) throw Error("storage disabled"); storage.delete(k); },
    clear: () => { if (storageThrows) throw Error("storage disabled"); storage.clear(); },
  };
  window.localStorage = localStorageStub;
  const context = vm.createContext({
    window, document, Date: ClockDate, console,
    localStorage: localStorageStub,
    setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
    confirm: () => true,
    Blob: BlobStub,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    FileReader: Reader,
    SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {} },
    performance: { now: () => now }, structuredClone: clone,
    navigator: window.navigator,
    alert() {}, prompt() {},
  });
  vm.runInContext(wordsSource, context, { filename: "words-data.js" });
  if (raw) window.WORDS_RAW = raw;
  if (!withoutCET) {
    const loadedCET = cetSourceOverride || cetSource;
    if (!loadedCET) throw new Error(`缺少词书数据文件 ${path.relative(ROOT, CET_PATH)}`);
    vm.runInContext(loadedCET, context, { filename: "cet-words-data.js" });
  }
  if (!withoutCET && !cetSourceOverride && !raw && combinedSource) {
    vm.runInContext(combinedSource, context, {filename: "combined-words-data.js"});
  }
  vm.runInContext(appSource(), context, { filename: "app.js" });
  const T = window.__vocab;
  assert.ok(T, "app.js 应提供 window.__vocab 测试钩子");
  return {
    T, window, context, registry, storage, intervals, created, blobs, query, queryAll, nav, keyButtons, views,
    get now() { return now; },
    storageKeys() { return [...storage.keys()].sort(); },
    stateOf(bookId) {
      const rawState = storage.get(STORAGE[bookId].state);
      return rawState ? JSON.parse(rawState) : null;
    },
    profOf(bookId) {
      const rawProf = storage.get(STORAGE[bookId].prof);
      return rawProf ? JSON.parse(rawProf) : null;
    },
    snapshot() {
      const out = {};
      for (const k of [...storage.keys()].sort()) out[k] = storage.get(k);
      return JSON.stringify(out);
    },
    memorySnapshot() {
      const books = {};
      for (const id of BOOK_IDS) {
        const st = T.getBookState?.(id);
        if (st) books[id] = JSON.stringify(st);
      }
      return JSON.stringify({ book: T.getBook(), books });
    },
    storageEvent(key, newValue) {
      const value = newValue !== undefined ? newValue : (storage.get(key) ?? null);
      for (const fn of windowEvents.get("storage") || []) {
        fn({ key, newValue: value, oldValue: null, storageArea: localStorageStub, url: window.location.href });
      }
    },
    key(data) {
      const e = { key: "", code: "", target: document.body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, preventDefault() {}, stopPropagation() {}, ...data };
      for (const fn of documentEvents.get("keydown") || []) fn(e);
    },
    async importFile(value, size = 100) {
      const el = query("#file");
      await el.dispatch("change", { target: { files: [{ text: typeof value === "string" ? value : JSON.stringify(value), size, name: "backup.json" }], value: "backup.json" } });
    },
  };
}

// ---------------------------------------------------------------------------
// 断言辅助
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
const failures = [];
const ONLY = process.env.ONLY || "";
const rssMB = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const started = Date.now();
  console.log(`[start] ${name}  rss=${rssMB()}MB`);
  try { await fn(); passed++; console.log(`PASS  ${name}  (${Date.now() - started}ms, rss=${rssMB()}MB)`); }
  catch (error) {
    failed++; failures.push({ name, message: error.message });
    console.log(`FAIL  ${name}: ${error.message}  (${Date.now() - started}ms, rss=${rssMB()}MB)`);
  }
}
const stripTags = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function elText(b, selector) {
  const el = b.query(selector);
  return stripTags(`${el.textContent || ""} ${el.innerHTML || ""}`);
}
function fullScope(b, { dailyNew = 10, order = "freq" } = {}) {
  const S = b.T.getS();
  Object.assign(S.settings, { fmin: 1, fmax: 0, pmin: 0, kyOnly: false, pos: [], order, dailyNew });
  S.progress = {}; S.days = {}; S.stars = {}; S.proficient = {};
  b.T.startSession();
  return S;
}
function requireHooks(b, names) {
  for (const name of names) assert.equal(typeof b.T[name], "function", `缺少 __vocab.${name}()`);
}
const NEW_HOOKS = ["getBook", "getBooks", "switchBook", "getBookState", "getStorageKeys", "normalizeState", "importState", "wilsonInterval", "surveyStats", "getSurvey", "resetSurvey"];
const OLD_HOOKS = ["judge", "tryNext", "undo", "startSession", "nextCard", "applyComboFilters", "inScope", "inScopeCount", "masteredCount", "scopedMasteredCount", "countDue", "buildQueue", "isProficient", "setProficient", "resetProficient", "proficientCount", "applyFilter", "show", "openWord", "closeSheet", "getStorageOK", "getS", "getW", "setCur", "setVerdict", "wrongWordIndices", "applyDrill", "startDrill", "exitDrill", "heatLevel", "heatmapData", "exTokens", "exHtml", "lookupExWord", "showExPop", "hideExPop", "renderPrintBook", "openPrintBook", "copyPrintMarkdown"];

function requireCET() {
  assert.ok(cetSource, `缺少 ${path.relative(ROOT, CET_PATH)}；无法测试三词书（可用 CET_DATA_FILE 做开发期 fixture）`);
}
function bookIdsOf(b) { return b.T.getBooks().map(x => x.id); }
function booksMap(b) { const out = {}; for (const x of b.T.getBooks()) out[x.id] = x; return out; }

// 从导出 Blob 中取备份 JSON
function exportBackup(b) {
  requireHooks(b, ["getBooks"]);
  const before = b.blobs.length;
  b.query("#exp").click();
  assert.ok(b.blobs.length > before, "点击 #exp 后应创建 Blob（导出备份）");
  const blob = b.blobs[b.blobs.length - 1];
  const text = blob.parts.map(p => typeof p === "string" ? p : String(p)).join("");
  return JSON.parse(text);
}

// ===========================================================================
// A. 注册 / 默认 / 钩子
// ===========================================================================
await test("A1 默认词书为考研，四本书全部注册且可用", () => {
  requireCET();
  const b = browser();
  requireHooks(b, NEW_HOOKS);
  assert.equal(b.T.getBook(), "kaoyan", "空存储时默认考研");
  const books = b.T.getBooks();
  assert.equal(books.length, BOOK_IDS.length, `应注册 ${BOOK_IDS.length} 本书，实际 ${books.length}`);
  assert.equal(JSON.stringify(books.map(x => x.id)), JSON.stringify(BOOK_IDS), "UI 顺序应为 考研/四级/六级/综合");
  const map = booksMap(b);
  for (const [id, name] of [["kaoyan", "考研英语"], ["cet4", "英语四级"], ["cet6", "英语六级"], ["combined", "综合词书"]]) {
    assert.ok(map[id], `缺少词书 ${id}`);
    assert.equal(map[id].available, true, `${id} 应为可用`);
    assert.equal(map[id].name, name, `${id} 名称`);
    assert.ok(Number.isInteger(map[id].words) && map[id].words > 0, `${id}.words 应为正整数`);
    assert.ok(Number.isInteger(map[id].paperCount) && map[id].paperCount > 0, `${id}.paperCount 应为正整数`);
  }
  assert.equal(map.kaoyan.words, b.window.WORDS_RAW.length, "考研 words 数应等于 WORDS_RAW");
  assert.equal(map.kaoyan.paperCount, 46, "考研 paperCount 应为 46");
  assert.equal(map.cet4.words, cetLengths.cet4, "四级 words 数应等于 WORDS_CET4");
  assert.equal(map.cet6.words, cetLengths.cet6, "六级 words 数应等于 WORDS_CET6");
  assert.equal(map.combined.words, cetLengths.combined, "综合 words 数应等于 WORDS_COMBINED");
  assert.equal(map.combined.paperCount, 209, "综合范围为三种考试共209套真题");
  assert.equal(map.cet4.paperCount, cetMeta.cet4.paperCount, "四级 paperCount 应取 WORD_BOOK_META");
  assert.equal(map.cet6.paperCount, cetMeta.cet6.paperCount, "六级 paperCount 应取 WORD_BOOK_META");
});

await test("A2 非法或缺失的当前词书值回退考研", () => {
  requireCET();
  for (const bad of ["bogus", "cet5", "", "kaoyan ", "null"]) {
    const b = browser({ initial: { [ACTIVE_KEY]: bad } });
    assert.equal(b.T.getBook(), "kaoyan", `active=${JSON.stringify(bad)} 时应回退考研`);
    assert.equal(b.T.getW().length, b.window.WORDS_RAW.length, "考研 W 长度应等于 WORDS_RAW");
    assert.equal(b.T.getW()[0].w, b.window.WORDS_RAW[0][0], "考研 W 首词应一致");
  }
  const b = browser({ initial: { [ACTIVE_KEY]: "cet4" } });
  assert.equal(b.T.getBook(), "cet4", "合法值 cet4 应生效");
});

await test("A3 getStorageKeys 返回契约键名", () => {
  requireCET();
  const b = browser();
  const keys = b.T.getStorageKeys();
  assert.ok(keys && typeof keys === "object", "getStorageKeys() 应返回对象");
  assert.equal(keys.active, ACTIVE_KEY);
  assert.ok(keys.books && typeof keys.books === "object");
  for (const id of BOOK_IDS) {
    assert.ok(keys.books[id], `缺少 books.${id}`);
    assert.equal(keys.books[id].state, STORAGE[id].state, `${id} state 键`);
    assert.equal(keys.books[id].prof, STORAGE[id].prof, `${id} prof 键`);
    assert.equal(keys.books[id].survey, STORAGE[id].survey, `${id} survey 键`);
  }
});

await test("A3b 乱序随机抽样按词书隔离，样本存独立键", () => {
  requireCET();
  const b = browser();
  const keys = b.T.getStorageKeys();
  for (const id of BOOK_IDS) assert.equal(keys.books[id].survey, STORAGE[id].survey, `${id} survey 键`);
  fullScope(b, { order: "shuffle", dailyNew: 5 });
  const iKy = b.T.cur;
  const wKy = b.T.getW()[iKy].w;
  b.T.judge(true);
  assert.equal(b.T.getSurveyStats().n, 1, "考研乱序首答计入样本");
  assert.equal(JSON.parse(b.storage.get(STORAGE.kaoyan.survey))[wKy], 1, "样本写入考研 survey 键");
  assert.equal(JSON.parse(b.storage.get(STORAGE.kaoyan.state)).progress && Object.keys(JSON.parse(b.storage.get(STORAGE.kaoyan.state)).progress).length >= 1, true, "主进度正常写入");
  assert.equal(b.storage.get(STORAGE.cet4.survey), undefined, "不得误写四级 survey 键");

  b.T.switchBook("cet4");
  assert.equal(b.T.getSurveyStats().n, 0, "切到四级不继承考研样本");
  fullScope(b, { order: "shuffle", dailyNew: 5 });
  b.T.judge(true);
  assert.equal(b.T.getSurveyStats().n, 1, "四级独立抽样");
  b.T.switchBook("kaoyan");
  assert.equal(b.T.getSurveyStats().n, 1, "切回考研样本保留");

  // 非乱序模式不累计
  const S2 = b.T.getS();
  S2.settings.order = "freq";
  b.T.startSession();
  const nBefore = b.T.getSurveyStats().n;
  b.T.judge(true);
  assert.equal(b.T.getSurveyStats().n, nBefore, "非乱序不计入抽样");
});

await test("A4 旧 __vocab 钩子全部保留（老测试兼容）", () => {
  requireCET();
  const b = browser();
  requireHooks(b, OLD_HOOKS);
  for (const name of ["getS", "getW"]) assert.ok(b.T[name], `缺少 ${name}`);
  assert.equal(typeof b.T.getS(), "object");
  assert.ok(Array.isArray(b.T.getW()) && b.T.getW().length > 0);
});

// ===========================================================================
// B. 存储键 / 隔离
// ===========================================================================
await test("B1 切换后判定写入本级键，不污染考研键", () => {
  requireCET();
  const b = browser();
  const kyBefore = b.T.getS();
  kyBefore.progress = {}; kyBefore.days = {};
  b.T.startSession();
  b.T.judge(true); // 写考研
  const kyStorage = JSON.parse(b.storage.get(STORAGE.kaoyan.state));
  const kyProgressCount = Object.keys(kyStorage.progress).length;
  assert.ok(kyProgressCount > 0, "考研学习后应有进度");

  assert.equal(b.T.switchBook("cet4"), true, "switchBook('cet4') 应返回 true");
  assert.equal(b.T.getBook(), "cet4");
  assert.equal(b.storage.get(ACTIVE_KEY), "cet4", "当前词书应持久化到 vocab_active_book_v1");
  assert.equal(STORAGE.kaoyan.state, "kaoyan_vocab_v1", "考研存储键不得改名");
  // 切换本身不得改写考研进度
  assert.equal(JSON.parse(b.storage.get(STORAGE.kaoyan.state)).progress && Object.keys(JSON.parse(b.storage.get(STORAGE.kaoyan.state)).progress).length, kyProgressCount);
  const S4 = fullScope(b, { dailyNew: 5 });
  const i4 = b.T.cur;
  assert.ok(i4 != null, "四级应能开始学习");
  b.T.judge(true);
  assert.ok(b.storage.get(STORAGE.cet4.state), "应以 cet4_vocab_v1 保存");
  const cet4Stored = JSON.parse(b.storage.get(STORAGE.cet4.state));
  assert.deepEqual(Object.keys(cet4Stored.progress), [String(i4)], "四级进度只记录四级词索引");
  // 熟练键
  b.T.setProficient(i4, true);
  assert.ok(b.storage.get(STORAGE.cet4.prof), "应以 cet4_vocab_proficient_v1 保存熟练");
  assert.equal(b.storage.get(STORAGE.kaoyan.prof), undefined, "不得误写考研熟练键");
});

await test("B2 三书学习进度互相隔离，切回后各自保留", () => {
  requireCET();
  const b = browser();
  const pick = {};
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    const S = fullScope(b, { dailyNew: 3 });
    const i = b.T.cur;
    assert.ok(i != null, `${id} 应有可学词`);
    b.T.judge(true);
    pick[id] = { i, W: b.T.getW().length };
    assert.ok(S.progress[i], `${id} 进度已记录`);
  }
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    const S = b.T.getS();
    assert.deepEqual(Object.keys(S.progress), [String(pick[id].i)], `${id} 进度不应混入其他书 (${JSON.stringify(Object.keys(S.progress))})`);
    assert.equal(S.proficient && Object.keys(S.proficient).length, 0, `${id} 熟练名单不应被别的书影响`);
  }
  // 当前书状态与 getBookState 一致
  const st = b.T.getBookState("cet4");
  assert.ok(st && typeof st === "object", "getBookState('cet4') 应返回状态对象");
  assert.equal(b.T.getBookState("nope"), null, "未知词书应返回 null");
});

await test("B3 熟练名单按书隔离，只写当前书的 prof 键", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 3 });
  const i = b.T.cur, word = b.T.getW()[i].w;
  b.T.setProficient(i, true);
  assert.equal(b.T.isProficient(i), true);
  assert.deepEqual(Object.keys(b.profOf("cet4")), [word], "四级熟练键只含四级词");
  b.T.switchBook("kaoyan");
  assert.equal(b.T.isProficient(b.T.getW().findIndex(x => x.w === word)), false, "考研不应继承四级熟练标记");
  assert.equal(b.T.getS().proficient && Object.keys(b.T.getS().proficient).length, 0);
  b.T.switchBook("cet4");
  assert.equal(b.T.isProficient(i), true, "切回四级熟练仍在");
});

await test("B4 多次切换后四本数据都保存在各自键位", () => {
  requireCET();
  const b = browser();
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    fullScope(b, { dailyNew: 2 });
    b.T.judge(true);
    b.T.switchBook(id === "kaoyan" ? "cet4" : "kaoyan");
  }
  for (const id of BOOK_IDS) {
    assert.ok(b.storage.get(STORAGE[id].state), `缺少 ${id} 的状态键`);
    const st = JSON.parse(b.storage.get(STORAGE[id].state));
    assert.ok(Object.keys(st.progress).length >= 1, `${id} 进度已保存`);
  }
  assert.equal(b.T.getBook(), "kaoyan", "最后一次从综合书切回考研");
});

// ===========================================================================
// C. 偏好携带 / 学习设置独立 / pmin 上限 / UI 文案
// ===========================================================================
await test("C1 切换时携带主题与按键等纯 UI 偏好，学习设置各书独立", () => {
  requireCET();
  const b = browser();
  Object.assign(b.T.getS().settings, {
    theme: "dark", keys: { know: "x", dont: "j", next: " ", speak: "s", star: "b", proficient: "m" },
    showPh: false, showEx: false, showFm: false, autoSpk: true,
    dailyNew: 7, order: "wrong", pmin: 10, fmin: 5, kyOnly: true,
  });
  b.T.switchBook("cet4");
  const s4 = b.T.getS().settings;
  assert.equal(s4.theme, "dark", "theme 应携带");
  assert.equal(s4.keys.know, "x", "keys 应携带");
  assert.equal(s4.showPh, false, "showPh 应携带");
  assert.equal(s4.showEx, false, "showEx 应携带");
  assert.equal(s4.showFm, false, "showFm 应携带");
  assert.equal(s4.autoSpk, true, "autoSpk 应携带");
  assert.equal(s4.dailyNew, 20, "dailyNew 属于学习设置，不应携带（应为默认 20）");
  assert.equal(s4.order, "shuffle", "order 不应携带（默认随机乱序）");
  assert.equal(s4.pmin, 2, "pmin 不应携带（默认 2）");
  assert.equal(s4.fmin, 1, "fmin 不应携带");
  assert.equal(s4.kyOnly, false, "kyOnly 不应携带");
  b.T.switchBook("cet6");
  assert.equal(b.T.getS().settings.theme, "dark", "六级也应携带主题");
  b.T.switchBook("kaoyan");
  const sk = b.T.getS().settings;
  assert.equal(sk.dailyNew, 7, "切回考研学习设置保留");
  assert.equal(sk.order, "wrong");
  assert.equal(sk.pmin, 10);
});

await test("C2 pmin 上限按书：考研 46 / 四级、六级取各自 paperCount", () => {
  requireCET();
  const b = browser();
  assert.equal(b.T.normalizeState({ settings: { pmin: 999 }, progress: {}, days: {} }).settings.pmin, 46, "考研 pmin 上限必须仍为 46");
  assert.equal(b.T.normalizeState({ settings: { pmin: 999 }, progress: {}, days: {} }, "cet4").settings.pmin, cetMeta.cet4.paperCount, "四级 pmin 上限=paperCount");
  assert.equal(b.T.normalizeState({ settings: { pmin: 999 }, progress: {}, days: {} }, "cet6").settings.pmin, cetMeta.cet6.paperCount, "六级 pmin 上限=paperCount");
  assert.equal(b.T.normalizeState({ settings: { pmin: 999 }, progress: {}, days: {} }, "bogus").settings.pmin, 46, "未知书回退考研口径（或按当前书）");
  // 当前书省略第二参
  b.T.switchBook("cet4");
  assert.equal(b.T.normalizeState({ settings: { pmin: 999 }, progress: {}, days: {} }).settings.pmin, cetMeta.cet4.paperCount, "第二参数缺省=当前书");
  // DOM 上限属性
  b.T.switchBook("kaoyan");
  assert.equal(String(b.query("#pmin").max), "46", "#pmin.max 考研应为 46");
  b.T.switchBook("cet4");
  assert.equal(String(b.query("#pmin").max), String(cetMeta.cet4.paperCount), "#pmin.max 应随四级更新");
  b.T.switchBook("cet6");
  assert.equal(String(b.query("#pmin").max), String(cetMeta.cet6.paperCount), "#pmin.max 应随六级更新");
});

await test("C3 切换后品牌/标题/词频说明等文案动态更新", () => {
  requireCET();
  const b = browser();
  const expect = {
    kaoyan: ["考研英语", "研"],
    cet4: ["英语四级", "四"],
    cet6: ["英语六级", "六"],
    combined: ["综合词书", "综"],
  };
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    const [name, mark] = expect[id];
    const brand = elText(b, "#brandTitle");
    const markText = elText(b, "#brandMark");
    assert.ok(brand.includes(name), `#brandTitle 应含「${name}」，实际 ${JSON.stringify(brand)}`);
    assert.ok(markText.includes(mark), `#brandMark 应含「${mark}」，实际 ${JSON.stringify(markText)}`);
    assert.ok(String(b.window.document.title).includes(name), `document.title 应含「${name}」，实际 ${JSON.stringify(b.window.document.title)}`);
  }
  b.T.switchBook("cet4");
  const kyLabel = elText(b, "#kyOnlyLabel");
  assert.ok(kyLabel.includes("四级"), `#kyOnlyLabel 应含「四级」，实际 ${JSON.stringify(kyLabel)}`);
  const fRange = elText(b, "#fRangeDesc");
  assert.ok(fRange.includes("四级") || fRange.includes(String(cetMeta.cet4.paperCount)), `#fRangeDesc 应随四级更新，实际 ${JSON.stringify(fRange)}`);
  b.T.switchBook("kaoyan");
  assert.ok(elText(b, "#kyOnlyLabel").includes("考研"), "#kyOnlyLabel 考研文案");
});

await test("C4 词书选择浮层 #btnBooks/#bookSheet/#bookList 存在且可开关", () => {
  requireCET();
  const b = browser();
  assert.equal(b.T.getBooks().length, BOOK_IDS.length);
  assert.ok(b.query("#btnBooks"), "缺少 #btnBooks");
  assert.ok(b.query("#bookSheet"), "缺少 #bookSheet");
  assert.ok(b.query("#bookList"), "缺少 #bookList");
  b.query("#btnBooks").click();
  assert.equal(b.query("#bookSheet").hidden, false, "点击 #btnBooks 应打开 #bookSheet");
  const listText = elText(b, "#bookList");
  for (const name of ["考研英语", "英语四级", "英语六级"]) {
    assert.ok(listText.includes(name), `#bookList 应列出「${name}」，实际 ${JSON.stringify(listText.slice(0, 200))}`);
  }
  // Esc 关闭
  b.key({ key: "Escape", code: "Escape" });
  assert.equal(b.query("#bookSheet").hidden, true, "Esc 应关闭词书浮层");
  // 再次打开后用 data-close 关闭
  b.query("#btnBooks").click();
  const closers = b.queryAll("#bookSheet [data-close]");
  for (const el of closers) el.click();
  assert.equal(b.query("#bookSheet").hidden, true, "关闭按钮应关闭词书浮层");
});

// ===========================================================================
// D. 导入导出
// ===========================================================================
await test("D1 v3 导出结构正确（app/version/activeBook/books/dv 字段齐全）", () => {
  requireCET();
  const b = browser();
  fullScope(b, { dailyNew: 2 });
  b.T.judge(true);
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 2 });
  b.T.judge(false);
  b.T.switchBook("cet4");
  const backup = exportBackup(b);
  assert.equal(backup.app, "kaoyan-vocab", "app 字段");
  assert.equal(backup.version, 3, "version 应为 3（task-9 备份 v3）");
  assert.equal(backup.activeBook, "cet4", "activeBook 应为当前书");
  assert.ok(backup.exportedAt && !Number.isNaN(Date.parse(backup.exportedAt)), "exportedAt 应为 ISO 时间");
  assert.ok(backup.books && typeof backup.books === "object");
  assert.deepEqual(Object.keys(backup.books).sort(), BOOK_IDS.slice().sort(), "应导出全部可用词书");
  for (const id of BOOK_IDS) {
    const st = backup.books[id];
    assert.ok(st && typeof st === "object", `books.${id} 缺失`);
    for (const f of ["settings", "progress", "days", "stars", "proficient"]) {
      assert.ok(st[f] && typeof st[f] === "object", `books.${id}.${f} 应为对象`);
    }
    assert.ok(Number.isInteger(st.dv) && st.dv >= 1, `books.${id}.dv 应为数据版本整数`);
    assert.ok(Number.isInteger(st.timeSec), `books.${id}.timeSec 应为整数`);
  }
  assert.ok(Object.keys(backup.books.kaoyan.progress).length >= 1, "考研进度应导出");
  assert.ok(Object.keys(backup.books.cet4.progress).length >= 1, "四级进度应导出");
});

await test("D2 v3 全量导出导入往返：三书状态（含 dv）与当前书完全保真", () => {
  requireCET();
  const a = browser();
  // 考研：判定 + 收藏
  fullScope(a, { dailyNew: 3 });
  const ik = a.T.cur; a.T.judge(true);
  a.T.getS().stars[a.T.Q[1] ?? ik] = 1;
  a.T.getS().settings.dailyNew = 9;
  // 四级：判定 + 熟练
  a.T.switchBook("cet4"); fullScope(a, { dailyNew: 3 });
  const i4 = a.T.cur; a.T.judge(false); a.T.setProficient(a.T.Q[1] ?? i4, true);
  a.T.getS().settings.theme = "dark";
  // 六级：只改设置
  a.T.switchBook("cet6"); a.T.getS().settings.order = "shuffle";
  a.T.switchBook("cet4");
  const backup = exportBackup(a);
  const before = {
    book: a.T.getBook(),
    ky: clone(a.T.getBookState("kaoyan")),
    c4: clone(a.T.getBookState("cet4")),
    c6: clone(a.T.getBookState("cet6")),
  };
  const b = browser({ initial: { [ACTIVE_KEY]: "kaoyan" } });
  b.T.importState(backup);
  assert.equal(b.T.getBook(), "cet4", "导入后应切到备份中的 activeBook");
  assert.deepEqual(clone(b.T.getBookState("kaoyan")), before.ky, "考研状态往返保真");
  assert.deepEqual(clone(b.T.getBookState("cet4")), before.c4, "四级状态往返保真");
  assert.deepEqual(clone(b.T.getBookState("cet6")), before.c6, "六级状态往返保真");
  assert.equal(b.T.getBookState("cet4").settings.theme, "dark", "四级主题已恢复");
});

await test("D3 旧 v2 备份（无 dv）导入保留已有熟练标记（并集），不丢本机记录", () => {
  requireCET();
  const a = browser();
  a.T.switchBook("cet4");
  fullScope(a, { dailyNew: 3 });
  const wNew = a.T.getW()[a.T.Q[1] ?? a.T.cur].w;
  const backup = {
    app: "kaoyan-vocab", version: 2, exportedAt: new Date().toISOString(), activeBook: "cet4",
    books: { cet4: { settings: {}, progress: {}, days: {}, stars: {}, proficient: { [wNew]: Date.now() }, timeSec: 0 } },
  };
  const b = browser();
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 3 });
  const wLocal = b.T.getW()[b.T.Q[1] ?? b.T.cur].w;
  b.T.setProficient(b.T.getW().findIndex(x => x.w === wLocal), true);
  const localProf = clone(b.profOf("cet4"));
  assert.ok(localProf[wLocal], "本机已有熟练标记");
  b.T.importState(backup);
  const prof = b.profOf("cet4");
  assert.ok(prof[wLocal], "导入后本机熟练标记应保留");
  assert.ok(prof[wNew], "导入的熟练标记应合入");
});

await test("D4 旧 v2 备份缺某本书时该书保持不动；activeBook 非法则保持当前书", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet6");
  fullScope(b, { dailyNew: 3 });
  b.T.judge(true);
  const c6Before = clone(b.T.getBookState("cet6"));
  const backup = {
    app: "kaoyan-vocab", version: 2, exportedAt: new Date().toISOString(), activeBook: "cet9",
    books: {
      kaoyan: { settings: { dailyNew: 5 }, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 },
      cet4: { settings: { dailyNew: 6 }, progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0 },
    },
  };
  b.T.importState(backup);
  assert.equal(b.T.getBook(), "cet6", "非法 activeBook 应保持当前书");
  assert.deepEqual(clone(b.T.getBookState("cet6")), c6Before, "备份中没有的书应保持不动");
  assert.equal(b.T.getBookState("kaoyan").settings.dailyNew, 5, "备份中的书应合入");
  assert.equal(b.T.getBookState("cet4").settings.dailyNew, 6);
});

await test("D5 非法 v2 整份拒绝且零改动（内存 + localStorage 全量比对）", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 3 });
  b.T.judge(true);
  b.T.setProficient(b.T.cur, true);
  b.T.switchBook("cet6");
  const memBefore = b.memorySnapshot();
  const diskBefore = b.snapshot();
  const bads = [
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: { kaoyan: { settings: {}, progress: { 0: [1, 0, 1, 0] }, days: {} } } },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: { cet4: { progress: { [999999]: [1, 0, 1, 0, 0] }, days: {} } } },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: { cet6: { days: { "2023-02-29": { n: 1, r: 1, ok: 1, no: 0 } } } } },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: { cet6: { proficient: { people: 0 } } } },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: "not-object" },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: null },
    { app: "kaoyan-vocab", version: 2, activeBook: "cet4", books: { cet4: { settings: { keys: { know: "<img src=x onerror=alert(1)>" } } } } },
  ];
  for (const bad of bads) {
    let threw = false;
    try { b.T.importState(bad); } catch (e) { threw = true; }
    assert.ok(threw || b.memorySnapshot() === memBefore, `非法备份应被拒绝：${JSON.stringify(bad).slice(0, 80)}`);
  }
  assert.equal(b.memorySnapshot(), memBefore, "非法导入后内存状态必须零改动");
  assert.equal(b.snapshot(), diskBefore, "非法导入后 localStorage 必须零改动");
});

await test("D6 v1 老备份导入考研：替换考研记录、保留已有熟练、返回当前书 state", () => {
  requireCET();
  const b = browser();
  fullScope(b, { dailyNew: 3 });
  const i = b.T.cur;
  b.T.judge(true);
  const kyBefore = clone(b.T.getS());
  const wLocal = b.T.getW()[i].w;
  b.T.setProficient(i, true);
  // 伪造旧格式（无 books 平铺）
  const legacy = {
    settings: { dailyNew: 11, theme: "light" },
    progress: { 5: [2, b.now + 1000, 2, 1, b.now] },
    days: { [today(b.now)]: { n: 1, r: 1, ok: 1, no: 0 } },
    stars: { 7: 1 },
    proficient: {},
  };
  const out = b.T.importState(legacy);
  const S = b.T.getS();
  assert.equal(S.settings.dailyNew, 11, "旧备份设置应导入考研");
  assert.ok(S.progress[5], "旧备份进度应导入考研");
  assert.equal(S.stars[7], 1);
  assert.ok(S.proficient[wLocal], "旧格式导入必须保留已有熟练标记");
  assert.ok(out && out.progress && out.settings, "importState 应返回当前书 state（含 progress/settings）");
});

await test("D7 v1 老备份在当前四级时只导入考研、不强制切书", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 3 });
  const i4 = b.T.cur;
  b.T.judge(true);
  const c4Before = clone(b.T.getBookState("cet4"));
  const out = b.T.importState({
    settings: { dailyNew: 13 },
    progress: { 3: [1, b.now + 1000, 1, 0, b.now] },
    days: {},
  });
  assert.equal(b.T.getBook(), "cet4", "当前在四级时导入 v1 不应强制切书");
  assert.equal(b.T.getBookState("kaoyan").settings.dailyNew, 13, "考研记录应更新");
  assert.deepEqual(clone(b.T.getBookState("cet4")), c4Before, "四级记录不应被 v1 导入改动");
  assert.ok(out && typeof out === "object" && out.progress, "importState 应返回当前书 state");
});

await test("D8 非法 JSON / 超大文件导入报错且零改动", async () => {
  requireCET();
  const b = browser();
  fullScope(b, { dailyNew: 3 });
  b.T.judge(true);
  const before = b.snapshot();
  const memBefore = b.memorySnapshot();
  await b.importFile("{invalid json");
  await b.importFile({ app: "kaoyan-vocab", version: 2, books: {} }, 11 * 1024 * 1024); // 超大
  assert.equal(b.snapshot(), before, "异常 JSON/超大文件不得改动 localStorage");
  assert.equal(b.memorySnapshot(), memBefore, "异常 JSON/超大文件不得改动内存状态");
});

await test("D9 空/仅未知词书/救援备份被拒绝，导入前展示时间与替换范围", async () => {
  requireCET();
  const b = browser();
  fullScope(b, { dailyNew: 3 });
  const before = b.snapshot(), memBefore = b.memorySnapshot();
  const bads = [
    { app: "kaoyan-vocab", version: 3, books: {} },
    { app: "kaoyan-vocab", version: 3, books: { cet9: { progress: { 0: [1,0,1,0,b.now] }, days: {} } } },
    { app: "kaoyan-vocab", version: 3, books: { kaoyan: {} } },
    { app: "kaoyan-vocab", version: 3, rescue: true, books: { kaoyan: { progress: { 0: [1,0,1,0,b.now] }, days: {} } } }
  ];
  for (const bad of bads) {
    let threw = false;
    try { b.T.importState(bad); } catch (e) { threw = true; }
    assert.ok(threw, `应拒绝备份：${JSON.stringify(bad).slice(0, 80)}`);
  }
  const fresh = browser();
  const emptyBackup = exportBackup(fresh);
  let emptyThrew = false;
  try { b.T.importState(emptyBackup); } catch (e) { emptyThrew = /没有可恢复|没有可用于/.test(e.message); }
  assert.ok(emptyThrew, "全新安装导出的默认设置空备份也应拒绝");
  assert.equal(b.snapshot(), before, "拒绝的备份不得写入任何存储");
  assert.equal(b.memorySnapshot(), memBefore, "拒绝的备份不得改动内存");

  const valid = {
    app: "kaoyan-vocab", version: 3, exportedAt: "2026-10-20T08:00:00.000Z", activeBook: "cet4",
    books: { cet4: { dv: 2, progress: { 0: [1, b.now + 1000, 1, 0, b.now] }, days: {}, stars: {}, proficient: {}, timeSec: 0 } }
  };
  const plan = b.T.prepareImportPlan(valid);
  assert.equal(plan.books.length, 1);
  assert.equal(plan.books[0].name, "英语四级");
  assert.equal(plan.books[0].learned, 1, "预览统计已学词数");
  await b.importFile(valid);
  assert.equal(b.query("#importSheet").hidden, false, "有效备份先打开确认浮层");
  assert.match(b.query("#importSummary").textContent, /导出于/);
  assert.match(elText(b, "#importBookList"), /已学 1 词/);
  assert.match(b.query("#importScopeNote").textContent, /替换/);
  b.query("#importConfirm").click();
  assert.equal(b.stateOf("cet4").progress[0][0], 1, "确认后才真正写入");
});

// ===========================================================================
// E. 缺 CET 数据降级
// ===========================================================================
await test("E1 缺 cet 数据时考研照常工作，四级/六级不可用且不崩", () => {
  const b = browser({ withoutCET: true });
  assert.equal(b.T.getBook(), "kaoyan", "缺数据时默认考研");
  const books = b.T.getBooks();
  assert.ok(Array.isArray(books) && books.length >= 1, "getBooks 至少返回考研");
  const map = booksMap(b);
  assert.ok(map.kaoyan && map.kaoyan.available === true, "考研必须可用");
  for (const id of ["cet4", "cet6"]) {
    const raw = b.storage.get(STORAGE[id].state);
    if (map[id]) assert.equal(map[id].available, false, `${id} 缺数据时应不可用`);
    assert.equal(b.T.switchBook(id), false, `缺数据时 switchBook('${id}') 应返回 false`);
    assert.equal(b.storage.get(STORAGE[id].state), raw, "不可用词书不得创建存储");
  }
  assert.equal(b.T.getBook(), "kaoyan", "非法切换后仍在考研");
  fullScope(b, { dailyNew: 2 });
  b.T.judge(true);
  assert.equal(b.T.verdict, true, "考研学习功能正常");
});

await test("E2 缺 cet 数据时导出仍产出 v3 且只含可用词书", () => {
  const b = browser({ withoutCET: true });
  fullScope(b, { dailyNew: 2 });
  b.T.judge(true);
  const backup = exportBackup(b);
  assert.equal(backup.version, 3);
  assert.deepEqual(Object.keys(backup.books), ["kaoyan"], "只导出可用词书");
});

// ===========================================================================
// F. 切换语义 / 跨标签 / 重置 / 队列一致性
// ===========================================================================
await test("F1 switchBook 非法参数返回 false，不改变状态", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet4");
  const disk = b.snapshot();
  for (const bad of [undefined, null, "", "nope", 123, "kaoyan "]) {
    assert.equal(b.T.switchBook(bad), false, `switchBook(${JSON.stringify(bad)}) 应返回 false`);
    assert.equal(b.T.getBook(), "cet4", "非法切换不得改变当前书");
  }
  assert.equal(b.snapshot(), disk, "非法切换不得写存储");
});

await test("F2 切换后 W/队列/范围/cur 全部切到新书，学习可用", () => {
  requireCET();
  const b = browser();
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    const W = b.T.getW();
    const rawArr = b.window[RAW_KEYS[id]];
    assert.equal(W.length, rawArr.length, `${id} W 长度应等于数据数组`);
    assert.equal(W[0] && W[0].w, rawArr[0][0], `${id} W 首词应一致`);
    fullScope(b, { dailyNew: 5 });
    assert.equal(b.T.inScopeCount(), W.length, `${id} 全范围词数`);
    assert.ok(b.T.Q.length > 0 && b.T.Q.length <= W.length, `${id} 队列有效`);
    assert.ok(b.T.Q.every(i => Number.isInteger(i) && i >= 0 && i < W.length), `${id} 队列索引不越界`);
    b.T.judge(true);
    b.T.tryNext(true);
    assert.ok(b.T.qi >= 1, `${id} 判定后翻页正常`);
  }
});

await test("F3 切换前先保存当前书：立即切走不丢刚判定进度", () => {
  requireCET();
  const b = browser();
  fullScope(b, { dailyNew: 3 });
  const i = b.T.cur;
  b.T.judge(true);
  b.T.switchBook("cet4"); // 未等定时器
  const saved = b.stateOf("kaoyan");
  assert.ok(saved && saved.progress && saved.progress[i], "切换时应先 save 考研当前进度");
  const storedProgress = Object.keys(saved.progress);
  assert.deepEqual(storedProgress, [String(i)]);
});

await test("F4 跨标签 storage 事件：别的标签切书，本标签跟随", () => {
  requireCET();
  const a = browser();
  const b = browser({ sharedStorage: a.storage });
  assert.equal(b.T.getBook(), "kaoyan");
  a.T.switchBook("cet4");
  b.storageEvent(ACTIVE_KEY);
  assert.equal(b.T.getBook(), "cet4", "应跟随切到四级");
  assert.equal(b.T.getW().length, b.window.WORDS_CET4.length, "四级 W 长度应等于 WORDS_CET4");
  assert.equal(b.T.getW()[0].w, b.window.WORDS_CET4[0][0], "四级 W 首词应一致");
  a.T.switchBook("cet6");
  b.storageEvent(ACTIVE_KEY);
  assert.equal(b.T.getBook(), "cet6");
});

await test("F5 跨标签切书不丢别的书数据，当前书变化仍同步", () => {
  requireCET();
  const a = browser();
  const b = browser({ sharedStorage: a.storage });
  fullScope(a, { dailyNew: 2 });
  const ia = a.T.cur; a.T.judge(true);
  b.T.switchBook("cet4"); fullScope(b, { dailyNew: 2 });
  const ib = b.T.cur; b.T.judge(true);
  a.storageEvent(ACTIVE_KEY); // b 切四级后 a 跟随
  assert.equal(a.T.getBook(), "cet4");
  // b 再学习，a 收到四级状态事件后同步
  const ib2 = b.T.Q[b.T.qi + 1] ?? b.T.cur;
  b.T.judge(true); b.T.tryNext(true);
  a.storageEvent(STORAGE.cet4.state);
  assert.ok(a.T.getBookState("kaoyan").progress[ia], "考研数据仍在");
  assert.ok(b.storage.get(STORAGE.kaoyan.state), "考研键仍在");
});

await test("F5b 词表搜索/筛选/滚动位置按词书独立保留", () => {
  requireCET();
  const b = browser();
  b.T.show("list");
  b.query("#q").value = "";
  b.query("#fst").value = "all";
  b.query("#fsc").value = "all";
  b.T.applyFilter();
  b.query("#listScroll").scrollTop = 520;
  b.query("#listScroll").dispatch("scroll");
  b.T.switchBook("cet4");
  assert.equal(b.query("#q").value, "", "新词书从自己的空搜索开始");
  assert.equal(b.query("#fsc").value, "scope", "新词书保留自己的默认范围");
  b.query("#q").value = "c4w0";
  b.query("#fst").value = "learn";
  b.T.applyFilter();
  b.T.switchBook("kaoyan");
  assert.equal(b.query("#q").value, "", "切回后恢复考研搜索词");
  assert.equal(b.query("#fst").value, "all", "切回后恢复考研状态筛选");
  assert.equal(b.query("#fsc").value, "all", "切回后恢复考研范围筛选");
  assert.equal(b.query("#listScroll").scrollTop, 520, "切回后恢复滚动位置");
});

await test("F6 重置全部进度只作用于当前书", () => {
  requireCET();
  const b = browser();
  const before = {};
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    fullScope(b, { dailyNew: 2 });
    b.T.judge(true);
    before[id] = clone(b.T.getBookState(id));
  }
  b.T.switchBook("cet4");
  b.query("#rst").click(); // confirm 桩返回 true
  const after4 = b.T.getBookState("cet4");
  assert.equal(Object.keys(after4.progress).length, 0, "四级进度应清空");
  assert.equal(Object.keys(after4.stars || {}).length, 0, "四级收藏应清空");
  assert.equal(Object.keys(after4.proficient || {}).length, 0, "四级熟练应清空");
  // 现行语义：#rst 后 startSession 会惰性写一条当日全 0 记录；只要求无有效学习量
  const effectiveDays = Object.entries(after4.days || {}).filter(([, v]) => (v?.r || 0) > 0 || (v?.n || 0) > 0);
  assert.equal(effectiveDays.length, 0, `四级不应有有效每日记录：${JSON.stringify(effectiveDays)}`);
  for (const id of BOOK_IDS.filter(id => id !== "cet4")) {
    assert.deepEqual(clone(b.T.getBookState(id)), before[id], `${id} 不应被重置`);
  }
  assert.equal(b.T.getBook(), "cet4", "重置后仍在四级");
});

await test("F7 清空熟练标记只作用于当前书", () => {
  requireCET();
  const b = browser();
  const profs = {};
  for (const id of BOOK_IDS) {
    b.T.switchBook(id);
    fullScope(b, { dailyNew: 3 });
    b.T.setProficient(b.T.cur, true);
    profs[id] = Object.keys(b.profOf(id)).length;
    assert.ok(profs[id] >= 1, `${id} 已有熟练词`);
  }
  b.T.switchBook("cet6");
  b.query("#resetProficient").click();
  assert.equal(Object.keys(b.T.getBookState("cet6").proficient).length, 0, "六级熟练应清空");
  assert.equal(Object.keys(b.T.getBookState("kaoyan").proficient).length, profs.kaoyan, "考研熟练不应被清空");
  assert.equal(Object.keys(b.T.getBookState("cet4").proficient).length, profs.cet4, "四级熟练不应被清空");
  assert.equal(Object.keys(b.T.getBookState("combined").proficient).length, profs.combined, "综合熟练不应被清空");
});

await test("F8 三本词书内容互不相同（防止复制错误）", () => {
  requireCET();
  if (process.env.CET_DATA_FILE) { console.log("SKIP  F8（fixture 模式：两本书词表同源，真实数据就绪后自动生效）"); return; }
  const b = browser();
  const lists = {};
  for (const id of BOOK_IDS) { b.T.switchBook(id); lists[id] = b.T.getW(); }
  const words = id => new Set(lists[id].map(x => x.w));
  const w4 = words("cet4"), w6 = words("cet6"), wk = words("kaoyan");
  const c46 = [...w4].filter(w => w6.has(w)).length;
  const c4k = [...w4].filter(w => wk.has(w)).length;
  const c6k = [...w6].filter(w => wk.has(w)).length;
  assert.ok(c46 / w4.size < 0.98, `四级/六级词表重合度过高：${(c46 / w4.size * 100).toFixed(1)}%（疑似复制）`);
  assert.ok(c4k / w4.size < 0.98, `四级/考研词表重合度过高：${(c4k / w4.size * 100).toFixed(1)}%（疑似复制）`);
  assert.ok(c6k / w6.size < 0.98, `六级/考研词表重合度过高：${(c6k / w6.size * 100).toFixed(1)}%（疑似复制）`);
});

await test("F9 保存当前书设置/收藏/熟练后切走再切回保真", () => {
  requireCET();
  const b = browser();
  b.T.switchBook("cet4");
  fullScope(b, { dailyNew: 4 });
  const i = b.T.cur;
  b.T.judge(false);
  const S4 = b.T.getS();
  S4.stars[i] = 1;
  S4.settings.theme = "light";
  S4.settings.showEx = false;
  b.T.switchBook("cet6");
  b.T.switchBook("cet4");
  const S = b.T.getS();
  assert.equal(S.stars[i], 1, "四级收藏保留");
  assert.equal(S.progress[i][0], 0, "四级进度保留");
  assert.equal(S.settings.theme, "light", "四级主题保留");
  assert.equal(S.settings.showEx, false, "四级显示设置保留");
});


// ===========================================================================
// G. dataVersion / migrations 进度无损迁移 + 备份 v3
// ===========================================================================
const REMOVED4 = [2, 5, 11];   // makeSynthCET 默认：四级旧数组 15 → 新数组 12
/** 迁移公式：new = old - count(removed < old) */
const mapOldIndex = (removed, old) => old - removed.filter(r => r < old).length;
const numsAsc = obj => Object.keys(obj).map(Number).sort((a, b) => a - b);

await test("G1 合成数据注册：dataVersion 生效，新记录 dv=2", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const map = booksMap(b);
  assert.equal(map.cet4.words, synth.c4.words.length, "四级按合成新数组注册");
  assert.equal(map.cet6.words, synth.c6.words.length, "六级按合成新数组注册");
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().dv, 2, "新记录 dv 应为当前数据版本 2");
  assert.equal(Object.keys(b.T.getS().progress).length, 0);
  b.T.switchBook("cet6");
  assert.equal(b.T.getS().dv, 2, "六级新记录 dv=2");
});

await test("G2 本地 v1 记录自动迁移：下标映射 / removed 丢弃 / stars / days / settings 保留", () => {
  const synth = makeSynthCET();
  const removed = REMOVED4;
  const oldProgress = { 0: [1,0,1,0,0], 1: [1,0,1,0,0], 2: [1,0,1,0,0], 3: [1,0,1,0,0], 5: [1,0,1,0,0], 14: [2,0,2,0,0] };
  const oldStars = { 0: 1, 2: 1, 3: 1, 14: 1 };
  const oldProf = { "c4w0": 111, "c4w1": 222, "c4w2": 333, "unknown-word": 444 };
  const oldState = {
    settings: { dailyNew: 17, theme: "dark", pmin: 5 },
    progress: oldProgress,
    days: { "2026-10-01": { n: 1, r: 2, ok: 1, no: 1 } },
    stars: oldStars, proficient: oldProf, timeSec: 77
  };
  const b = browser({ cetSourceOverride: synth.source, initial: {
    [ACTIVE_KEY]: "cet4",
    [STORAGE.cet4.state]: oldState,
    [STORAGE.cet4.prof]: oldProf
  }});
  const S = b.T.getS();
  const expectedKeys = oldProgress && Object.keys(oldProgress).map(Number)
    .filter(old => !removed.includes(old)).map(old => mapOldIndex(removed, old))
    .sort((a, b) => a - b).map(String);
  assert.equal(S.dv, 2, "迁移后 dv=2");
  assert.deepEqual(Object.keys(S.progress).map(Number).sort((a,b)=>a-b), expectedKeys.map(Number), "进度旧下标应映射到新下标");
  for (const old of [0, 1, 3, 14]) {
    const nk = mapOldIndex(removed, old);
    assert.equal(synth.c4.words[nk][0], synth.c4.oldWords[old], `旧下标 ${old} → 新下标 ${nk} 应为同一单词`);
    assert.ok(S.progress[nk], `新下标 ${nk} 应有迁移后的进度`);
  }
  assert.equal(JSON.stringify(S.stars), JSON.stringify({ 0: 1, 2: 1, 11: 1 }), "收藏下标同步迁移、删词收藏丢弃");
  assert.deepEqual(clone(S.days["2026-10-01"]), oldState.days["2026-10-01"], "每日记录原样保留");
  assert.equal(S.settings.dailyNew, 17, "设置保留");
  assert.equal(S.settings.theme, "dark");
  assert.equal(S.timeSec, 77, "时长保留");
  assert.equal(JSON.stringify(Object.keys(S.proficient).sort()), JSON.stringify(["c4w0", "c4w1"]), "熟练名单保留在库词、丢弃删词与未知词");
  const profOnDisk = JSON.parse(b.storage.get(STORAGE.cet4.prof));
  assert.equal(profOnDisk["c4w0"], 111, "旧熟练键应回写保留项");
  assert.equal(profOnDisk["c4w2"], undefined, "删词熟练键应被清洗");
  // 保存后主记录落盘迁移结果
  b.T.switchBook("kaoyan");
  const persisted = b.stateOf("cet4");
  assert.equal(persisted.dv, 2, "保存后本地记录 dv=2");
  assert.deepEqual(Object.keys(persisted.progress).map(Number).sort((a,b)=>a-b), expectedKeys.map(Number), "保存后进度下标已迁移");
  // 切回幂等
  b.T.switchBook("cet4");
  assert.equal(b.T.getS().dv, 2);
  assert.deepEqual(Object.keys(b.T.getS().progress).map(Number).sort((a,b)=>a-b), expectedKeys.map(Number));
});

await test("G3 迁移幂等：重复加载/切书不重复映射", () => {
  const synth = makeSynthCET();
  const oldState = { settings: {}, progress: { 4: [1,0,1,0,0], 14: [2,0,2,0,0] }, days: {}, stars: { 14: 1 }, proficient: {}, timeSec: 0 };
  const b1 = browser({ cetSourceOverride: synth.source, initial: {
    [ACTIVE_KEY]: "cet4", [STORAGE.cet4.state]: oldState
  }});
  b1.T.switchBook("kaoyan");   // 触发保存，落盘迁移后记录
  const snapshot = JSON.stringify(b1.stateOf("cet4"));
  const b2 = browser({ cetSourceOverride: synth.source, sharedStorage: b1.storage });
  assert.equal(JSON.stringify(b2.stateOf("cet4")), snapshot, "重复加载不应再次改动记录");
  b2.T.switchBook("cet4");
  assert.equal(b2.T.getS().dv, 2);
  assert.deepEqual(Object.keys(b2.T.getS().progress).map(Number).sort((a,b)=>a-b), [3, 11], "只映射一次：4→3、14→11");
  assert.equal(JSON.stringify(b2.T.getS().stars), JSON.stringify({ 11: 1 }), "收藏同样只映射一次");
});

await test("G4 旧 v2 备份（无 dv）导入：逐书迁移后合入，days/settings/熟练保留", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const backup = {
    app: "kaoyan-vocab", version: 2, exportedAt: new Date().toISOString(), activeBook: "cet4",
    books: {
      cet4: { settings: { dailyNew: 6 }, progress: { 3: [1,0,1,0,0], 5: [1,0,1,0,0], 14: [2,0,2,0,0] },
        days: { "2026-10-01": { n: 1, r: 1, ok: 1, no: 0 } }, stars: { 2: 1, 14: 1 },
        proficient: { "c4w0": 1, "c4w2": 2 }, timeSec: 9 },
      cet6: { settings: { dailyNew: 4 }, progress: { 1: [1,0,1,0,0] }, days: {}, stars: {},
        proficient: { "c6w1": 3 }, timeSec: 1 }
    }
  };
  const out = b.T.importState(backup);
  assert.equal(b.T.getBook(), "cet4", "activeBook 合法应切换");
  assert.equal(out.dv, 2, "导入后 dv=2");
  assert.deepEqual(Object.keys(out.progress).map(Number).sort((a,b)=>a-b), [2, 11], "removed 丢弃、其余映射");
  assert.equal(JSON.stringify(out.stars), JSON.stringify({ 11: 1 }), "收藏迁移");
  assert.equal(JSON.stringify(Object.keys(out.proficient)), JSON.stringify(["c4w0"]), "删词熟练丢弃");
  assert.equal(out.settings.dailyNew, 6);
  assert.equal(out.days["2026-10-01"].r, 1, "days 保留");
  assert.equal(out.timeSec, 9);
  const c6 = b.T.getBookState("cet6");
  assert.equal(c6.dv, 2, "六级同样迁到 dv=2");
  assert.equal(Object.keys(c6.progress).length, 0, "六级 removed 词条进度丢弃");
  assert.equal(Object.keys(c6.proficient).length, 0, "六级删词熟练丢弃");
  assert.equal(c6.settings.dailyNew, 4, "六级设置保留");
});

await test("G5 v3 导出→导入往返：三书状态含 dv 且完全保真", () => {
  const synth = makeSynthCET();
  const a = browser({ cetSourceOverride: synth.source });
  a.T.switchBook("cet4");
  fullScope(a, { dailyNew: 3 });
  const i = a.T.cur;
  a.T.judge(true);
  a.T.getS().stars[a.T.Q[1] ?? i] = 1;
  a.T.getS().settings.theme = "dark";
  const backup = exportBackup(a);
  assert.equal(backup.version, 3, "导出为备份 v3");
  assert.equal(backup.books.kaoyan.dv, cetMeta.kaoyan?.dataVersion || 1, "考研使用真实词库的数据版本");
  assert.equal(backup.books.cet4.dv, 2, "四级 dv=2");
  assert.equal(backup.books.cet6.dv, 2, "六级 dv=2");
  const before = clone(a.T.getBookState("cet4"));
  const b = browser({ cetSourceOverride: synth.source, initial: { [ACTIVE_KEY]: "kaoyan" } });
  b.T.importState(backup);
  assert.equal(b.T.getBook(), "cet4", "导入后切到 activeBook");
  assert.deepEqual(clone(b.T.getBookState("cet4")), before, "v3 往返状态（含 dv/收藏/熟练）保真");
  assert.equal(b.T.getBookState("cet4").dv, 2);
});

await test("G6 非法 migrations meta：忽略迁移、回退 version 1、不得抛错", () => {
  for (const opts of [{ broken: true }, { gap: true }, { outOfRange: true }]) {
    const synth = makeSynthCET(opts);
    const rawV1 = { settings: {}, progress: { 0: [1,0,1,0,0] }, days: {}, stars: {}, proficient: {} };
    const b = browser({ cetSourceOverride: synth.source, initial: {
      [ACTIVE_KEY]: "cet4", [STORAGE.cet4.state]: rawV1
    }});
    assert.equal(b.T.getS().dv, 1, `${JSON.stringify(opts)} 非法 meta 应回退 dv=1`);
    assert.equal(b.T.getS().progress[0][0], 1, "旧记录按 version 1 原样读取");
    assert.equal(b.T.switchBook("cet6"), true, "其它书仍可正常切换");
    assert.equal(b.T.getS().dv, 2, "有效迁移的六级正常");
  }
});

await test("G7 旧标签页写入无 dv 记录：storage 事件同步时走迁移", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  b.T.switchBook("cet4");
  const oldStyle = { settings: { dailyNew: 8 }, progress: { 14: [2,0,2,0,0] }, days: {}, stars: { 14: 1 }, proficient: {}, timeSec: 0 };
  b.storage.set(STORAGE.cet4.state, JSON.stringify(oldStyle));
  b.storageEvent(STORAGE.cet4.state);
  const S = b.T.getS();
  assert.equal(b.T.getBook(), "cet4");
  assert.equal(S.dv, 2, "跨标签旧记录同步后 dv=2");
  assert.deepEqual(Object.keys(S.progress).map(Number), [11], "旧下标 14 应迁移为 11");
  assert.equal(JSON.stringify(S.stars), JSON.stringify({ 11: 1 }));
  assert.equal(S.settings.dailyNew, 8);
});

await test("G8 本地记录 dv 高于 dataVersion：拒绝覆盖并保护原文", () => {
  const synth = makeSynthCET();
  const raw = { dv: 3, settings: {}, progress: { 0: [1,0,1,0,0] }, days: {}, stars: {}, proficient: {} };
  const b = browser({ cetSourceOverride: synth.source, initial: {
    [ACTIVE_KEY]: "cet4",
    [STORAGE.cet4.state]: raw
  }});
  assert.equal(b.T.getS().dv, 2, "空白界面仍以当前数据版本初始化");
  assert.equal(b.T.getS().progress[0], undefined, "未来版本记录不得降级映射");
  assert.equal(b.T.getStorageOK(), false, "读取失败必须暂停写入");
  assert.equal(b.storage.get(STORAGE.cet4.state), JSON.stringify(raw), "未来版本原文必须保留");
  assert.match(b.T.getStorageAlert(), /更新的词库/, "持续提示数据版本过新");
  assert.throws(() => b.T.importState({
    app: "kaoyan-vocab", version: 3, activeBook: "cet4",
    books: { cet4: { dv: 3, progress: { 0: [1,0,1,0,0] }, days: {} } }
  }), /更新的词库/);
});

// 真实已发布词库的版本基线，来自审查通过的清理清单；不得仅随数组长度变化。
const RELEASE_CONTRACT = {
  kaoyan: {version: 3, initial: 8100, previous: 8043, count: 7997},
  cet4: {version: 4, initial: 7519, previous: 7201, count: 7168},
  cet6: {version: 4, initial: 9373, previous: 8853, count: 8821}
};
const addedCountOf = (m) => Array.isArray(m?.added) ? m.added.length : (Array.isArray(m?.addedWords) ? m.addedWords.length : 0);
function originalSlots(meta, currentLength, fromVersion = 1){
  const chain = meta.migrations.filter(m => m.from >= fromVersion);
  const oldLength = currentLength + chain.reduce((n, m) => n + m.removed.length - addedCountOf(m), 0);
  let slots = Array.from({length: oldLength}, (_, i) => i);
  for (const m of chain) {
    const removed = new Set(m.removed);
    slots = slots.filter((_, i) => !removed.has(i));
    for (let i = 0; i < addedCountOf(m); i++) slots.push(-1);
  }
  return {oldLength, slots, addedTotal: slots.filter(x => x < 0).length};
}

await test("G9 真实三书删除/新增迁移：版本、完整清单、每版旧长度与发布基线一致", () => {
  assert.ok(cetSource && cetMeta, "真实词书及版本元数据必须存在");
  for (const id of SOURCE_BOOK_IDS) {
    const meta = cetMeta[id], len = cetLengths[id], expected = RELEASE_CONTRACT[id];
    assert.ok(meta, `${id} 必须发布版本元数据`);
    assert.equal(meta.dataVersion, expected.version, `${id} 数据版本`);
    assert.equal(len, expected.count, `${id} 词数须与审查通过的清理/修复清单一致`);
    assert.equal(meta.wordCount, len, `${id} meta.wordCount`);
    assert.equal(meta.previousWordCount, expected.previous, `${id} 最近一次迁移前词数`);
    assert.equal(meta.migrations.length, meta.dataVersion - 1, `${id} 应完整记录每次迁移`);
    // 第一条迁移 = 2026-10-21 噪声清理；第二条 = 本次词频/词形修复。
    const cleanup = cleanupAudit.certain.filter(entry => entry.book === id).sort((a, b) => a.index - b.index);
    const repair = repairPlan.books[id].deletes;
    const cleanupMigration = meta.migrations[meta.migrations.length - 2];
    const latest = meta.migrations[meta.migrations.length - 1];
    assert.deepEqual(clone(cleanupMigration.removed), cleanup.map(entry => entry.index), `${id} 清理迁移下标须逐项等于清理清单`);
    assert.deepEqual(clone(cleanupMigration.removedWords), cleanup.map(entry => entry.word), `${id} 清理迁移词名须逐项等于清理清单`);
    assert.deepEqual(clone(latest.removedWords), repair.map(entry => entry.w), `${id} 最新迁移删除词名须逐项等于修复清单`);
    assert.deepEqual(clone(latest.addedWords || []), repairPlan.books[id].adds.map(entry => entry.w), `${id} 最新迁移新增词名须逐项等于修复清单`);
    meta.migrations.forEach((m, step) => {
      assert.equal(m.from, step + 1, `${id} 迁移起点连续`);
      assert.equal(m.to, step + 2, `${id} 每次只升一版`);
      const oldLen = len + meta.migrations.slice(step).reduce((n, x) => n + x.removed.length - addedCountOf(x), 0);
      assert.equal(m.previousWordCount, oldLen, `${id} v${m.from} 旧词数`);
      assert.ok(Array.isArray(m.removed) && m.removed.length > 0, `${id} 删除清单非空`);
      assert.equal(m.removedWords.length, m.removed.length, `${id} removedWords 与索引一一对应`);
      assert.equal(new Set(m.removedWords).size, m.removedWords.length, `${id} 删除词名不重复`);
      if (addedCountOf(m)) {
        assert.equal((m.added || []).length, addedCountOf(m), `${id} v${m.from} added 与 addedWords 等长`);
        assert.equal((m.addedWords || []).length, addedCountOf(m), `${id} v${m.from} addedWords 完整`);
        assert.equal(new Set(m.addedWords).size, m.addedWords.length, `${id} v${m.from} 新增词名不重复`);
      }
      m.removed.forEach((index, k) => {
        assert.ok(Number.isInteger(index) && index >= 0 && index < oldLen, `${id} v${m.from} 下标 ${index} 在旧数组范围内`);
        if (k) assert.ok(index > m.removed[k - 1], `${id} v${m.from} 删除下标严格升序`);
      });
    });
    const {oldLength, slots, addedTotal} = originalSlots(meta, len);
    assert.equal(oldLength, expected.initial, `${id} 完整迁移链须重建最初发布词数`);
    assert.equal(slots.length, len, `${id} 迁移后数组长度`);
    assert.equal(slots.filter(x => x >= 0).length, len - addedTotal, `${id} 删除清单保留词数`);
  }
});

await test("G10 真实全量旧索引迁移：v1及最近版本进度/收藏逐词对应，不发生错位", () => {
  assert.ok(cetSource && cetMeta, "真实词书及版本元数据必须存在");
  for (const id of SOURCE_BOOK_IDS) {
    const meta = cetMeta[id], len = cetLengths[id];
    for (const fromVersion of new Set([1, meta.dataVersion - 1])) {
      const {oldLength, slots, addedTotal} = originalSlots(meta, len, fromVersion);
      const progress = {}, stars = {};
      for (let old = 0; old < oldLength; old++) {
        progress[old] = [1, 0, old + 1, old % 4, 123];
        stars[old] = 1;
      }
      const original = {settings: {dailyNew: 21}, progress, stars, days: {}, proficient: {}, timeSec: 12};
      if (fromVersion > 1) original.dv = fromVersion;
      const t0 = Date.now();
      const b = browser({initial: {[ACTIVE_KEY]: id, [STORAGE[id].state]: original}});
      const S = b.T.getS();
      assert.equal(S.dv, meta.dataVersion, `${id} 从 v${fromVersion} 升到当前版本`);
      assert.equal(Object.keys(S.progress).length, len - addedTotal, `${id} 保留全部有效旧进度，新增词无旧进度`);
      assert.equal(Object.keys(S.stars).length, len - addedTotal, `${id} 收藏与进度同步删除映射`);
      for (let current = 0; current < slots.length; current++) {
        const old = slots[current];
        if (old < 0) {
          assert.equal(S.progress[current], undefined, `${id} 新增词 ${current} 不应有旧进度`);
          assert.equal(S.stars[current], undefined, `${id} 新增词 ${current} 不应有旧收藏`);
          continue;
        }
        assert.equal(S.progress[current]?.[2], old + 1, `${id} v${fromVersion} 旧下标 ${old} 应映射到 ${current}`);
        assert.equal(S.progress[current]?.[3], old % 4, `${id} 错次跟随同一旧词`);
        assert.equal(S.stars[current], 1, `${id} 收藏下标 ${current}`);
      }
      assert.equal(S.settings.dailyNew, 21, `${id} 设置保留`);
      assert.equal(S.timeSec, 12, `${id} 时长保留`);
      assert.ok(Date.now() - t0 < 5000, `${id} 全量迁移应在5秒内完成`);
    }
  }
});

await test("H1 非当前书主记录损坏：拒绝常规导出，救援导出保留原文，导入可修复", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source, initial: {
    [STORAGE.cet4.state]: "{broken",
    [STORAGE.cet4.prof]: { c4w0: 123 }
  }});
  assert.throws(() => b.T.buildExport(), /英语四级/, "常规导出不得把损坏记录伪装成空白");
  const rescue = b.T.buildRescueExport();
  assert.equal(rescue.rescue, true, "救援导出明确标记不可直接导入");
  assert.equal(rescue.damaged.cet4.state, "{broken", "救援文件保留损坏原文");
  assert.deepEqual(JSON.parse(rescue.damaged.cet4.proficient), { c4w0: 123 }, "救援文件保留独立熟练原文");
  b.T.importState({ app: "kaoyan-vocab", version: 3, books: {
    cet4: { dv: 2, progress: { 0: [1, b.now + 1000, 1, 0, b.now] }, days: {}, proficient: {} }
  }});
  assert.equal(b.profOf("cet4").c4w0, 123, "导入不能覆盖独立熟练名单");
  b.T.switchBook("cet4");
  assert.equal(b.T.isProficient(0), true, "恢复后仍永久排除熟练词");
});

await test("H2 当前在四级时导入 v1：考研主记录损坏也保留独立熟练", () => {
  const b = browser({ initial: { [ACTIVE_KEY]: "cet4", [STORAGE.kaoyan.state]: "{broken" } });
  const word = b.window.WORDS_RAW[0][0];
  b.storage.set(STORAGE.kaoyan.prof, JSON.stringify({ [word]: 456 }));
  b.T.importState({ progress: { 0: [1, 0, 1, 0, b.now] }, days: {}, proficient: {} });
  assert.equal(b.profOf("kaoyan")[word], 456);
  assert.equal(b.T.getBook(), "cet4");
});

await test("H3 非当前书以独立熟练键为准：新标记可导出，已取消标记不复活", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source, initial: {
    [STORAGE.cet4.state]: { dv: 2, progress: {}, days: {}, proficient: { c4w0: 123 } },
    [STORAGE.cet4.prof]: { c4w1: 456 }
  }});
  const state = b.T.getBookState("cet4");
  assert.deepEqual(Object.keys(state.proficient), ["c4w1"]);
  const exported = exportBackup(b).books.cet4.proficient;
  assert.equal(exported.c4w0, undefined);
  assert.equal(exported.c4w1, 456);
});

await test("H4 旧备份被删词条有非法进度：整份拒绝，迁移不能掩盖损坏", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const beforeMemory = b.memorySnapshot(), beforeDisk = b.snapshot();
  for (const invalid of [["bad"], [1, 0, -1, 0, 0], [12, 0, 1, 0, 0], [1, 0, 1.5, 0, 0]]) {
    assert.throws(() => b.T.importState({ version: 2, books: {
      kaoyan: { progress: { 0: [1, 0, 1, 0, 0] }, days: {} },
      cet4: { progress: { 2: invalid }, days: {} }
    }}));
    assert.equal(b.memorySnapshot(), beforeMemory);
    assert.equal(b.snapshot(), beforeDisk);
  }
});

await test("H5 多词书导入写入失败：整份回滚并保留导入前记录", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const beforeSnapshot = b.snapshot(), beforeMemory = b.memorySnapshot();
  const setItem = b.context.localStorage.setItem;
  b.context.localStorage.setItem = (key, value) => {
    if (key === STORAGE.kaoyan.state) throw new Error("quota");
    setItem(key, value);
  };
  assert.throws(() => b.T.importState({ app: "kaoyan-vocab", version: 3, activeBook: "cet4", books: {
    kaoyan: { progress: { 0: [1, 0, 1, 0, b.now] }, days: {} },
    cet4: { dv: 2, progress: { 0: [1, 0, 1, 0, b.now] }, days: {} }
  }}), /已回滚到导入前记录/);
  assert.equal(b.T.getBook(), "kaoyan", "失败后不切换词书");
  assert.equal(b.T.getS().progress[0], undefined, "当前书内存记录回到导入前");
  assert.equal(b.stateOf("cet4"), null, "已写入的其他词书也回滚");
  assert.equal(b.snapshot(), beforeSnapshot, "存储键与导入前完全一致（含恢复日志清理）");
  assert.equal(b.memorySnapshot(), beforeMemory);
});

await test("H6 非当前书导入写入失败：整份回滚并保留导入前状态", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const beforeSnapshot = b.snapshot(), beforeMemory = b.memorySnapshot();
  const setItem = b.context.localStorage.setItem;
  b.context.localStorage.setItem = (key, value) => {
    if (key === STORAGE.cet4.state) throw new Error("quota");
    setItem(key, value);
  };
  assert.throws(() => b.T.importState({ app: "kaoyan-vocab", version: 3, activeBook: "cet4", books: {
    cet4: { dv: 2, progress: { 0: [1, 0, 1, 0, b.now] }, days: {} }
  }}), /已回滚到导入前记录/);
  assert.equal(b.T.getBook(), "kaoyan");
  assert.equal(b.stateOf("cet4"), null);
  assert.equal(b.snapshot(), beforeSnapshot);
  assert.equal(b.memorySnapshot(), beforeMemory);
});

await test("H7 被删熟练词的非法值及错误容器必须整份拒绝", () => {
  const synth = makeSynthCET();
  const b = browser({ cetSourceOverride: synth.source });
  const beforeMemory = b.memorySnapshot(), beforeDisk = b.snapshot();
  const invalidStates = [
    ...[-1, 0, {}, "123", true, Infinity, NaN].map(value => ({ proficient: { c4w2: value } })),
    { stars: [] }, { proficient: [] }, { progress: [] }
  ];
  for (const invalid of invalidStates) {
    assert.throws(() => b.T.importState({ version: 2, books: {
      kaoyan: { progress: { 0: [1, 0, 1, 0, 0] }, days: {} },
      cet4: { progress: {}, days: {}, ...invalid }
    }}));
    assert.equal(b.memorySnapshot(), beforeMemory);
    assert.equal(b.snapshot(), beforeDisk);
  }
  const valid = b.T.normalizeState({ progress: {}, days: {}, proficient: { c4w2: 123, c4w0: 456 } }, "cet4");
  assert.deepEqual(Object.keys(valid.proficient), ["c4w0"], "合法已删词熟练标记仍可清理");
});

await test("H8 独立熟练名单先校验值：已删词非法值不能被容错清理吞掉", () => {
  const synth = makeSynthCET();
  for (const value of [-1, 0, {}, "123", true]) {
    const b = browser({ cetSourceOverride: synth.source, initial: {
      [ACTIVE_KEY]: "cet4", [STORAGE.cet4.prof]: { c4w2: value }
    }});
    assert.equal(b.T.getStorageOK(), false, "损坏名单应阻止覆盖原记录");
    assert.deepEqual(b.profOf("cet4"), { c4w2: value }, "原始异常名单应保留供恢复");
  }
});

// ---------------------------------------------------------------------------
console.log(`\n多词书结果：${passed} 通过，${failed} 失败`);
if (failed) {
  console.log("失败明细：");
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
process.exitCode = failed ? 1 : 0;
