#!/usr/bin/env node
/**
 * 综合词书：合并三本已发布词书，按单词去重；无需词典或网络。
 * node scripts/build-combined.mjs
 * 首次发布前重建顺序：--reset-unpublished
 * 未来有确认的源词条删除：--allow-removals（自动增加版本与删除迁移）。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const rootArg = process.argv.indexOf("--root");
if (rootArg >= 0 && !process.argv[rootArg + 1]) throw new Error("--root 后需要项目目录");
const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "js/combined-words-data.js");
const box = { window: {} };
vm.createContext(box);
const files = ["js/words-data.js", "js/cet-words-data.js"];
const sourceHashes = {};
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  sourceHashes[file] = crypto.createHash("sha256").update(source).digest("hex");
  vm.runInContext(source, box, { filename: file });
}
const defs = [
  { id: "kaoyan", key: "WORDS_RAW", papers: 46 },
  { id: "cet4", key: "WORDS_CET4", papers: 80 },
  { id: "cet6", key: "WORDS_CET6", papers: 83 }
];
const sourceMeta = box.window.WORD_BOOK_META || {};
const byWord = new Map();
for (const def of defs) {
  const words = box.window[def.key];
  if (!Array.isArray(words) || !words.length) throw new Error("缺少源词书：" + def.id);
  const seen = new Set();
  for (const tuple of words) {
    if (!Array.isArray(tuple) || tuple.length !== 11 || typeof tuple[0] !== "string" || seen.has(tuple[0])) {
      throw new Error("源词书格式错误/重复单词：" + def.id + " " + tuple?.[0]);
    }
    seen.add(tuple[0]);
    if (!byWord.has(tuple[0])) byWord.set(tuple[0], []);
    byWord.get(tuple[0]).push({ id: def.id, tuple });
  }
}

function merge(entries) {
  // 考研释义经过逐词人工精修；其余字段只在缺失时取其他来源补齐。
  const preferred = entries.find(e => e.id === "kaoyan") || entries[0];
  const firstNonempty = field => preferred.tuple[field] || entries.find(e => e.tuple[field])?.tuple[field] || "";
  const tuple = Array.from(preferred.tuple);
  tuple[1] = firstNonempty(1);
  tuple[2] = firstNonempty(2);
  tuple[5] = entries.reduce((n, e) => n + e.tuple[5], 0);
  tuple[6] = entries.reduce((n, e) => n + e.tuple[6], 0);
  tuple[9] = entries.some(e => e.tuple[9] === 1) ? 1 : 0;
  tuple[10] = firstNonempty(10);
  const score = e => {
    const example = e.tuple[7] || "";
    if (!example) return -1000;
    return (e.id === "kaoyan" ? 30 : 0)
      + (example.length >= 25 && example.length <= 300 ? 20 : 0)
      + (/[.!?]["']?$/.test(example) ? 10 : 0)
      - (/^\s*(?:[A-D][).]|\(?\d+\)?[.、])/.test(example) ? 100 : 0);
  };
  const example = entries.slice().sort((a, b) => score(b) - score(a))[0];
  tuple[7] = example.tuple[7] || "";
  tuple[8] = tuple[7] ? example.tuple[8] : "";
  return tuple;
}

const merged = [...byWord.values()].map(merge);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
merged.sort((a, b) => b[5] - a[5] || b[6] - a[6] || lexical(a[0], b[0]));
merged.forEach((tuple, index) => { tuple[4] = index + 1; });

let words = merged;
let dataVersion = 1, migrations = [], previousWordCount;
if (fs.existsSync(output) && !process.argv.includes("--reset-unpublished")) {
  const oldBox = { window: {} };
  vm.createContext(oldBox);
  vm.runInContext(fs.readFileSync(output, "utf8"), oldBox, { filename: output });
  const oldWords = oldBox.window.WORDS_COMBINED;
  const oldMeta = oldBox.window.WORD_BOOK_META?.combined;
  if (!Array.isArray(oldWords) || !oldMeta || !Number.isInteger(oldMeta.dataVersion)) throw new Error("已有综合词书格式错误");
  const map = new Map(merged.map(t => [t[0], t]));
  const removed = [];
  words = [];
  oldWords.forEach((tuple, index) => {
    if (map.has(tuple[0])) {
      words.push(map.get(tuple[0]));
      map.delete(tuple[0]);
    } else removed.push(index);
  });
  if (removed.length && !process.argv.includes("--allow-removals")) {
    throw new Error("源词书已删除 " + removed.length + " 个综合词条；确认后用 --allow-removals 记录迁移");
  }
  // 新词仅追加，词频排名仍可独立变化。
  const addedTuples = merged.filter(t => map.has(t[0]));
  const addedStart = words.length;
  words.push(...addedTuples);
  dataVersion = oldMeta.dataVersion;
  migrations = oldMeta.migrations || [];
  previousWordCount = oldMeta.previousWordCount;
  if (removed.length) {
    migrations = migrations.concat({
      from: dataVersion, to: dataVersion + 1, removed,
      removedWords: removed.map(index => oldWords[index][0]),
      added: addedTuples.map((_, i) => addedStart + i),
      addedWords: addedTuples.map(t => t[0]),
      previousWordCount: oldWords.length
    });
    dataVersion++;
    previousWordCount = oldWords.length;
  }
}
const meta = {
  id: "combined", name: "综合词书", mark: "综",
  paperCount: defs.reduce((n, d) => n + (sourceMeta[d.id]?.paperCount || d.papers), 0),
  yearRange: "考研 1998–2026 / 四级 2014–2026 / 六级 2013–2026",
  wordCount: words.length, dataVersion, migrations,
  ...(previousWordCount === undefined ? {} : { previousWordCount }),
  sources: defs.map(d => ({ id: d.id, wordCount: box.window[d.key].length, dataVersion: sourceMeta[d.id]?.dataVersion || 1 })),
  sourceHashes
};
const source = "/* 综合词书：由 scripts/build-combined.mjs 生成，数组顺序即进度主键。 */\n"
  + "window.WORD_BOOK_META = Object.assign(window.WORD_BOOK_META || {}, " + JSON.stringify({ combined: meta }, null, 2) + ");\n"
  + "window.WORDS_COMBINED = [\n" + words.map(tuple => JSON.stringify(tuple)).join(",\n") + "\n];\n";
fs.writeFileSync(output, source);
console.log("综合词书：" + words.length + " 词，" + meta.paperCount + " 套卷，数据版本 " + dataVersion);
