/**
 * 残缺词形修复与熟练名单键迁移验收
 * 运行：node js/test-spelling-migration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const KEY = "kaoyan_vocab_v1";
const PROF_KEY = "kaoyan_vocab_proficient_v1";

let pass = 0, fail = 0;
const ck = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};

const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "spelling-fixes.json"), "utf8"));
const spellFix = Object.fromEntries(Object.entries(fixes).filter(([k]) => k !== "_说明"));
const wordsJs = fs.readFileSync(path.join(HERE, "words-data.js"), "utf8");
const dataBox = {window: {}};
vm.runInNewContext(wordsJs, dataBox, {filename: "words-data.js"});
const RAW = dataBox.window.WORDS_RAW;
const kaoyanMeta = dataBox.window.WORD_BOOK_META?.kaoyan || {dataVersion: 1, migrations: []};
const removedWords = new Set((kaoyanMeta.migrations || []).flatMap(m => m.removedWords || []));
const removedCount = (kaoyanMeta.migrations || []).reduce((n, m) => n + m.removed.length, 0);
const wordSet = new Set(RAW.map(a => a[0]));
const appJs = fs.readFileSync(path.join(HERE, "app.js"), "utf8");

function mkEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), _h: "", style: {}, dataset: {}, value: "", checked: false,
    textContent: "", hidden: false, files: [], scrollTop: 0, clientHeight: 600, onclick: null,
    classList: { _s: new Set(), add(...a) { a.forEach(x => this._s.add(x)); }, remove(...a) { a.forEach(x => this._s.delete(x)); }, toggle() {}, contains(c) { return this._s.has(c); } },
    addEventListener() {}, appendChild() {}, click() {}, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  Object.defineProperty(el, "innerHTML", { get() { return this._h; }, set(v) { this._h = String(v); } });
  Object.defineProperty(el, "offsetWidth", { get() { return 100; } });
  return el;
}

/** 每次调用重建全局环境并重新执行 app.js，得到独立实例 */
function boot(proficient = null, main = null) {
  const store = {};
  if (proficient !== null) store[PROF_KEY] = typeof proficient === "string" ? proficient : JSON.stringify(proficient);
  if (main !== null) store[KEY] = typeof main === "string" ? main : JSON.stringify(main);

  const registry = new Map();
  const getEl = (sel) => {
    if (!registry.has(sel)) {
      const el = mkEl(sel.includes("input") ? "input" : sel.includes("select") ? "select" : sel.includes("button") ? "button" : "div");
      if (sel === "#v-study") el.classList.add("on");
      registry.set(sel, el);
    }
    return registry.get(sel);
  };
  globalThis.document = {
    querySelector: (s) => getEl(s), querySelectorAll: () => [], addEventListener() {},
    createElement: (t) => mkEl(t), documentElement: { dataset: {} }, body: mkEl("body"), visibilityState: "visible"
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, WORDS_RAW: null
  };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.confirm = () => true;
  globalThis.Blob = class {};
  globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };
  globalThis.FileReader = class {};
  globalThis.SpeechSynthesisUtterance = class {};
  globalThis.speechSynthesis = { cancel() {}, speak() {} };

  new Function(wordsJs)();
  globalThis.WORDS_RAW = globalThis.window.WORDS_RAW;
  try {
    new Function(appJs)();
  } catch (e) {
    console.error("app.js 执行失败:", e.stack || e.message);
    process.exit(1);
  }
  const T = globalThis.window.__vocab;
  return { T, store };
}

