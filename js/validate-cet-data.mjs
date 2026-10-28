/**
 * 四六级词书数据静态校验（qa-verify 独立实现，契约 3.3 + 4.1）
 * 运行：node js/validate-cet-data.mjs
 * 退出码：存在 error → 1；仅 warning 或全部通过 → 0
 * 报告：tests/reports/四六级数据校验报告.md
 *
 * 校验对象：js/cet-words-data.js
 *   window.WORD_BOOK_META = { cet4: {...}, cet6: {...} }
 *   window.WORDS_CET4 / window.WORDS_CET6 = [[...11 元组...], ...]
 * 11 元组（与 js/words-data.js 一致）：
 *   0 w  1 ph  2 m  3 p(posIdx)  4 r  5 f  6 c  7 ex  8 src  9 ky  10 fm
 *
 * 独立复核，不 import 生成脚本；数据由 vm 加载，只读。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { contentEncodingFields, isConfirmedBadExample, exampleHasInflectedForm, mechanicalExampleRisks, confirmedCorrectionIssues, isRemovedHeadword, meaningContentIssues } from "./content-validation.mjs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
// 默认校验正式交付文件；CET_DATA_FILE 仅供开发期自测 fixture（最终验收不得设置）
const DATA = process.env.CET_DATA_FILE || path.join(HERE, "cet-words-data.js");
const WORDFREQ = path.join(ROOT, "tests", "fixtures", "cet-wordfreq.json");
const MANIFEST = path.join(ROOT, "tests", "fixtures", "cet-manifest.json");
const REPORT = path.join(ROOT, "tests", "reports", "四六级数据校验报告.md");

const FIELD = ["w", "ph", "m", "p", "r", "f", "c", "ex", "src", "ky", "fm"];
const FIELD_CN = ["单词", "音标", "释义", "词性索引", "排名", "词频", "套数", "例句", "例句出处", "大纲标记", "词形"];
const POS_MAX = 15;
const BOOKS = {
  cet4: { label: "四级", mark: "四", name: "英语四级", track: "cet4", srcBook: "四级" },
  cet6: { label: "六级", mark: "六", name: "英语六级", track: "cet6", srcBook: "六级" },
};
const APPENDED = ["will", "may", "can", "one", "own"]; // 契约 3.1：与考研一致补回的实义虚词，必须在末尾

const isInt = n => typeof n === "number" && Number.isInteger(n);
const isStr = v => typeof v === "string";
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const WORD_RE = /^[a-z]+$/;
const SRC_RE = /^(?:(?:四级|六级) \d{4}\.\d{2}|(?:英语一|英语二|旧题型) \d{4}|自编(?:例句)?|词典例句)$/;
const CET_SRC_RE = /^(四级|六级) (\d{4})\.(\d{2})$/;
const KAO_SRC_RE = /^(英语一|英语二|旧题型) (\d{4})$/;
function srcYear(src){const s=String(src||"");const c=s.match(CET_SRC_RE);if(c)return Number(c[2]);const k=s.match(KAO_SRC_RE);return k?Number(k[2]):null;}
const YEAR_RANGE_RE = /^(\d{4})[–-](\d{4})$/;
const PLACEHOLDER_RE = /TODO|FIXME|待补|暂无|无释义|占位|N\/A|\bnull\b|\bundefined\b|xxx+/i;
const DANGER_RE = /<script|onerror\s*=|onload\s*=|javascript:|<\/?iframe|<\/?img|<\/?svg/i;
const BAD_CHAR_RE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
// 2026-10-25 批次 A/B：与考研校验器同一口径；只保留单主读音、词形说明可解析。
const PH_LEAD_DOT = /^\s*\./;
const PH_MULTI_SEP = /[;；]|\.\s/;
const PH_SPACE = /\s/;
const PH_TRAIL_HYPHEN = /-\s*$/;
const PH_NONSTD = /[\u02b9\u03b5\u02ca\u02cb\u025a\u0279]/;
const FM_PART_RE = /^(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)\s+[a-z]+(?:\/[a-z]+)*$/;

// ---------- 结果收集 ----------
const issues = [];
function err(type, label, book, idx, word, detail) { issues.push({ sev: "error", type, label, book, idx, word, detail }); }
function warn(type, label, book, idx, word, detail) { issues.push({ sev: "warn", type, label, book, idx, word, detail }); }
const short = (s, n = 70) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// ---------- 加载 ----------
if (!fs.existsSync(DATA)) {
  console.error(`[致命] 找不到 ${path.relative(ROOT, DATA)}（词书数据尚未产出？）`);
  process.exit(1);
}
const rawSource = fs.readFileSync(DATA, "utf8");
if (rawSource.charCodeAt(0) === 0xfeff) err("编码", "文件含 UTF-8 BOM", null, null, null, null);
let win;
try {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(rawSource, sandbox, { filename: "cet-words-data.js", timeout: 30000 });
  win = sandbox.window;
} catch (e) {
  console.error(`[致命] 解析 js/cet-words-data.js 失败：${e.message}`);
  process.exit(1);
}

const meta = win.WORD_BOOK_META;
if (!meta || typeof meta !== "object") {
  console.error("[致命] window.WORD_BOOK_META 缺失");
  process.exit(1);
}

// 读取 cet-wordfreq.json（可选交叉核对；缺失时跳过并记录 warning）
let wf = null;
if (fs.existsSync(WORDFREQ)) {
  try { wf = JSON.parse(fs.readFileSync(WORDFREQ, "utf8")); }
  catch (e) { warn("交叉核对", `cet-wordfreq.json 无法解析：${e.message}`, null, null, null, null); }
} else {
  warn("交叉核对", "cet-wordfreq.json 不存在，跳过词频/排名交叉核对", null, null, null, null);
}
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch (e) { /* 可选 */ }

