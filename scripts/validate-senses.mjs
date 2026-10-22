/**
 * 语境义试点数据（WORD_SENSES）静态校验（独立实现，契约以 js/app.js 的 wordSenseEntry 为准）
 * 运行：node scripts/validate-senses.mjs
 * 退出码：存在 error → 1；仅 warning 或全部通过 → 0
 * 报告：tests/reports/senses-validation.md（tests/reports 已在 .gitignore）
 *
 * 校验对象：js/senses-data.js
 *   window.WORD_SENSES = { schemaVersion: 1, books: { kaoyan, cet4, cet6, combined } }
 *   每书：{ 单词: { preferred: [{ meaning, examples: [{ source, quote, surface, label? }] }], additional } }
 * 证据来源：js/words-data.js / js/cet-words-data.js / js/combined-words-data.js 的 11 元组真题例句。
 *   非综合书的 preferred 证据必须是「本书该词」自己的 example/source；
 *   综合书可用任意一书的真题原句（补充义），但 (source, quote) 必须能在词库中找到，出处不得编造。
 *   任何 source 为「自编」的句子不得作为 preferred 证据。
 *
 * 独立复核，不 import 生成脚本；数据由 vm 加载，只读。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const DATA_FILE = path.join(ROOT, "js", "senses-data.js");
const WORD_FILES = [
  path.join(ROOT, "js", "words-data.js"),
  path.join(ROOT, "js", "cet-words-data.js"),
  path.join(ROOT, "js", "combined-words-data.js"),
];
const REPORT = path.join(ROOT, "tests", "reports", "senses-validation.md");

const BOOK_KEYS = ["kaoyan", "cet4", "cet6", "combined"];
const BOOK_LABEL = { kaoyan: "考研英语", cet4: "英语四级", cet6: "英语六级", combined: "综合词书" };
const ARRAY_OF = { kaoyan: "WORDS_RAW", cet4: "WORDS_CET4", cet6: "WORDS_CET6", combined: "WORDS_COMBINED" };
const MIN_WORDS = 50;
const MAX_WORDS = 100;
const MIN_COMBINED = 10;
const MAX_COMBINED = 20;
const SRC_RE = /^(?:(?:四级|六级) \d{4}\.\d{2}|(?:英语一|英语二|旧题型) \d{4})$/;
const WORD_KEY_RE = /^[a-z][a-z'’-]*$/;
const WORD_RE = /^[a-z]+$/;
const SELF_MADE_RE = /^自编(?:例句)?$/;
const CLAIM_RE = /真题考义|已核验|逐义核验|全部核验/;
const SCRIPT_TOKEN_RE = /(^|\n)\s*(?:import\s|export\s)|require\s*\(|\bfetch\s*\(|XMLHttpRequest|import\s*\(/;

const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const isStr = v => typeof v === "string";
const read = file => fs.readFileSync(file, "utf8");
const short = (s, n = 90) => { const t = norm(s); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// ---------- 结果收集 ----------
const issues = [];
const err = (type, book, word, detail) => issues.push({ sev: "error", type, book, word, detail });
const warn = (type, book, word, detail) => issues.push({ sev: "warn", type, book, word, detail });

// ---------- 加载词库 ----------
function loadWords() {
  const box = vm.createContext({ window: {} });
  for (const file of WORD_FILES) vm.runInContext(read(file), box, { filename: path.relative(ROOT, file) });
  const books = {};
  for (const key of BOOK_KEYS) {
    const arr = box.window[ARRAY_OF[key]];
    if (!Array.isArray(arr)) throw new Error(`词库缺失：${ARRAY_OF[key]}`);
    const map = new Map();
    for (const t of arr) if (Array.isArray(t) && isStr(t[0])) map.set(t[0], t);
    books[key] = { arr, map };
  }
  return books;
}

// (source, quote) 组合 → 出现在哪些书里；用于综合书跨书证据溯源
function evidenceIndex(wordBooks) {
  const index = new Map();
  for (const key of BOOK_KEYS) {
    for (const t of wordBooks[key].arr) {
      if (!Array.isArray(t)) continue;
      const source = String(t[8] ?? "");
      const quote = norm(t[7]);
      if (!source || SELF_MADE_RE.test(source) || !quote) continue;
      const k = source + "\u0000" + quote;
      if (!index.has(k)) index.set(k, new Set());
      index.get(k).add(key);
    }
  }
  return index;
}

// ---------- 加载语境义数据 ----------
if (!fs.existsSync(DATA_FILE)) {
  console.error(`[致命] 找不到 ${path.relative(ROOT, DATA_FILE)}`);
  process.exit(1);
}
const dataSource = read(DATA_FILE);
const box = vm.createContext({ window: {} });
try {
  vm.runInContext(dataSource, box, { filename: "js/senses-data.js" });
} catch (e) {
  console.error(`[致命] js/senses-data.js 无法作为 <script> 执行：${e.message}`);
  process.exit(1);
}
const data = box.window.WORD_SENSES;
let wordBooks;
try {
  wordBooks = loadWords();
} catch (e) {
  console.error(`[致命] 词库加载失败：${e.message}`);
  process.exit(1);
}
const evidence = evidenceIndex(wordBooks);

// ---------- 1. 顶层 schema ----------
if (!isObj(data)) {
  err("schema", "", "", "window.WORD_SENSES 不是对象");
} else {
  if (data.schemaVersion !== 1) err("schema", "", "", `schemaVersion 必须为 1，实际 ${JSON.stringify(data.schemaVersion)}`);
  if (!isObj(data.books)) err("schema", "", "", "books 必须为对象");
  else {
    const keys = Object.keys(data.books);
    for (const key of BOOK_KEYS) if (!isObj(data.books[key])) err("schema", key, "", `books.${key} 缺失或不是对象（页面会整体回退）`);
    for (const key of keys) if (!BOOK_KEYS.includes(key)) err("schema", key, "", `未知词书键 books.${key}`);
  }
}
if (issues.some(i => i.sev === "error")) {
  // 顶层不合格时继续收集部分信息没有意义；仍写出报告便于定位。
  writeReport(null);
  process.exit(1);
}

// ---------- 2. 静态可加载性 ----------
if (SCRIPT_TOKEN_RE.test(dataSource)) err("loadable", "", "", "数据文件不得包含 import/export/require/fetch/XMLHttpRequest，必须可直接 <script> 加载");

// ---------- 3. 逐书逐词校验 ----------
const stats = {};
const evidenceOrigin = { sameBook: 0, crossBook: 0, combinedOwn: 0, byBook: {} };
const sourceCount = new Map();
let totalWords = 0, totalSenses = 0, totalExamples = 0;

function checkExample(book, word, senseIdx, exIdx, example) {
  const where = `preferred[${senseIdx}].examples[${exIdx}]`;
  if (!isObj(example)) return err("example", book, word, `${where} 不是对象`);
  for (const field of ["source", "quote", "surface"]) {
    if (!isStr(example[field]) || !example[field].trim()) return err("example", book, word, `${where}.${field} 必须是非空字符串`);
  }
  if (example.label !== undefined && !isStr(example.label)) return err("example", book, word, `${where}.label 若存在必须是字符串`);
  const source = example.source.trim();
  const quote = norm(example.quote);
  const surface = norm(example.surface);
  if (SELF_MADE_RE.test(source)) return err("self-made", book, word, `${where} 把自编例句标成了 preferred 证据（source=${source}）`);
  if (!SRC_RE.test(source)) err("source-format", book, word, `${where} source 不像真题出处：${source}`);
  if (quote.length < 20) warn("short-quote", book, word, `${where} 原句仅 ${quote.length} 字符：${short(quote, 50)}`);
  // 已人工确认的残句/OCR 不能因与旧词库一致而升级为“已核对”证据。
  if (/\bby St\.$|\bacts\.\s+of advocacy\b|\battribute to various gadgets\.$/i.test(quote)) {
    err("incomplete-evidence", book, word, `${where} 含已确认的截断或缺词：${short(quote)}`);
  }
  if (!quote.toLowerCase().includes(surface.toLowerCase())) {
    return err("surface", book, word, `${where} surface「${surface}」未在 quote 中命中`);
  }
  if (!WORD_RE.test(surface)) return err("surface-format", book, word, `${where} surface 必须是英文词形：${surface}`);
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’-]/g, "['’\\-]");
  if (!new RegExp(`\\b${escaped}\\b`, "i").test(quote)) {
    err("surface-boundary", book, word, `${where} surface「${surface}」不是独立词形（可能是其他单词的子串）`);
  }
  // 来源与出处溯源
  if (book !== "combined") {
    const tuple = wordBooks[book].map.get(word);
    const ownSource = tuple ? String(tuple[8] ?? "") : "";
    const ownQuote = tuple ? norm(tuple[7]) : "";
    if (ownSource !== source || ownQuote !== quote) {
      err("provenance", book, word, `${where} 非综合书证据必须来自本书该词自己的 11 元组（source/quote 不一致）`);
    } else evidenceOrigin.sameBook++;
  } else {
    const hit = evidence.get(source + "\u0000" + quote);
    if (!hit) {
      err("provenance", book, word, `${where} 在四书词库中找不到该 (source, quote) 真题原句，疑似编造出处`);
    } else {
      const ownTuple = wordBooks.combined.map.get(word);
      const ownEvidence = ownTuple && String(ownTuple[8] ?? "") === source && norm(ownTuple[7]) === quote;
      if (ownEvidence) evidenceOrigin.combinedOwn++;
      else {
        evidenceOrigin.crossBook++;
        if (!evidenceOrigin.supplement) evidenceOrigin.supplement = [];
        evidenceOrigin.supplement.push({ word, source, hitBooks: [...hit].sort().join("/") });
      }
      const expect = source.startsWith("四级") ? "cet4" : source.startsWith("六级") ? "cet6" : null;
      if (expect && !hit.has(expect)) {
        err("provenance", book, word, `${where} source=${source} 与词库出处不一致（未在 ${expect} 词库找到该原句）`);
      }
      evidenceOrigin.byBook[word] = { hitBooks: [...hit].sort(), source };
    }
  }
  sourceCount.set(source, (sourceCount.get(source) || 0) + 1);
}

for (const book of BOOK_KEYS) {
  const entries = data.books[book];
  const words = Object.keys(entries);
  const wordSet = wordBooks[book].map;
  const stat = { words: words.length, senses: 0, examples: 0, sources: new Set(), preferredPerWord: [] };
  stats[book] = stat;
  for (const word of words) {
    const entry = entries[word];
    if (!WORD_KEY_RE.test(word) || word !== word.toLowerCase()) err("word-key", book, word, "词键必须是小写英文单词");
    if (!wordSet.has(word)) err("word-missing", book, word, "该词不在对应词书的 11 元组中（页面按本词书隔离读取，永远命中不了）");
    if (!isObj(entry)) { err("entry", book, word, "entry 不是对象"); continue; }
    if (!isStr(entry.additional)) err("entry", book, word, "additional 必须是字符串（可为空）");
    else if (CLAIM_RE.test(entry.additional)) warn("additional-claim", book, word, `additional 不得声称已核验/真题考义：${short(entry.additional, 60)}`);
    if (!Array.isArray(entry.preferred) || !entry.preferred.length) { err("entry", book, word, "preferred 必须是非空数组"); continue; }
    for (const key of Object.keys(entry)) if (!["preferred", "additional"].includes(key)) warn("entry-extra", book, word, `entry 含未知字段 ${key}（页面忽略，但建议删除）`);
    stat.preferredPerWord.push(entry.preferred.length);
    entry.preferred.forEach((sense, si) => {
      if (!isObj(sense)) return err("sense", book, word, `preferred[${si}] 不是对象`);
      if (!isStr(sense.meaning) || !sense.meaning.trim()) return err("sense", book, word, `preferred[${si}].meaning 必须是非空字符串`);
      if (CLAIM_RE.test(sense.meaning)) warn("sense-claim", book, word, `preferred[${si}].meaning 含核验措辞：${short(sense.meaning, 60)}`);
      if (!Array.isArray(sense.examples) || !sense.examples.length) return err("sense", book, word, `preferred[${si}].examples 必须是非空数组`);
      stat.senses++;
      sense.examples.forEach((example, ei) => {
        stat.examples++;
        checkExample(book, word, si, ei, example);
      });
    });
  }
  totalWords += words.length; totalSenses += stat.senses; totalExamples += stat.examples;
  for (const source of sourceCount.keys()) stat.sources.add(source);
}

// ---------- 4. 规模与分布 ----------
if (totalWords < MIN_WORDS || totalWords > MAX_WORDS) {
  err("count", "", "", `总条目数必须在 ${MIN_WORDS}–${MAX_WORDS}，实际 ${totalWords}`);
}
const combinedCount = stats.combined.words;
if (combinedCount < MIN_COMBINED || combinedCount > MAX_COMBINED) {
  err("count", "combined", "", `综合书补充试点条目必须在 ${MIN_COMBINED}–${MAX_COMBINED}，实际 ${combinedCount}`);
}
for (const book of ["kaoyan", "cet4", "cet6"]) {
  if (stats[book].words < 10) err("count", book, "", `${BOOK_LABEL[book]}条目过少（建议 kaoyan≈40 / cet4≈20 / cet6≈20），实际 ${stats[book].words}`);
}

// ---------- 5. 综合书补充义专项（提示词 10：apply 涂抹/敷、content 含量） ----------
function findSense(book, word, keyword) {
  const entry = data.books[book] && data.books[book][word];
  if (!isObj(entry) || !Array.isArray(entry.preferred)) return null;
  return entry.preferred.find(s => isObj(s) && isStr(s.meaning) && s.meaning.includes(keyword)) || null;
}
const supplementChecks = [
  { word: "apply", keyword: "涂抹", label: "apply「涂抹、敷」" },
  { word: "content", keyword: "含量", label: "content「含量」" },
];
const supplementResults = [];
for (const item of supplementChecks) {
  const sense = findSense("combined", item.word, item.keyword);
  if (!sense) {
    err("combined-supplement", "combined", item.word, `缺少 ${item.label} 补充义项`);
    supplementResults.push({ label: item.label, ok: false, detail: "缺少义项" });
    continue;
  }
  const example = sense.examples && sense.examples[0];
  const source = isObj(example) ? String(example.source || "") : "";
  const label = isObj(example) ? String(example.label || "") : "";
  if (!source.startsWith("四级")) {
    err("combined-supplement", "combined", item.word, `${item.label} 的 source 必须写明四级真题来源，实际「${source}」`);
  }
  if (!/四级/.test(label) && !/四级/.test(source)) {
    err("combined-supplement", "combined", item.word, `${item.label} 的 source/label 必须明确标注四级真题来源`);
  }
  supplementResults.push({ label: item.label, ok: true, detail: `source=${source}${label ? ` · label=${label}` : ""}`, quote: isObj(example) ? short(example.quote, 80) : "" });
}
// 综合书不得出现「自编」证据（已在逐条校验中覆盖），补充义不得影响其他书：同一单词在其他书保持自己的义项
for (const book of ["kaoyan", "cet4", "cet6"]) {
  const apply = data.books[book] && data.books[book].apply;
  if (apply && Array.isArray(apply.preferred) && apply.preferred.some(s => isStr(s?.meaning) && s.meaning.includes("涂抹"))) {
    err("four-book-isolation", book, "apply", "涂抹/敷是综合书补充义，不应回写到其他词书的 preferred");
  }
}

// 人工句法复核：短语整体义不得冒充单词词性，及物结构不得写成不及物义。
for (const [book, word, phrase] of [
  ["kaoyan", "high", "high street"], ["combined", "high", "high street"],
  ["kaoyan", "take", "take turns"], ["combined", "take", "take turns"],
  ["cet6", "place", "take place"], ["kaoyan", "effect", "in effect"],
]) {
  const meanings = (data.books[book]?.[word]?.preferred || []).map(s => s.meaning).join("；");
  if (!meanings.includes("搭配") || !meanings.includes(phrase)) {
    err("reviewed-syntax", book, word, `已核对语境需明确为固定搭配 ${phrase}，不能把短语整体义标成单词词性`);
  }
}
const benefit = data.books.cet6?.benefit?.preferred || [];
if (!benefit.some(s => /^vt\./.test(s.meaning) && /使受益|有益于/.test(s.meaning))) {
  err("reviewed-syntax", "cet6", "benefit", "benefit both researchers and the communities 是及物结构，应解释为使受益/有益于");
}

// ---------- 6. 四书隔离与来源分布统计 ----------
const bookSourceDist = {};
for (const book of BOOK_KEYS) {
  const dist = new Map();
  for (const [word, entry] of Object.entries(data.books[book])) {
    for (const sense of entry.preferred) for (const example of sense.examples) {
      dist.set(example.source, (dist.get(example.source) || 0) + 1);
    }
  }
  bookSourceDist[book] = [...dist.entries()].sort((a, b) => b[1] - a[1]);
}
const selfMade = [];
for (const book of BOOK_KEYS) {
  for (const [word, entry] of Object.entries(data.books[book])) {
    for (const sense of entry.preferred) for (const example of sense.examples) {
      if (SELF_MADE_RE.test(String(example.source))) selfMade.push(`${book}/${word}`);
    }
  }
}

// ---------- 7. 输出 ----------
const errors = issues.filter(i => i.sev === "error");
const warnings = issues.filter(i => i.sev === "warn");
const report = [];
report.push("# WORD_SENSES 语境义数据校验报告", "");
report.push(`- 生成时间：${new Date().toISOString()}`);
report.push(`- 数据文件：js/senses-data.js（${(Buffer.byteLength(dataSource) / 1024).toFixed(1)} KB）`);
report.push(`- 词库：words-data.js / cet-words-data.js / combined-words-data.js（vm 只读加载）`);
report.push(`- 结论：${errors.length ? "❌ 不合格" : "✅ 通过"}（error ${errors.length} / warning ${warnings.length}）`);
report.push("", "## 每书统计", "", "| 词书 | 词数 | 义项数 | 例句数 | 真题来源数 |", "| --- | ---: | ---: | ---: | ---: |");
for (const book of BOOK_KEYS) report.push(`| ${BOOK_LABEL[book]}（${book}） | ${stats[book].words} | ${stats[book].senses} | ${stats[book].examples} | ${bookSourceDist[book].length} |`);
report.push(`| **合计** | **${totalWords}** | **${totalSenses}** | **${totalExamples}** | **${sourceCount.size}** |`);
report.push("", "## 证据来源分布（按词书）", "");
for (const book of BOOK_KEYS) {
  report.push(`### ${BOOK_LABEL[book]}（${book}）`, "");
  report.push(...(bookSourceDist[book].length ? bookSourceDist[book].map(([s, n]) => `- ${s}: ${n}`) : ["- （无）"]));
  report.push("");
}
report.push("## 证据溯源", "");
report.push(`- 非综合书本词原句：${evidenceOrigin.sameBook}`);
report.push(`- 综合书本人词条原句：${evidenceOrigin.combinedOwn}`);
report.push(`- 综合书跨书补充义原句（四级/六级/考研真题）：${evidenceOrigin.crossBook}`);
if (evidenceOrigin.supplement) {
  for (const s of evidenceOrigin.supplement) report.push(`  - ${s.word}：source=${s.source}（命中词库：${s.hitBooks}）`);
}
report.push(`- 自编例句冒充 preferred 证据：${selfMade.length}（必须为 0）`);
report.push("", "### 综合书补充义核验", "");
for (const r of supplementResults) report.push(`- ${r.ok ? "✅" : "❌"} ${r.label}：${r.detail}${r.quote ? `\n  - 原句：${r.quote}` : ""}`);
report.push("", "## 校验规则", "");
report.push("- schemaVersion===1；books 恰好包含 kaoyan/cet4/cet6/combined；");
report.push("- 每书 entry={preferred:非空数组, additional:字符串}；每个 sense={meaning:非空, examples:非空}；");
report.push("- 每个 example 的 source/quote/surface 非空；quote 归一化后必须包含 surface（大小写不敏感）；");
report.push("- source 必须是词库中真实存在的真题出处，禁止「自编」；");
report.push("- 非综合书证据必须是本书该词自己的 11 元组 example/source；综合书补充义可用其他书真题原句，但 (source, quote) 必须能在词库中溯源；");
report.push("- 单词必须存在于对应词书的 11 元组；四书独立键控，补充义不得回写其他书；");
report.push("- 规模：总条目 50–100，综合书补充 10–20。");
report.push("", "## 问题列表", "");
if (!issues.length) report.push("- 无");
for (const i of issues) report.push(`- [${i.sev.toUpperCase()}] ${i.type}${i.book ? ` · ${i.book}` : ""}${i.word ? `/${i.word}` : ""}：${i.detail}`);
writeReport(report.join("\n"));

function writeReport(text) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, text, "utf8");
}

console.log(`WORD_SENSES 校验：条目 ${totalWords}，义项 ${totalSenses}，例句 ${totalExamples}`);
for (const book of BOOK_KEYS) console.log(`  ${book}: ${stats[book].words} 词 / ${stats[book].senses} 义项 / ${stats[book].examples} 例句`);
console.log(`  证据：同书 ${evidenceOrigin.sameBook}，综合本人 ${evidenceOrigin.combinedOwn}，综合跨书 ${evidenceOrigin.crossBook}，自编冒充 ${selfMade.length}`);
for (const i of issues) console.log(`  ${i.sev === "error" ? "ERROR" : "WARN "} ${i.type}${i.book ? ` [${i.book}${i.word ? "/" + i.word : ""}]` : ""} ${i.detail}`);
console.log(`报告：${path.relative(ROOT, REPORT)}`);
console.log(errors.length ? `❌ 不合格：${errors.length} 个 error` : `✅ 通过（warning ${warnings.length}）`);
process.exit(errors.length ? 1 : 0);