console.log("== 1. 词形修复结果与删除迁移基线 ==");
const addedCount = (kaoyanMeta.migrations || []).reduce((n, m) => n + (Array.isArray(m.added) ? m.added.length : (Array.isArray(m.addedWords) ? m.addedWords.length : 0)), 0);
ck(RAW.length + removedCount - addedCount === 8100, "当前词数 + 已登记删除数 - 新增数 = 原始 8100", String(RAW.length));
if (kaoyanMeta.wordCount !== undefined) ck(RAW.length === kaoyanMeta.wordCount, "词数与迁移 meta.wordCount 一致");
ck(new Set(RAW.map(a => a[0])).size === RAW.length, "无重复单词");
const extraNames = ["can", "one", "will", "may", "own"];
const extraIdx = extraNames.map(w => RAW.findIndex(a => a[0] === w));
ck(extraIdx.every((i, k) => i >= 0 && (k === 0 || i === extraIdx[k - 1] + 1)),
  "补回词仍连续成块", extraIdx.join(","));
ck(extraIdx[0] >= RAW.length - 9,
  "补回词仍在末尾（允许其后追加新词）", `start=${extraIdx[0]}, len=${RAW.length}`);
ck(RAW[0][0] === "answer", "首词条仍为 answer", RAW[0][0]);

const renamed = [];
const skipped = [];
for (const [oldW, newW] of Object.entries(spellFix)) {
  const hasOld = wordSet.has(oldW);
  const hasNew = wordSet.has(newW);
  if (!hasOld && hasNew) renamed.push([oldW, newW]);
  else if (hasOld && hasNew && oldW !== newW) skipped.push([oldW, newW]);
}
const removedAliases = Object.keys(spellFix).filter(w => removedWords.has(w) && wordSet.has(spellFix[w]));
ck(renamed.length === 38 + removedAliases.length, "原地改名与有迁移的冗余坏词删除均保留正确词形", `实际 ${renamed.length}，本轮删除别名 ${removedAliases.length}`);
ck(skipped.length === 26 - removedAliases.length, "历史 26 个撞车条目按明确删除清单清理", `实际 ${skipped.length}`);
for (const [oldW, newW] of renamed) {
  ck(!wordSet.has(oldW) && wordSet.has(newW), `改名 ${oldW} → ${newW}`);
}
for (const [oldW, newW] of skipped) {
  ck(wordSet.has(oldW) && wordSet.has(newW), `保留双词条 ${oldW} / ${newW}`);
}

const rValues = RAW.map(a => a[4]);
ck(new Set(rValues).size === rValues.length, "r 值无重复（未误改）");
ck(rValues.every(r => Number.isInteger(r) && r >= 1), "r 值均为正整数");

// 释义中的「残缺词形」自注已清理（仅针对已改名词条）
const dirty = renamed.filter(([oldW]) => {
  const row = RAW.find(a => a[0] === spellFix[oldW]);
  return row && /残缺词形/.test(row[2] || "");
});
ck(dirty.length === 0, "已改名词条释义不再含「残缺词形」自注", JSON.stringify(dirty));

console.log("== 2. 熟练名单键迁移 ==");
{
  const now = Date.now();
  // 原地改名词与本轮清除的坏词别名都应映射到词库实际保留的正确拼写
  const { T } = boot({ downshifte: now, earning: now, hardworke: now, acqui: now, complie: now, people: now });
  const S = T.getS();
  ck(S.proficient.downshift === now, "downshifte → downshift");
  ck(S.proficient.earnings === now, "earning → earnings");
  ck(S.proficient.hardworking === now, "hardworke → hardworking");
  ck(!("downshifte" in S.proficient), "旧键 downshifte 已移除");
  ck(!("earning" in S.proficient), "旧键 earning 已移除");
  ck(!("hardworke" in S.proficient), "旧键 hardworke 已移除");
  for (const [oldW, newW] of [["acqui", "acquire"], ["complie", "comply"]]) {
    const expected = wordSet.has(oldW) ? oldW : newW;
    ck(S.proficient[expected] === now, `${oldW} 按当前词库映射到 ${expected}`);
    ck(!S.proficient[expected === oldW ? newW : oldW], "不会同时制造新旧两个熟练标记");
  }
  ck(S.proficient.people === now, "正常词 people 保留");
  ck(T.isProficient(RAW.findIndex(a => a[0] === "downshift")), "isProficient 命中新拼写下标");
}