// ---------- 工具 ----------
function checkCommon(index, bookKey, entries) {
  const seen = new Map();
  let meaningBad = 0, nonCjkMeaning = 0, phishing = 0, exBadSrc = 0, exNoWord = 0, exampleCount = 0;
  let phoneticCount = 0, fmCount = 0, kyCount = 0, htmlDanger = 0;
  const rSet = new Set(), rDup = [], dupList = [], badWords = [], badTuple = [], badType = [], badPos = [], badF = [], badC = [], badKy = [], badSrcList = [];

  entries.forEach((row, i) => {
    if (!Array.isArray(row)) { badTuple.push(i); return; }
    if (row.length !== 11) { badTuple.push(i); return; }
    const [w, ph, m, p, r, f, c, ex, src, ky, fm] = row;
    if (!isStr(w)) { badType.push([i, 0]); return; }
    if (seen.has(w)) dupList.push([i, w, seen.get(w)]); else seen.set(w, i);
    if (!WORD_RE.test(w)) badWords.push([i, w]);
    if (!isStr(ph)) badType.push([i, 1]);
    if (!isStr(m)) badType.push([i, 2]);
    if (!isInt(p)) badType.push([i, 3]); else if (p < 0 || p > POS_MAX) badPos.push([i, p]);
    if (!isInt(r)) badType.push([i, 4]); else { if (rSet.has(r) && rDup.length < 20) rDup.push([i, w, r]); rSet.add(r); }
    if (!isInt(f)) badType.push([i, 5]); else if (f < 1) badF.push([i, f]);
    if (!isInt(c)) badType.push([i, 6]); else if (c < 1 || c > index.paperCount) badC.push([i, c]);
    if (!isStr(ex)) badType.push([i, 7]);
    if (!isStr(src)) badType.push([i, 8]);
    if (!isInt(ky)) badType.push([i, 9]); else if (ky !== 0 && ky !== 1) badKy.push([i, ky]);
    if (!isStr(fm)) badType.push([i, 10]);

    if (typeof m === "string") {
      if (!m.trim() || PLACEHOLDER_RE.test(m)) meaningBad++;
      if (!CJK.test(m)) nonCjkMeaning++;
      if (DANGER_RE.test(m)) htmlDanger++;
      for (const issue of meaningContentIssues(m)) err("释义", "释义内容异常", bookKey, i, w, issue);
    }
    if (typeof w === "string" && DANGER_RE.test(w)) htmlDanger++;
    if (typeof ph === "string") {
      if (ph.trim()) phoneticCount++; else err("音标", "音标缺失", bookKey, i, w, "2026-10-25 已全量补齐；新缺失须由 content-fixes-phonetic-20261025 记录");
      if (DANGER_RE.test(ph) || BAD_CHAR_RE.test(ph)) htmlDanger++;
      if (PH_LEAD_DOT.test(ph)) err("音标", "音标以分隔点开头（应为次重音 ˌ 或删除）", bookKey, i, w, short(ph));
      if (PH_MULTI_SEP.test(ph)) err("音标", "音标含多读音/分隔符", bookKey, i, w, short(ph));
      if (PH_SPACE.test(ph)) err("音标", "音标含空白字符", bookKey, i, w, JSON.stringify(ph));
      if (PH_TRAIL_HYPHEN.test(ph)) err("音标", "音标以连字符结尾（变体缩写残留）", bookKey, i, w, short(ph));
      if (PH_NONSTD.test(ph)) err("音标", "音标含非标准符号（疑似误植）", bookKey, i, w, short(ph));
    }
    if (typeof fm === "string" && fm.trim()) {
      fmCount++;
      if (w !== "lie") {
        for (const part of fm.split(/[；;]/).map((x) => x.trim()).filter(Boolean)) {
          if (!FM_PART_RE.test(part)) err("词形", "词形说明不可解析", bookKey, i, w, short(part));
        }
      }
      for (const match of fm.matchAll(/复数\s+([a-z]+)/g)) {
        if (/(ss|zz|xx)$/.test(match[1]) && !/(ss|zz|xx)$/.test(w)) err("词形", "复数词形疑似机械加 s", bookKey, i, w, short(fm));
      }
    }
    if (typeof ex === "string" && ex.trim()) {
      exampleCount++;
      if (DANGER_RE.test(ex) || BAD_CHAR_RE.test(ex)) htmlDanger++;
      const srcOk = typeof src === "string" && SRC_RE.test(src);
      if (!srcOk) { exBadSrc++; if (badSrcList.length < 8) badSrcList.push([i, w, src, ex]); }
      // 与页面共用词头/fm/不规则表及保守规则屈折，仅作覆盖 warning。
      if (!exampleHasInflectedForm(w, ex, fm, p)) {
        exNoWord++; if (exNoWord <= 6) warn("例句", "例句疑似不含对应词头/合理屈折", bookKey, i, w, short(ex));
      }
    }
    if (typeof src === "string" && src && row[7] && src.trim()) { /* src 合法性在例句分支判定 */ }
    const badEncodingFields = contentEncodingFields(row);
    if (badEncodingFields.length) err("编码", "字段含控制字符/替换符/私用区", bookKey, i, w, `字段 ${badEncodingFields.map(k => FIELD[k]).join("/")}`);
    if (isConfirmedBadExample(ex)) err("内容修订", "已确认污染例句回流", bookKey, i, w, short(ex));
    for (const issue of confirmedCorrectionIssues(bookKey, row)) err("内容修订", "已确认内容修订回流", bookKey, i, w, issue);
    if (isRemovedHeadword(bookKey, w)) err("内容修订", "已删除词头回流", bookKey, i, w, "OCR 假词条已随 dataVersion 迁移删除，不得重新加入");
    const mechRisks = mechanicalExampleRisks(ex);
    if (mechRisks.length) warn("例句", "疑似机械污染（待人工核验：" + mechRisks.join("/") + "）", bookKey, i, w, short(ex));
    if (ky === 1) kyCount++;
    if (BAD_CHAR_RE.test(String(w) + String(m) + String(ex) + String(fm))) phishing++;
  });

  // 行/字段级错误汇总
  if (badTuple.length) err("结构", `元组不是 11 元（共 ${badTuple.length} 条）`, bookKey, badTuple[0], entries[badTuple[0]]?.[0], `前几例下标 ${badTuple.slice(0, 10).join(",")}`);
  if (badType.length) err("类型", `字段类型错误（共 ${badType.length} 处）`, bookKey, badType[0][0], entries[badType[0][0]]?.[0], badType.slice(0, 8).map(([i, k]) => `#${i}.${FIELD[k]}:${typeof entries[i]?.[k]}`).join(" "));
  if (badWords.length) err("单词", `非全小写 ASCII 字母（共 ${badWords.length} 条）`, bookKey, badWords[0][0], badWords[0][1], badWords.slice(0, 10).map(x => x[1]).join(","));
  if (dupList.length) err("单词", `重复单词（共 ${dupList.length} 条）`, bookKey, dupList[0][0], dupList[0][1], dupList.slice(0, 10).map(([i, w, j]) => `${w}@${j},${i}`).join(" "));
  if (badPos.length) err("词性", `posIdx 越界 [0,${POS_MAX}]（共 ${badPos.length} 条）`, bookKey, badPos[0][0], entries[badPos[0][0]]?.[0], badPos.slice(0, 10).map(x => x[1]).join(","));
  const N = entries.length;
  const missingR = [];
  for (let r = 1; r <= N; r++) if (!rSet.has(r)) missingR.push(r);
  if (missingR.length) err("排名", `r 不连续：缺 ${missingR.length} 个（如 ${missingR.slice(0, 8).join(",")}）`, bookKey, null, null, `期望 1..${N} 全覆盖`);
  if (rDup.length) err("排名", `r 存在重复（如 ${rDup.slice(0, 6).map(x => `${x[1]}:${x[2]}`).join(" ")}）`, bookKey, rDup[0][0], rDup[0][1], null);
  if (badF.length) err("词频", `f < 1（共 ${badF.length} 条）`, bookKey, badF[0][0], entries[badF[0][0]]?.[0], badF.slice(0, 10).map(x => x[1]).join(","));
  if (badC.length) err("套数", `c 越界 [1, ${index.paperCount}]（共 ${badC.length} 条）`, bookKey, badC[0][0], entries[badC[0][0]]?.[0], badC.slice(0, 10).map(x => x[1]).join(","));
  if (badKy.length) err("大纲", `ky 非 0/1（共 ${badKy.length} 条）`, bookKey, badKy[0][0], entries[badKy[0][0]]?.[0], badKy.slice(0, 10).map(x => x[1]).join(","));
  if (meaningBad) err("释义", `释义空/占位（${meaningBad}/${N}）`, bookKey, null, null, null);
  if (nonCjkMeaning) warn("释义", `释义不含中文（${nonCjkMeaning}/${N}）`, bookKey, null, null, null);
  if (htmlDanger) err("安全", `字段疑似含 HTML/脚本（${htmlDanger} 处）`, bookKey, null, null, null);
  if (exBadSrc) err("例句", `例句出处格式非法或与本级不符（${exBadSrc}/${exampleCount}）`, bookKey, badSrcList[0]?.[0], badSrcList[0]?.[1], `如 ${badSrcList.slice(0, 5).map(x => JSON.stringify(x[2])).join(",")}`);
  if (exNoWord) warn("例句", `疑似例句不含对应词头/合理屈折（${exNoWord}/${exampleCount}，复用页面词形规则）`, bookKey, null, null, null);
  if (phishing) warn("编码", `字段含控制字符/替换符（${phishing} 条）`, bookKey, null, null, null);

  // r 排序结构：补回实义虚词（若存在）必须连续追加在数组末尾，之前部分 r 严格递增
  let trailing = 0;
  // 补回实义虚词（will/may/can/one/own）应形成连续块，位于原有词表末尾；
  // 后续修复可在这 5 词之后追加新词，因此不再要求它们是整个数组的最后 5 项。
  const expectedTail = APPENDED.filter(w => seen.has(w));
  const positions = expectedTail.map(w => entries.findIndex(x => x?.[0] === w)).filter(i => i >= 0);
  const blockStart = positions.length ? Math.min(...positions) : -1;
  const blockEnd = positions.length ? Math.max(...positions) : -1;
  const blockWords = blockStart >= 0 ? entries.slice(blockStart, blockEnd + 1).map(x => x[0]) : [];
  const blockOK = expectedTail.length === blockWords.length
    && blockWords.every(w => expectedTail.includes(w));
  if (expectedTail.length && !blockOK) {
    err("结构", "补回实义虚词未形成连续块", bookKey, null, null,
      `块=${blockWords.join(",") || "—"}；书内存在的补回词=${expectedTail.join(",") || "—"}`);
  }
  const earlyAppended = entries.slice(0, Math.max(0, blockStart)).filter(x => APPENDED.includes(x?.[0])).map(x => x[0]);
  if (earlyAppended.length) err("结构", `补回词出现在数组中间：${earlyAppended.slice(0, 8).join(",")}`, bookKey, null, null, null);
  // r 是展示/排序名次，词频修复后可独立重排；数组顺序是进度主键，不要求与 r 同步。
  const prefixEnd = blockStart >= 0 ? blockStart : entries.length;
  let lastR = -1, unsorted = 0;
  for (let i = 0; i < prefixEnd; i++) {
    const r = entries[i]?.[4];
    if (isInt(r)) { if (r <= lastR) unsorted++; lastR = r; }
  }
  if (unsorted) warn("结构", `补回词之前数组顺序与 r 不一致（${unsorted} 处逆序；词频修复后允许）`, bookKey, null, null, "数组顺序为进度主键，r 仅展示");

  // 覆盖率与规模
  const pct = (a, b) => b ? (a / b * 100).toFixed(2) + "%" : "—";
  const stats = {
    words: N,
    meaningCoverage: pct(N - meaningBad, N),
    nonCjkMeanings: nonCjkMeaning,
    phoneticCoverage: pct(phoneticCount, N),
    exampleCoverage: pct(exampleCount, N),
    fmCoverage: pct(fmCount, N),
    kyCount,
    kyPct: pct(kyCount, N),
    dup: dupList.length,
    trailingAppended: blockWords.join(","),
    bytes: Buffer.byteLength(JSON.stringify(entries), "utf8"),
  };
  return stats;
}

function checkMeta(bookKey, entries, stats) {
  const index = BOOKS[bookKey];
  const m = meta[bookKey];
  if (!m || typeof m !== "object") { err("meta", `WORD_BOOK_META.${bookKey} 缺失`, bookKey, null, null, null); return { paperCount: Math.max(...entries.map(x => x?.[6] || 0), 1) }; }
  ["id", "name", "mark", "paperCount", "paperLabel", "yearRange", "tagLabel", "wordCount"].forEach(k => {
    if (!(k in m)) err("meta", `meta.${bookKey}.${k} 缺失`, bookKey, null, null, null);
  });
  if (m.id !== bookKey) err("meta", `meta.id=${JSON.stringify(m.id)} ≠ "${bookKey}"`, bookKey, null, null, null);
  if (m.name !== index.name) err("meta", `name=${JSON.stringify(m.name)} ≠ "${index.name}"`, bookKey, null, null, null);
  if (m.mark !== index.mark) err("meta", `mark=${JSON.stringify(m.mark)} ≠ "${index.mark}"`, bookKey, null, null, null);
  if (m.wordCount !== entries.length) err("meta", `wordCount=${JSON.stringify(m.wordCount)} ≠ 数组长度 ${entries.length}`, bookKey, null, null, null);
  const paperCount = isInt(m.paperCount) && m.paperCount > 0 ? m.paperCount : Math.max(...entries.map(x => x?.[6] || 0), 1);
  if (!isInt(m.paperCount) || m.paperCount <= 0) err("meta", `paperCount 非法：${JSON.stringify(m.paperCount)}`, bookKey, null, null, null);
  if (isStr(m.yearRange) && !YEAR_RANGE_RE.test(m.yearRange)) err("meta", `yearRange 格式非法：${JSON.stringify(m.yearRange)}`, bookKey, null, null, null);
  if (isStr(m.paperLabel) && !m.paperLabel.includes(index.label)) warn("meta", `paperLabel=${JSON.stringify(m.paperLabel)} 未含「${index.label}」`, bookKey, null, null, null);
  if (isStr(m.tagLabel) && !m.tagLabel.includes(index.label)) warn("meta", `tagLabel=${JSON.stringify(m.tagLabel)} 未含「${index.label}」`, bookKey, null, null, null);
  if (!stats) return { paperCount };
  // 由数据反推的 paperCount 应等于 meta（c 的最大值可能小于总套数，故不强制）
  const maxC = Math.max(...entries.map(x => x?.[6] || 0));
  if (maxC > paperCount) err("meta", `数据 c 最大值 ${maxC} > meta.paperCount ${paperCount}`, bookKey, null, null, null);
  const minYear = Math.min(...entries.filter(x => x?.[7]).map(x => srcYear(x?.[8]) ?? Infinity));
  const maxYear = Math.max(...entries.filter(x => x?.[7]).map(x => srcYear(x?.[8]) ?? -Infinity));
  if (isStr(m.yearRange) && Number.isFinite(minYear) && Number.isFinite(maxYear)) {
    const ym = m.yearRange.match(YEAR_RANGE_RE);
    if (ym && (Number(ym[1]) !== minYear || Number(ym[2]) !== maxYear) && minYear <= maxYear) {
      warn("meta", `yearRange=${m.yearRange} 与例句年份 ${minYear}–${maxYear} 不一致（例句未必覆盖全部年份，仅提示）`, bookKey, null, null, null);
    }
  }
  return { paperCount };
}