console.log("== 3. 加载回写与导入兼容 ==");
{
  const now = Date.now();
  const { T, store } = boot({ reskille: now, modifie: now });
  const stored = JSON.parse(store[PROF_KEY]);
  ck(stored.reskill === now, "localStorage 已回写 reskill");
  ck(!("reskille" in stored), "localStorage 中 reskille 已消解");
  const modifyKey = wordSet.has("modifie") ? "modifie" : "modify";
  ck(stored[modifyKey] === now, `localStorage 以当前正确键 ${modifyKey} 保存`);
  ck(!((modifyKey === "modifie" ? "modify" : "modifie") in stored), "localStorage 不重复保留旧新拼写");
  ck(T.getS().proficient.reskill === now, "内存态 reskill 已迁移");
  ck(T.getS().proficient[modifyKey] === now, "内存态与落盘态正确拼写一致");

  const now2 = Date.now();
  // hardworke 已改名；vanishe 若仍保留则独立，否则映射到正确词 vanish
  const b2 = boot({ hardworke: now2, vanishe: now2 });
  const next = b2.T.importState({
    settings: {}, progress: {}, days: {}, stars: {},
    proficient: { upskille: now2 }, timeSec: 0
  });
  ck(next.proficient.hardworking === now2, "导入后保留并迁移 hardworking");
  ck(next.proficient.upskill === now2, "导入文件中的 upskille → upskill");
  ck(next.proficient[wordSet.has("vanishe") ? "vanishe" : "vanish"] === now2, "vanishe 按当前词库保留或映射到 vanish");
  ck(!("hardworke" in next.proficient) && !("upskille" in next.proficient), "导入后已改名词无旧拼写键");
}

console.log("== 4. 未知词与非法熟练标记仍拒绝 ==");
{
  const now = Date.now();
  for (const bad of ["not-a-word", "downshifts"]) {
    const { T } = boot({ [bad]: now });
    ck(T.getStorageOK() === false, `非法熟练键 ${JSON.stringify(bad)} 使存储标记为不可用`);
    ck(Object.keys(T.getS().proficient).length === 0, `非法熟练键 ${JSON.stringify(bad)} 不会被静默接受`);
  }
  const { T } = boot();
  let threw = false;
  try {
    T.normalizeState({ settings: {}, progress: {}, days: {}, stars: {}, proficient: { people: 0 }, timeSec: 0 });
  } catch { threw = true; }
  ck(threw, "时间戳 0 仍拒绝");
  threw = false;
  try {
    T.normalizeState({ settings: {}, progress: {}, days: {}, stars: {}, proficient: { "not-a-word": now }, timeSec: 0 });
  } catch { threw = true; }
  ck(threw, "未知词熟练标记仍拒绝");
}

console.log("== 5. 词形修复保留正确词，删除旧下标按迁移映射 ==");
{
  const now = Date.now();
  const { T } = boot();
  const original = [[2594, "downshift"], [2769, "earnings"], [5334, "acqui"], [4258, "complie"]];
  const progress = Object.fromEntries(original.map(([i]) => [i, [1, now, 1, 0, now]]));
  const out = T.normalizeState({
    settings: {}, progress, days: {}, stars: {2594: 1}, proficient: {downshift: now}, timeSec: 0
  });
  const kept = original.filter(([, word]) => wordSet.has(word));
  ck(Object.keys(out.progress).length === kept.length, "被删坏词进度丢弃，其余旧词进度保留");
  for (const [, word] of kept) {
    const i = RAW.findIndex(a => a[0] === word);
    ck(out.progress[i]?.[0] === 1, `旧记录迁移后仍准确指向 ${word}`);
  }
  ck(out.proficient.downshift === now, "熟练键为正确拼写 downshift");
  ck(out.stars[RAW.findIndex(a => a[0] === "downshift")] === 1, "收藏同步迁移到 downshift 当前下标");
  ck(out.dv === kaoyanMeta.dataVersion, "进度迁移至当前考研数据版本");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