/**
 * 词书数据版本 / 进度迁移元数据校验（删词后旧 localStorage 按下标迁移，removed 必须可信）。
 * 契约（app.js 消费）：
 *   meta.dataVersion: int >= 1（缺省视为 1）
 *   meta.migrations: [{ from:int>=1, to:int>from, removed:int[] }]，缺省视为 []
 * 版本链：from 连续、to 递增、最终到 dataVersion；removed 升序唯一、范围 [0, oldLen(from))；
 *        oldLen(from) = 当前数组长度 + 该 from 及之后所有迁移删除数之和。
 */
function checkMigrations(bookKey, entries) {
  const m = meta[bookKey] || {};
  const hasDV = "dataVersion" in m;
  const dv = m.dataVersion;
  if (hasDV && (!isInt(dv) || dv < 1)) {
    err("meta", `dataVersion 非法：${JSON.stringify(dv)}`, bookKey, null, null, null);
    return null;
  }
  const version = hasDV ? dv : 1;
  const mags = m.migrations;
  if (mags === undefined) {
    if (version !== 1) err("meta", `dataVersion=${version} 但缺少 migrations`, bookKey, null, null, null);
    return { dataVersion: version, migrations: 0, removed: 0 };
  }
  if (!Array.isArray(mags)) {
    err("meta", `migrations 不是数组：${JSON.stringify(mags)}`, bookKey, null, null, null);
    return null;
  }
  if (!mags.length) {
    if (version !== 1) err("meta", `dataVersion=${version} 但 migrations 为空`, bookKey, null, null, null);
    return { dataVersion: version, migrations: 0, removed: 0 };
  }
  const sorted = mags.slice().sort((a, b) => (a?.from || 0) - (b?.from || 0));
  let cur = sorted[0]?.from;
  if (cur !== 1) err("meta", `迁移链未从 version 1 开始（首条 from=${JSON.stringify(cur)}）`, bookKey, null, null, null);
  let removedTotal = 0;
  const removedAll = [];
  for (let k = 0; k < sorted.length; k++) {
    const mg = sorted[k];
    if (!mg || typeof mg !== "object" || !isInt(mg.from) || !isInt(mg.to) || mg.to <= mg.from) {
      err("meta", `第 ${k + 1} 条迁移结构非法：${JSON.stringify(mg)}`, bookKey, null, null, null);
      return null;
    }
    if (mg.from !== cur) err("meta", `迁移链不连续：第 ${k + 1} 条 from=${mg.from} ≠ 上一档 ${cur}`, bookKey, null, null, null);
    if (!Array.isArray(mg.removed) || mg.removed.length === 0) {
      err("meta", `迁移 ${mg.from}→${mg.to} 的 removed 必须为非空数组`, bookKey, null, null, null);
      continue;
    }
    const addedCountOf = (m) => Array.isArray(m?.added) ? m.added.length : (Array.isArray(m?.addedWords) ? m.addedWords.length : 0);
    const oldLen = entries.length
      + sorted.slice(k).reduce((s, x) => s + (Array.isArray(x?.removed) ? x.removed.length : 0), 0)
      - sorted.slice(k).reduce((s, x) => s + addedCountOf(x), 0);
    let prev = -1;
    for (const idx of mg.removed) {
      if (!isInt(idx)) { err("meta", `迁移 ${mg.from}→${mg.to} 的 removed 含非整数：${JSON.stringify(idx)}`, bookKey, null, null, null); break; }
      if (idx <= prev) { err("meta", `迁移 ${mg.from}→${mg.to} 的 removed 未升序/有重复：${idx} <= ${prev}`, bookKey, null, null, null); break; }
      if (idx < 0 || idx >= oldLen) { err("meta", `迁移 ${mg.from}→${mg.to} 的 removed 越界：${idx} 不在 [0,${oldLen})`, bookKey, null, null, null); break; }
      prev = idx;
    }
    removedTotal += mg.removed.length;
    removedAll.push(...mg.removed);
    cur = mg.to;
  }
  const last = sorted[sorted.length - 1];
  if (isInt(last?.to) && last.to !== version) err("meta", `迁移链最终 version=${last.to} ≠ dataVersion=${version}`, bookKey, null, null, null);
  return { dataVersion: version, migrations: sorted.length, removed: removedTotal, newest: removedAll.slice(-1)[0] ?? null };
}

function crossCheckWordfreq(bookKey, entries) {
  if (!wf || !wf[bookKey]) return null;
  const index = BOOKS[bookKey];
  // 正文口径 + 已登记的错形归并/卷面清理修正（scripts/wordbook-repair-20261021.json）。
  const fam = wf[bookKey]?.content || wf[bookKey]?.full || {};
  const rows = Array.isArray(fam.lemma) ? fam.lemma : (Array.isArray(fam.surface) ? fam.surface : []);
  const repairPath = path.join(ROOT, "scripts/wordbook-repair-20261021.json");
  let repaired = null;
  try { repaired = JSON.parse(fs.readFileSync(repairPath,"utf8"))?.books?.[bookKey]?.counts || null; } catch {}
  if (!rows.length && !repaired) { warn("交叉核对", `wordfreq.${bookKey}.content 无可用行`, bookKey, null, null, null); return null; }
  const byWord = new Map();
  for (const row of rows) {
    if (!row || !isStr(row.word)) continue;
    const cur = byWord.get(row.word);
    if (!cur || (row.count || 0) > (cur.count || 0)) byWord.set(row.word, row);
  }
  let checked = 0, fMismatch = [], cMismatch = [], missing = [], papersMismatch = 0;
  for (const [i, x] of entries.entries()) {
    const w = x?.[0], f = x?.[5], c = x?.[6];
    const fix = repaired?.[w];
    const row = byWord.get(w);
    if (!fix && !row) { missing.push(w); continue; }
    checked++;
    const expectedF = fix ? fix.f : row.count;
    const expectedC = fix ? fix.c : row.papers;
    if (expectedF !== f) fMismatch.push([i, w, f, expectedF]);
    if (expectedC !== c) cMismatch.push([i, w, c, expectedC]);
  }
  // meta 套数 / 年份范围 vs wordfreq.meta.papers
  const m = meta[bookKey] || {};
  const wfMeta = wf.meta?.papers?.[bookKey];
  if (isInt(wfMeta) && wfMeta !== m.paperCount) {
    papersMismatch = 1;
    err("交叉核对", `meta.paperCount=${m.paperCount} ≠ wordfreq.meta.papers.${bookKey}=${wfMeta}`, bookKey, null, null, null);
  }
  if (manifest?.summary?.[bookKey]?.papers != null && isInt(m.paperCount) && manifest.summary[bookKey].papers !== m.paperCount) {
    warn("交叉核对", `meta.paperCount=${m.paperCount} ≠ manifest.summary.${bookKey}.papers=${manifest.summary[bookKey].papers}（manifest 以 corpus 为准）`, bookKey, null, null, null);
  }
  // r 排名核对：r = (-f, -c, word) 排序的 1 基排名（对完整数组整体排序）
  const sorted = entries.slice().sort((a, b) => (b[5] - a[5]) || (b[6] - a[6]) || String(a[0]).localeCompare(String(b[0]), "en"));
  let rMismatch = [];
  sorted.forEach((x, k) => { if (x[4] !== k + 1) rMismatch.push([k, x[0], x[4], k + 1]); });
  if (fMismatch.length) err("交叉核对", `与 wordfreq.json 词频 f 不一致（${fMismatch.length}/${checked}）`, bookKey, fMismatch[0][0], fMismatch[0][1], fMismatch.slice(0, 8).map(x => `${x[1]}:书${x[2]}≠频${x[3]}`).join(" "));
  if (cMismatch.length) err("交叉核对", `与 wordfreq.json 套数 c 不一致（${cMismatch.length}/${checked}）`, bookKey, cMismatch[0][0], cMismatch[0][1], cMismatch.slice(0, 8).map(x => `${x[1]}:书${x[2]}≠频${x[3]}`).join(" "));
  if (missing.length) warn("交叉核对", `wordfreq.content 与修复清单均查不到的词（${missing.length}）`, bookKey, null, null, missing.slice(0, 12).join(","));
  if (rMismatch.length) err("交叉核对", `r 与 (-f,-c,word) 排名不一致（${rMismatch.length} 条）`, bookKey, rMismatch[0][0], rMismatch[0][1], rMismatch.slice(0, 8).map(x => `${x[1]}:书${x[2]}≠序${x[3]}`).join(" "));
  return { checked, fMismatch, cMismatch, missing, rMismatch, papersMismatch };
}

/**
 * 内容修订回归（2026-10-22 首批，证据见 docs/内容修订记录-2026-10-22.md）。
 * 只锁定已核对词条的固定期望与已清理的残留，不做全库语义判断；失败为 warning，供人工复核。
 */
function checkContentFixes(bookKey, entries) {
  const byWord = new Map();
  entries.forEach((row, i) => {
    if (Array.isArray(row) && typeof row[0] === "string" && !byWord.has(row[0])) byWord.set(row[0], i);
  });
  const hasForm = (ex, forms) => forms.some(f => new RegExp(`(^|[^a-z])${f}($|[^a-z])`, "i").test(String(ex || "")));
  const expect = (w, ok, note) => {
    const i = byWord.get(w);
    if (i === undefined) {
      warn("内容修订", `修订词条缺失：${w}`, bookKey, null, w, "docs/内容修订记录-2026-10-22.md 记录的修订词条应存在");
      return;
    }
    if (!ok(entries[i])) warn("内容修订", `内容修订回归：${w}`, bookKey, i, w, note);
  };
  if (bookKey === "cet4") {
    expect("use", a => a[1] === "juːz", "use 主读音应为动词 /juːz/（名词 /juːs/ 交给读音展示层）");
    expect("minute", a => a[1] === "ˈminit" && !/[\s.]/.test(a[1]) && /细微|微小/.test(a[2]), "minute 主读音应为名词 /ˈmɪnɪt/，并补形容词义「微小的/细微的」");
    expect("lead", a => !/[\s.]/.test(a[1]) && hasForm(a[7], ["lead", "led", "leads", "leading"]) && /[.!?]["']?$/.test(a[7]), "lead 例句应为完整句并含目标词形 led；ph 不得夹带 led 读音");
    expect("study", a => hasForm(a[7], ["study", "studies"]) && /[.!?]["']?$/.test(a[7]), "study 例句应为完整句（与 lead 同句的截断已恢复）");
    expect("researcher", a => hasForm(a[7], ["researcher", "researchers"]) && /[.!?]["']?$/.test(a[7]), "researcher 例句应为完整句（与 lead 同句的截断已恢复）");
    expect("customer", a => hasForm(a[7], ["customer", "customers"]) && !/[·ŧ]/.test(a[7]) && !/\bmodem\b/.test(a[7]), "customer 例句不得残留 ratings·/ŧ/modem 等 OCR 污染");
    expect("rate", a => hasForm(a[7], ["rate", "rates", "rated", "rating"]) && !a[7].includes("_lQ_"), "rate 例句不得是 _lQ_ 填空残句，且须含目标词形");
    expect("barely", a => hasForm(a[7], ["barely"]) && !a[7].includes("_lQ_"), "barely 例句不得是 _lQ_ 填空残句，且须含目标词形");
    expect("lie", a => /躺/.test(a[2]) && /说谎/.test(a[2]) && /lain/.test(a[10]) && /lied/.test(a[10]), "lie 需分义列出躺（lay/lain）与说谎（lied/lied）的词形");
  }
  if (bookKey === "cet6") {
    expect("use", a => a[1] === "juːz", "use 主读音应为动词 /juːz/（名词 /juːs/ 交给读音展示层）");
    expect("minute", a => a[1] === "ˈminit" && !/[\s.]/.test(a[1]), "minute 主读音应为名词 /ˈmɪnɪt/，不得把形容词读音塞进 ph");
    expect("lead", a => !/[\s.]/.test(a[1]), "lead 的 ph 不得夹带过去式 led 读音");
    expect("contract", a => /收缩/.test(a[2]) && hasForm(a[7], ["contract", "contracts", "contracted", "contracting"]) && /[.!?]["']?$/.test(a[7]), "contract 需补「收缩」义，例句完整且含目标词形");
    expect("object", a => a[8] === "自编" && hasForm(a[7], ["object", "objects", "objected", "objecting"]) && /[.!?]["']?$/.test(a[7]), "object 原残句（In tum…can loneliness.）应替换为准确标注的自编完整句");
    expect("loneliness", a => a[8] === "自编" && hasForm(a[7], ["loneliness"]) && /[.!?]["']?$/.test(a[7]), "loneliness 原残句应替换为准确标注的自编完整句");
    expect("lie", a => /躺/.test(a[2]) && /说谎/.test(a[2]) && /lain/.test(a[10]) && /lied/.test(a[10]), "lie 需分义列出躺（lay/lain）与说谎（lied/lied）的词形");
  }
  // 已清理的填空残留不得回流（2026-10-23 也清理 tum 等全部已确认句族，硬门控见共用 content-validation.mjs）。
  entries.forEach((row, i) => {
    if (Array.isArray(row) && typeof row[7] === "string" && row[7].includes("_lQ_")) {
      warn("内容修订", "例句含已清理的填空残留 _lQ_", bookKey, i, row[0], short(row[7]));
    }
  });
}

// ---------- 执行 ----------
console.log("四六级词书数据静态校验（js/validate-cet-data.mjs）");
console.log(`数据源：${path.relative(ROOT, DATA)}（${(rawSource.length / 1024 / 1024).toFixed(2)} MB）`);
console.log("");
const statsByBook = {};
for (const bookKey of Object.keys(BOOKS)) {
  const arr = win[bookKey === "cet4" ? "WORDS_CET4" : "WORDS_CET6"];
  if (!Array.isArray(arr) || !arr.length) {
    err("数据", `window.${bookKey === "cet4" ? "WORDS_CET4" : "WORDS_CET6"} 缺失或为空`, bookKey, null, null, null);
    continue;
  }
  const index = BOOKS[bookKey];
  // 先取 meta.paperCount 供 c 越界校验；meta 字段问题只由 checkMeta 记录一次
  const maxC = Math.max(1, ...arr.map(x => (Array.isArray(x) && isInt(x[6])) ? x[6] : 0));
  const metaPc = meta[bookKey]?.paperCount;
  const paperCount = isInt(metaPc) && metaPc > 0 ? metaPc : maxC;
  const stats = checkCommon({ ...index, paperCount }, bookKey, arr);
  checkMeta(bookKey, arr, stats);
  const mig = checkMigrations(bookKey, arr);
  if (mig) stats.migrations = mig;
  checkContentFixes(bookKey, arr);
  const cross = crossCheckWordfreq(bookKey, arr);
  stats.cross = cross;
  statsByBook[bookKey] = { ...index, ...stats, meta: meta[bookKey] || null };
  if (stats.bytes > 4 * 1024 * 1024) warn("体积", `本册数据 ${(stats.bytes / 1024 / 1024).toFixed(2)} MB 超过 4 MB 目标`, bookKey, null, null, null);
}

// 两本书不能相同
if (Array.isArray(win.WORDS_CET4) && Array.isArray(win.WORDS_CET6) && win.WORDS_CET4.length && win.WORDS_CET6.length) {
  const s4 = new Set(win.WORDS_CET4.map(x => x?.[0]));
  const overlap = win.WORDS_CET6.filter(x => s4.has(x?.[0])).length;
  if (overlap > 0) warn("数据", `四/六级词表有 ${overlap} 个同名词（可接受，但应确认不是复制错误）`, null, null, null, null);
}

// ---------- 汇总 ----------
const errors = issues.filter(x => x.sev === "error");
const warns = issues.filter(x => x.sev === "warn");
const typeTitle = { 结构: "11 元组/结构", 类型: "字段类型", 单词: "单词格式/重复", 词性: "posIdx", 排名: "r 连续性", 词频: "f", 套数: "c", 大纲: "ky", 释义: "释义覆盖", 例句: "例句出处", 安全: "安全注入", 编码: "编码", meta: "meta 一致性", 交叉核对: "wordfreq 交叉核对", 内容修订: "内容修订回归", 数据: "数据整体", 体积: "文件体积" };
const groupBy = list => {
  const map = new Map();
  for (const it of list) {
    const key = (it.book || "") + "|" + it.type + "|" + it.label;
    if (!map.has(key)) map.set(key, { type: it.type, label: it.label, items: [] });
    map.get(key).items.push(it);
  }
  return [...map.values()];
};

console.log("== 各书统计 ==");
for (const [bookKey, st] of Object.entries(statsByBook)) {
  console.log(`[${bookKey}] 词数=${st.words}  释义覆盖=${st.meaningCoverage}  音标覆盖=${st.phoneticCoverage}  例句覆盖=${st.exampleCoverage}  词形覆盖=${st.fmCoverage}  ky=${st.kyCount}(${st.kyPct})  补回词末尾=${st.trailingAppended || "—"}  数组 JSON=${(st.bytes / 1024 / 1024).toFixed(2)}MB`);
  if (st.migrations) console.log(`         版本迁移：dataVersion=${st.migrations.dataVersion}，迁移 ${st.migrations.migrations} 条，累计删除 ${st.migrations.removed} 词`);
  if (st.cross) console.log(`         交叉核对：f 不一致 ${st.cross.fMismatch.length}，c 不一致 ${st.cross.cMismatch.length}，r 不一致 ${st.cross.rMismatch.length}，wordfreq 缺词 ${st.cross.missing.length}`);
}
console.log("");
console.log(`错误 ${errors.length} 条（${groupBy(errors).length} 类），警告 ${warns.length} 条（${groupBy(warns).length} 类）`);

function printGroups(list, title) {
  if (!list.length) return;
  console.log("");
  console.log(`${title}：`);
  for (const g of groupBy(list)) {
    const bk = g.items[0]?.book ? `[${g.items[0].book}] ` : "";
    console.log(`  - ${bk}[${typeTitle[g.type] || g.type}] ${g.label} × ${g.items.length}`);
    for (const it of g.items.slice(0, 4)) {
      const pos = it.idx != null ? `#${it.idx} ` : "";
      console.log(`      ${pos}${it.word ? it.word + " — " : ""}${short(it.detail || "", 110)}`);
    }
    if (g.items.length > 4) console.log(`      … 共 ${g.items.length} 条`);
  }
}
printGroups(errors, "错误明细");
printGroups(warns, "警告明细");

const verdict = errors.length ? "失败（存在 error）" : (warns.length ? "通过（仅有 warning）" : "全部通过");
console.log("");
console.log(`结论：${verdict}`);

// ---------- 报告 ----------
try {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const lines = [];
  lines.push("# 四六级词书数据静态校验报告（qa-verify 独立）", "");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 数据源：\`js/cet-words-data.js\`（${(rawSource.length / 1024 / 1024).toFixed(2)} MB）`);
  lines.push(`- 校验脚本：\`js/validate-cet-data.mjs\``);
  lines.push(`- 结论：**${verdict}**（error ${errors.length} / warning ${warns.length}）`, "");
  lines.push("## 各书统计", "");
  lines.push("| 书 | 词数 | 释义覆盖 | 音标覆盖 | 例句覆盖 | 词形覆盖 | ky 数 | 补回词末尾 | 数组 JSON |");
  lines.push("|:--|--:|--:|--:|--:|--:|--:|:--|--:|");
  for (const [bookKey, st] of Object.entries(statsByBook)) {
    lines.push(`| ${bookKey} | ${st.words} | ${st.meaningCoverage} | ${st.phoneticCoverage} | ${st.exampleCoverage} | ${st.fmCoverage} | ${st.kyCount} (${st.kyPct}) | ${st.trailingAppended || "—"} | ${(st.bytes / 1024 / 1024).toFixed(2)} MB |`);
  }
  lines.push("");
  lines.push("## meta 一致性", "");
  for (const [bookKey, st] of Object.entries(statsByBook)) {
    const m = st.meta || {};
    lines.push(`- \`${bookKey}\`：id=${m.id} name=${m.name} mark=${m.mark} wordCount=${m.wordCount} paperCount=${m.paperCount} yearRange=${m.yearRange} paperLabel=${m.paperLabel} tagLabel=${m.tagLabel}`);
    const mg = st.migrations;
    if (mg) lines.push(`  - 数据版本：dataVersion=${mg.dataVersion}；迁移 ${mg.migrations} 条（累计删除 ${mg.removed} 词，最新删除下标 ${mg.newest ?? "—"}）`);
  }
  lines.push("");
  lines.push("## 交叉核对（cet-wordfreq.json）", "");
  for (const [bookKey, st] of Object.entries(statsByBook)) {
    if (!st.cross) { lines.push(`- \`${bookKey}\`：跳过（cet-wordfreq.json 缺失或无该级别）`); continue; }
    lines.push(`- \`${bookKey}\`：比对 ${st.cross.checked} 词；f 不一致 ${st.cross.fMismatch.length}，c 不一致 ${st.cross.cMismatch.length}，r 排名不一致 ${st.cross.rMismatch.length}，wordfreq 缺词 ${st.cross.missing.length}`);
  }
  lines.push("");
  if (errors.length) {
    lines.push("## 错误明细", "");
    for (const g of groupBy(errors)) {
      lines.push(`### [${typeTitle[g.type] || g.type}] ${g.label}（${g.items.length}）`, "");
      for (const it of g.items.slice(0, 50)) lines.push(`- ${it.book ? `[${it.book}] ` : ""}${it.idx != null ? `#${it.idx} ` : ""}${it.word ? "`" + it.word + "` " : ""}${it.detail || ""}`);
      if (g.items.length > 50) lines.push(`- … 共 ${g.items.length} 条（见控制台或补充脚本）`);
      lines.push("");
    }
  }
  if (warns.length) {
    lines.push("## 警告明细", "");
    for (const g of groupBy(warns)) {
      lines.push(`### [${typeTitle[g.type] || g.type}] ${g.label}（${g.items.length}）`, "");
      for (const it of g.items.slice(0, 30)) lines.push(`- ${it.book ? `[${it.book}] ` : ""}${it.idx != null ? `#${it.idx} ` : ""}${it.word ? "`" + it.word + "` " : ""}${it.detail || ""}`);
      if (g.items.length > 30) lines.push(`- … 共 ${g.items.length} 条`);
      lines.push("");
    }
  }
  lines.push("## 判定口径", "");
  lines.push("- error 即失败：两册非空、11 元组与类型、全小写 ASCII、无重复、`r` 连续 1..N、`f>=1`、`1<=c<=paperCount`、`ky∈{0,1}`、`posIdx∈[0,15]`、释义非空、例句出处格式 `四级/六级 YYYY.MM` 或考研来源/自编、meta 与数组一致、无 HTML/脚本注入；C0/DEL/C1/替换符/私用区以及 2026-10-23 已确认污染例句不得回流。");
  lines.push("- warning 提示信息披露项：音标/例句/词形覆盖率、释义不含中文、词头/明确词形缺席、wordfreq 缺词（补回词）、yearRange 与例句年份差异等。");
  lines.push("- 内容修订回归（warning）：`docs/内容修订记录-2026-10-22.md` 首批已核对词条的读音/词性/释义/例句固定期望（use、minute、contract、object、loneliness、rate、barely、lead、customer、lie），以及例句回流 `_lQ_` 等已清理残留。");
  lines.push("- `r` 排名口径：按 `(-f, -c, word)` 排序的 1 基排名；补回实义虚词 `will/may/can/one/own` 连续追加在数组末尾。");
  lines.push("");
  fs.writeFileSync(REPORT, lines.join("\n"), "utf8");
  console.log(`报告：${path.relative(ROOT, REPORT)}`);
  // JSON 摘要（供 QA_REPORT 汇总脚本读取，避免手抄数字）
  const summary = {
    generatedAt: new Date().toISOString(),
    dataFile: path.relative(ROOT, DATA),
    dataBytes: rawSource.length,
    verdict,
    errorCount: errors.length,
    warningCount: warns.length,
    books: Object.fromEntries(Object.entries(statsByBook).map(([k, st]) => [k, {
      words: st.words,
      meaningCoverage: st.meaningCoverage,
      phoneticCoverage: st.phoneticCoverage,
      exampleCoverage: st.exampleCoverage,
      fmCoverage: st.fmCoverage,
      kyCount: st.kyCount,
      kyPct: st.kyPct,
      trailingAppended: st.trailingAppended,
      bytes: st.bytes,
      meta: st.meta,
      cross: st.cross ? {
        checked: st.cross.checked,
        fMismatch: st.cross.fMismatch.length,
        cMismatch: st.cross.cMismatch.length,
        rMismatch: st.cross.rMismatch.length,
        missing: st.cross.missing.length,
      } : null,
    }])),
    errors: groupBy(errors).map(g => ({ type: g.type, label: g.label, count: g.items.length, book: g.items[0]?.book || null })),
    warnings: groupBy(warns).map(g => ({ type: g.type, label: g.label, count: g.items.length, book: g.items[0]?.book || null })),
  };
  fs.writeFileSync(path.join(path.dirname(REPORT), "data_validation.json"), JSON.stringify(summary, null, 2), "utf8");
} catch (e) {
  console.error("写报告失败（不影响判定）：", e.message);
}

process.exit(errors.length ? 1 : 0);
