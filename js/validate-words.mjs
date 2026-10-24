/**
 * 词库数据完整性校验
 * 运行：node js/validate-words.mjs
 * 输出：控制台摘要 + tests/reports/数据校验报告.md
 * 退出码：存在 error → 1；仅 warning 或全部通过 → 0
 *
 * 字段（与 js/app.js 映射一致，11 元组）：
 *   0 w  1 ph  2 m  3 p  4 r  5 f  6 c  7 ex  8 src  9 ky  10 fm
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { contentEncodingFields, isConfirmedBadExample, mechanicalExampleRisks, confirmedCorrectionIssues } from "./content-validation.mjs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const DATA = path.join(HERE, "words-data.js");
const REPORT = path.join(ROOT, "tests", "reports", "数据校验报告.md");
const SPELLING_FIXES = path.join(ROOT, "tests", "fixtures", "spelling-fixes.json");

const FIELD_NAMES = ["w", "ph", "m", "p", "r", "f", "c", "ex", "src", "ky", "fm"];
const FIELD_TYPES = ["string", "string", "string", "number", "number", "number", "number", "string", "string", "number", "string"];

// spaCy POS → 索引（build_html.py POSIDX），0–3 为 app 词性筛选主用
const POS_MAX = 15;
const POS_LABEL = {
  0: "NOUN", 1: "VERB", 2: "ADJ", 3: "ADV", 4: "ADP", 5: "DET", 6: "PRON",
  7: "AUX", 8: "CCONJ", 9: "SCONJ", 10: "NUM", 11: "PART", 12: "PROPN",
  13: "INTJ", 14: "X", 15: "SYM",
};

const MAX_PAPERS = 46; // 46 套真题
const LIST_CAP = 200;

// ---------- 工具 ----------
const issues = []; // {sev:'error'|'warn', type, label, idx, word, detail}
function err(type, label, idx, word, detail) {
  issues.push({ sev: "error", type, label, idx, word, detail });
}
function warn(type, label, idx, word, detail) {
  issues.push({ sev: "warn", type, label, idx, word, detail });
}

const isInt = (n) => typeof n === "number" && Number.isInteger(n);
const isStr = (v) => typeof v === "string";
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const GARBLED = /[\ufffd\u{fffe}\u{ffff}]|[\u{e000}-\u{f8ff}]/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const WORD_RE = /^[a-z]+(?:[-'][a-z]+)*$/;
const SRC_RE = /^(?:(?:英语一|英语二|旧题型) \d{4}|(?:四级|六级) \d{4}\.\d{2}|自编(?:例句)?|词典例句)$/;
const PLACEHOLDER_RE = /TODO|FIXME|待补|暂无|无释义|占位|N\/A|\bnull\b|\bundefined\b|xxx+/i;
const POS_PREFIX_RE = /^(n|v|vt|vi|a|adj|adv|prep|conj|pron|num|aux|int|interj|art|det|pl|abbr|un|pref|web|sb|sth)\./i;
const EXAM_LEFTOVER_RE = /___|\[A\]|\[B\]|\[C\]|\[D\]|\(\d{1,3}\)/;
// 音标允许集：IPA 常用符号 + 拉丁字母 + 次重音点/分隔符（ECDICT 老式字符集已规范化）
const IPA_OK = /^[ ()\-.;a-zæðŋɑɒɔəɛɜɝɡɪʃʊʌʒθˈˌː]*$/i;
const IPA_NONSTD = /[\u02b9\u03b5\u02ca\u02cb]/; // ˊ 希腊 ε 等疑似误植（应为 ˈ ɛ）
const VOWELISH = /[aeiouyæɑɒɔəɛɜɪʊʌ]/i;
// 例句中合理的英文非 ASCII：拉丁补充（é、°、£）、通用标点、货币、分数、数字形式（Ⅱ）
function oddAscii(ch) {
  const c = ch.codePointAt(0);
  if (c <= 127) return false;
  if (c >= 0x00a0 && c <= 0x00ff) return false;          // Latin-1：é á ó ° £ ½
  if (c >= 0x0100 && c <= 0x024f) return false;          // 拉丁扩展
  if (c >= 0x2000 && c <= 0x206f) return false;          // 通用标点：– — ‘ ’ “ ” …
  if (c >= 0x20a0 && c <= 0x20bf) return false;          // 货币符号
  if (c >= 0x2150 && c <= 0x218f) return false;          // 分数/数字形式（Ⅱ）
  if (c === 0x2212 || c === 0x00d7 || c === 0x00f7) return false; // − × ÷
  return true;
}

function short(s, n = 60) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// ---------- 加载 ----------
let RAW = null;
let bookMeta = null;
let loadError = null;
try {
  const src = fs.readFileSync(DATA, "utf8");
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(src, ctx, { filename: "words-data.js" });
  RAW = ctx.window?.WORDS_RAW ?? null;
  bookMeta = ctx.window?.WORD_BOOK_META?.kaoyan ?? null;
} catch (e) {
  loadError = e;
}

let badLemma = new Map(); // 残缺词形 -> 应为
try {
  const sf = JSON.parse(fs.readFileSync(SPELLING_FIXES, "utf8"));
  for (const [k, v] of Object.entries(sf)) {
    if (k !== "_说明") badLemma.set(k, v);
  }
} catch {
  /* 可选交叉源，缺失则跳过 */
}

// ---------- 结构校验 ----------
if (loadError) {
  err("structure", "words-data.js 无法解析", -1, "", String(loadError.message || loadError));
} else if (!Array.isArray(RAW)) {
  err("structure", "WORDS_RAW 不是数组", -1, "", `实际类型: ${typeof RAW}`);
} else if (RAW.length === 0) {
  err("structure", "WORDS_RAW 为空数组", -1, "", "");
}

const entries = Array.isArray(RAW) ? RAW : [];

// ---------- 数据版本与删除迁移 ----------
// 考研原始索引基线为 8100；本次清理必须能由完整迁移链重建旧索引长度。
if (!bookMeta || typeof bookMeta !== "object" || Array.isArray(bookMeta)) {
  err("migration", "缺少考研词库版本元数据", -1, "", "WORD_BOOK_META.kaoyan 必须与数据一同发布");
} else {
  if (bookMeta.wordCount !== entries.length) err("migration", "wordCount 与数组长度不一致", -1, "", `${bookMeta.wordCount} ≠ ${entries.length}`);
  if (bookMeta.paperCount !== MAX_PAPERS) err("migration", "考研试卷数不正确", -1, "", `${bookMeta.paperCount} ≠ ${MAX_PAPERS}`);
  const version = bookMeta.dataVersion;
  const chain = bookMeta.migrations;
  if (!isInt(version) || version < 1 || !Array.isArray(chain)) {
    err("migration", "数据版本或迁移链格式不正确", -1, "", "需要正整数 dataVersion 与 migrations 数组");
  } else {
    if (chain.length !== version - 1) err("migration", "迁移链长度与数据版本不一致", -1, "", `v${version} 应有 ${version - 1} 次逐级迁移`);
    const addedCountOf = (m) => Array.isArray(m?.added) ? m.added.length
      : (Array.isArray(m?.addedWords) ? m.addedWords.length : 0);
    const totalRemoved = chain.reduce((n, m) => n + (Array.isArray(m?.removed) ? m.removed.length : 0), 0);
    const totalAdded = chain.reduce((n, m) => n + addedCountOf(m), 0);
    if (entries.length + totalRemoved - totalAdded !== 8100) err("migration", "旧词数基线不一致", -1, "", `${entries.length} + ${totalRemoved} - ${totalAdded} ≠ 原始 8100`);
    chain.forEach((m, step) => {
      const oldLen = entries.length
        + chain.slice(step).reduce((n, x) => n + (Array.isArray(x?.removed) ? x.removed.length : 0), 0)
        - chain.slice(step).reduce((n, x) => n + addedCountOf(x), 0);
      if (!m || m.from !== step + 1 || m.to !== step + 2 || !Array.isArray(m.removed) || !m.removed.length) {
        err("migration", "迁移必须逐级连续且带删除清单", -1, "", `第 ${step + 1} 条迁移格式不正确`);
        return;
      }
      if (m.previousWordCount !== oldLen) err("migration", "迁移前词数与旧索引长度不一致", -1, "", `v${m.from}: ${m.previousWordCount} ≠ ${oldLen}`);
      let prev = -1;
      for (const i of m.removed) {
        if (!isInt(i) || i <= prev || i >= oldLen) err("migration", "删除索引须升序唯一且不越界", -1, "", `v${m.from} 删除下标 ${i}，旧词数 ${oldLen}`);
        prev = i;
      }
      if (!Array.isArray(m.removedWords) || m.removedWords.length !== m.removed.length
          || m.removedWords.some(w => !isStr(w) || !WORD_RE.test(w)) || new Set(m.removedWords).size !== m.removedWords.length) {
        err("migration", "removedWords 须逐项对应删除索引且唯一", -1, "", `v${m.from} 删除词名清单不正确`);
      }
      if (addedCountOf(m)) {
        if (!Array.isArray(m.added) || m.added.length !== addedCountOf(m) || m.added.some(n => !isInt(n) || n < oldLen - m.removed.length || n >= oldLen - m.removed.length + addedCountOf(m))) {
          err("migration", "added 索引须对应追加到新数组末尾的词条", -1, "", `v${m.from} 新增索引不正确`);
        }
        if (!Array.isArray(m.addedWords) || m.addedWords.length !== addedCountOf(m)
            || m.addedWords.some(w => !isStr(w) || !WORD_RE.test(w)) || new Set(m.addedWords).size !== m.addedWords.length) {
          err("migration", "addedWords 须逐项对应新增词且唯一", -1, "", `v${m.from} 新增词名清单不正确`);
        }
      }
    });
    if (chain.length) {
      const last = chain[chain.length - 1];
      const expectedPrevious = entries.length + (last?.removed?.length || 0) - addedCountOf(last);
      if (bookMeta.previousWordCount !== expectedPrevious) err("migration", "previousWordCount 须为最近一次迁移前词数", -1, "", `${bookMeta.previousWordCount} ≠ ${expectedPrevious}`);
    }
  }
}

// ---------- 逐条校验 ----------
const wordFirstIdx = new Map(); // word -> 首个下标
const rFirstIdx = new Map();
const rToEntry = [];

for (let i = 0; i < entries.length; i++) {
  const a = entries[i];
  const word = Array.isArray(a) && isStr(a[0]) ? a[0] : `(下标 ${i})`;

  // 1) 结构
  if (!Array.isArray(a)) {
    err("structure", "词条不是数组", i, word, `实际: ${typeof a}`);
    continue;
  }
  if (a.length !== 11) {
    err("structure", "词条字段数不为 11", i, word, `实际: ${a.length}`);
    continue;
  }
  let typeOk = true;
  for (let f = 0; f < 11; f++) {
    const t = typeof a[f];
    const ok = FIELD_TYPES[f] === "number"
      ? isInt(a[f])
      : t === FIELD_TYPES[f];
    if (!ok) {
      typeOk = false;
      err("structure", `字段 ${FIELD_NAMES[f]}(${f}) 类型错误`, i, word,
        `期望 ${FIELD_TYPES[f]}${FIELD_TYPES[f] === "number" ? "(整数)" : ""}, 实际 ${t}${isInt(a[f]) ? "" : t === "number" ? " (非整数)" : ""}`);
    }
  }
  if (!typeOk) continue;

  const [w, ph, m, p, r, f, c, ex, src, ky, fm] = a;

  // 2) 单词
  if (!w.trim()) {
    err("word", "单词为空", i, w, "");
  } else if (!WORD_RE.test(w)) {
    err("word", "单词拼写不规范", i, w, "需为小写字母，可含 - / ' 连接");
  }
  if (w !== w.trim() || /\s/.test(w)) {
    err("word", "单词含空白字符", i, w, JSON.stringify(w));
  }
  if (wordFirstIdx.has(w)) {
    err("word", "重复词条", i, w, `与下标 ${wordFirstIdx.get(w)} 重复`);
  } else {
    wordFirstIdx.set(w, i);
  }
  if (w.length === 1) {
    warn("word", "单词为单字母", i, w, "单字母词条通常是切词残片（词库规范已剔除 l/b/c/d）");
  }
  if (badLemma.has(w)) {
    warn("word", "已知残缺词形", i, w,
      `spelling-fixes.json 记录应为「${badLemma.get(w)}」`);
  }

  // 3) 音标
  if (!ph || !ph.trim()) {
    warn("phonetic", "音标缺失", i, w, "空字符串（构建时确认无可靠读音，可接受）");
  } else {
    if (CJK.test(ph)) err("phonetic", "音标混入中日韩文字", i, w, short(ph));
    if (/[\u0400-\u04FF]/.test(ph)) err("phonetic", "音标混入西里尔字母", i, w, short(ph));
    if (GARBLED.test(ph)) err("phonetic", "音标含乱码/替换字符", i, w, short(ph));
    if (CONTROL.test(ph)) err("phonetic", "音标含控制字符", i, w, JSON.stringify(ph));
    if (!CJK.test(ph) && !/[\u0400-\u04FF]/.test(ph) && !GARBLED.test(ph) && !CONTROL.test(ph)) {
      if (IPA_NONSTD.test(ph)) {
        warn("phonetic", "音标含非标准符号（疑似误植）", i, w, short(ph));
      } else if (!IPA_OK.test(ph)) {
        warn("phonetic", "音标含 IPA 不常见字符", i, w, short(ph));
      }
      if (!VOWELISH.test(ph)) {
        warn("phonetic", "音标不含元音，可疑", i, w, short(ph));
      }
    }
  }

  // 4) 释义
  if (!m.trim()) {
    err("meaning", "释义为空", i, w, "");
  } else {
    if (PLACEHOLDER_RE.test(m)) err("meaning", "释义含占位符", i, w, short(m));
    if (GARBLED.test(m)) err("meaning", "释义含乱码/替换字符", i, w, short(m));
    if (CONTROL.test(m)) err("meaning", "释义含控制字符", i, w, JSON.stringify(short(m)));
    if (!CJK.test(m)) warn("meaning", "释义缺少中文", i, w, short(m));
    if (!POS_PREFIX_RE.test(m.trim())) warn("meaning", "释义无词性前缀", i, w, short(m));
  }

  // 5) 词频 r / f / c
  if (r < 1) err("freq", "排名 r 非法（<1）", i, w, String(r));
  if (rFirstIdx.has(r)) {
    err("freq", "排名 r 重复", i, w, `r=${r} 与下标 ${rFirstIdx.get(r)} 撞车`);
  } else {
    rFirstIdx.set(r, i);
  }
  rToEntry.push({ r, i, w, f, c });

  if (f < 1) err("freq", "词频 f 非法（<1）", i, w, String(f));
  if (c < 1) err("freq", "试卷数 c 非法（<1）", i, w, String(c));
  if (c > MAX_PAPERS) err("freq", `试卷数 c 超过 ${MAX_PAPERS} 套`, i, w, String(c));
  if (c > f) err("freq", "试卷数 c 大于词频 f", i, w, `f=${f}, c=${c}`);

  // 词性
  if (p < 0 || p > POS_MAX) {
    err("structure", "词性索引 p 越界", i, w, `p=${p}（合法 0–${POS_MAX}）`);
  }

  // 已确认编码/污染是硬门控；一般语义完整性仍由下方 warning 提醒人工复核。
  const badEncodingFields = contentEncodingFields(a);
  if (badEncodingFields.length) err("content", "字段含控制字符/替换符/私用区", i, w, `字段 ${badEncodingFields.map(k => FIELD_NAMES[k]).join("/")}`);
  if (isConfirmedBadExample(ex)) err("content", "已确认污染例句回流", i, w, short(ex));
  for (const issue of confirmedCorrectionIssues("kaoyan", a)) err("content", "已确认内容修订回流", i, w, issue);

  // 6) 例句 / 来源
  if (ex) {
    if (CJK.test(ex)) warn("example", "例句含中文", i, w, short(ex));
    const words = ex.trim().split(/\s+/).filter(Boolean).length;
    if (words < 4) warn("example", "例句过短", i, w, `${words} 词: ${short(ex)}`);
    if (EXAM_LEFTOVER_RE.test(ex)) warn("example", "例句残留题号/选项标记", i, w, short(ex));
    const mechRisks = mechanicalExampleRisks(ex);
    if (mechRisks.length) warn("example", "例句疑似机械污染（待人工核验：" + mechRisks.join("/") + "）", i, w, short(ex));
    if (GARBLED.test(ex)) warn("example", "例句含乱码", i, w, short(ex));
    if (CONTROL.test(ex)) warn("example", "例句含控制字符", i, w, JSON.stringify(short(ex)));
    const odd = (ex.match(/"/g) || []).length % 2 === 1;
    if (odd) warn("example", "例句英文引号不配对（疑似截断）", i, w, short(ex));
    const nonAscii = ex.split("").filter((ch) => oddAscii(ch) && !CJK.test(ch));
    if (nonAscii.length) {
      warn("example", "例句含非常见字符", i, w, `${short(ex)}  [${[...new Set(nonAscii)].join("")}]`);
    }
  }
  if (ex && !src) warn("example", "有例句但缺来源", i, w, "");
  if (!ex && src) warn("example", "有来源但缺例句", i, w, short(src));
  if (src && !SRC_RE.test(src)) warn("example", "来源格式不规范", i, w, short(src));

  // 7) ky 一致性
  if (ky !== 0 && ky !== 1) {
    err("ky", "ky 不是 0/1", i, w, String(ky));
  } else {
    if (ky === 1 && !m.trim()) err("ky", "大纲词缺释义", i, w, "");
    if (ky === 1 && (!ph || !ph.trim())) warn("ky", "大纲词缺音标", i, w, "");
    if (ky === 1 && badLemma.has(w)) warn("ky", "残缺词形却标记为考研大纲词", i, w, `应为「${badLemma.get(w)}」`);
    if (ky === 1 && p === 12) warn("ky", "大纲词词性为 PROPN（专名），可疑", i, w, short(m, 40));
  }

  // fm 仅类型已查；含中文标签为设计如此（界面「词形：…」）
}

// ---------- 内容修订回归（2026-10-22 首批，证据见 docs/内容修订记录-2026-10-22.md） ----------
// 只锁定已核对修订的固定期望与已清理的残留，不做全库语义判断；失败以 warning 提示人工复核。
{
  const fixedExpect = [
    { w: "use", ok: (a) => a[1] === "juːz", note: "主读音应为动词 /juːz/（名词 /juːs/ 由读音展示层按词性呈现）" },
    { w: "minute", ok: (a) => a[1] === "ˈminit" && !/[\s.]/.test(a[1]), note: "主读音应为名词 /ˈmɪnɪt/，不得把形容词 /maɪˈnjuːt/ 塞进 ph" },
    { w: "lead", ok: (a) => !/[\s.]/.test(a[1]), note: "ph 不得夹带过去式 led 的读音" },
    { w: "lie", ok: (a) => /躺/.test(a[2]) && /说谎/.test(a[2]) && /lain/.test(a[10]) && /lied/.test(a[10]), note: "需分义列出躺（lay/lain）与说谎（lied/lied）的词形" },
    { w: "unmistakable", ok: (a) => /the trend that Mr\. McWhorter documents is unmistakable\.$/.test(a[7]) && !/^McWhorter documents is unmistakable/.test(a[7]), note: "例句应恢复为 2005 Text 4 完整原句，而非截断残句" },
    { w: "statistics", ok: (a) => a[3] === 0, note: "普通名词应为 NOUN（p=0），不应标为专名 p=12" },
  ];
  const forms = {
    use: ["use", "uses", "used", "using"],
    minute: ["minute", "minutes"],
    lead: ["lead", "led", "leads", "leading"],
    lie: ["lie", "lies", "lay", "lain", "lied", "lying"],
    unmistakable: ["unmistakable"],
    statistics: ["statistics", "statistic"],
  };
  const hasForm = (ex, list) => list.some((f) => new RegExp(`(^|[^a-z])${f}($|[^a-z])`, "i").test(String(ex || "")));
  for (const { w, ok, note } of fixedExpect) {
    const i = wordFirstIdx.get(w);
    if (i === undefined) {
      warn("content", "修订词条缺失", -1, w, "内容修订回归：词库中找不到该词条");
      continue;
    }
    if (!ok(entries[i])) warn("content", "内容修订回归失败", i, w, note);
    if (!hasForm(entries[i][7], forms[w])) warn("content", "例句未包含目标词形", i, w, `期望 ${forms[w].join("/")}；实际 ${short(entries[i][7])}`);
  }
  // 本轮已清理的填空题/OCR 残留不得回流。
  for (const token of ["_lQ_", "In tum", "can loneliness"]) {
    entries.forEach((a, i) => {
      if (Array.isArray(a) && a.length === 11 && typeof a[7] === "string" && a[7].includes(token)) {
        warn("content", "例句含已清理的 OCR/填空残留", i, a[0], `“${token}”：${short(a[7])}`);
      }
    });
  }
}

// r 连续性与 f 单调性（全局）
if (entries.length && rFirstIdx.size) {
  const rs = [...rFirstIdx.keys()].sort((a, b) => a - b);
  const min = rs[0], max = rs[rs.length - 1];
  if (min !== 1) {
    warn("freq", "排名 r 最小值不是 1", -1, "", `min=${min}`);
  }
  const gaps = [];
  const present = new Set(rs);
  for (let x = min; x <= max; x++) if (!present.has(x)) gaps.push(x);
  if (gaps.length) {
    warn("freq", "排名 r 不连续", -1, "",
      `缺 ${gaps.length} 个: ${gaps.slice(0, 20).join(", ")}${gaps.length > 20 ? " …" : ""}（若为补词/重建后重排可解释）`);
  }
  if (max !== entries.length) {
    warn("freq", "排名 r 最大值与词条数不一致", -1, "", `max=${max}, N=${entries.length}`);
  }

  rToEntry.sort((x, y) => x.r - y.r);
  let inv = 0;
  const invSamples = [];
  for (let i = 1; i < rToEntry.length; i++) {
    if (rToEntry[i].f > rToEntry[i - 1].f) {
      inv++;
      if (invSamples.length < 5) {
        invSamples.push(`${rToEntry[i - 1].w}(r=${rToEntry[i - 1].r},f=${rToEntry[i - 1].f}) → ${rToEntry[i].w}(r=${rToEntry[i].r},f=${rToEntry[i].f})`);
      }
    }
  }
  if (inv) {
    warn("freq", "r 与 f 顺序不一致（f 随 r 应非增）", -1, "",
      `${inv} 处逆序，例: ${invSamples.join("；")}`);
  }
}

// 8) 高频词（r 前 50）释义抽样
const SAMPLE_N = 50;
const sampleRows = [];
const top = rToEntry.slice(0, SAMPLE_N);
for (const { i, w, r } of top) {
  const a = entries[i];
  if (!Array.isArray(a) || a.length !== 11) {
    sampleRows.push({ r, w, m: "—", ok: false, note: "结构损坏" });
    continue;
  }
  const m = a[2];
  const problems = [];
  if (!m || !String(m).trim()) problems.push("空释义");
  else {
    if (!CJK.test(m)) problems.push("无中文");
    if (!POS_PREFIX_RE.test(String(m).trim())) problems.push("无词性前缀");
    if (String(m).length < 6) problems.push("过短");
    if (PLACEHOLDER_RE.test(m)) problems.push("占位符");
    if (GARBLED.test(m)) problems.push("乱码");
  }
  const ok = problems.length === 0;
  if (!ok) {
    warn("sample", `高频词释义可疑（r=${r}）`, i, w, problems.join("；") + "；" + short(m, 40));
  }
  sampleRows.push({ r, w, m: short(m, 52), ok, note: ok ? "正常" : problems.join("；") });
}

// ---------- 汇总 ----------
const errors = issues.filter((x) => x.sev === "error");
const warns = issues.filter((x) => x.sev === "warn");

function group(list) {
  const g = new Map();
  for (const it of list) {
    const key = `${it.type}::${it.label}`;
    if (!g.has(key)) g.set(key, { type: it.type, label: it.label, items: [] });
    g.get(key).items.push(it);
  }
  return [...g.values()].sort((a, b) => b.items.length - a.items.length);
}
const errGroups = group(errors);
const warnGroups = group(warns);

const wordsWithIssues = new Set(issues.filter((x) => x.idx >= 0).map((x) => x.idx));
const cleanWords = entries.length - wordsWithIssues.size;

const byType = {};
for (const it of issues) {
  byType[it.type] ||= { error: 0, warn: 0 };
  byType[it.type][it.sev]++;
}

const now = new Date();
const stamp = now.toLocaleString("zh-CN", { hour12: false });
const verdict = errors.length ? "未通过（存在错误）" : warns.length ? "通过（仅警告）" : "通过（无问题）";
const exitCode = errors.length ? 1 : 0;

// ---------- 控制台摘要 ----------
console.log("词库数据完整性校验");
console.log(`数据源：js/words-data.js`);
console.log(`词条数：${entries.length}`);
console.log("");
console.log("检查结果：");
console.log(`  错误：${errors.length} 条（${errGroups.length} 类）`);
console.log(`  警告：${warns.length} 条（${warnGroups.length} 类）`);
console.log(`  无问题词条：${cleanWords} / ${entries.length}`);
console.log("");

const typeOrder = ["structure", "word", "phonetic", "meaning", "freq", "example", "ky", "content", "sample"];
const typeTitle = {
  structure: "结构", word: "单词", phonetic: "音标", meaning: "释义",
  freq: "词频 r/f/c", example: "例句/来源", ky: "考研大纲 ky", content: "内容修订回归", sample: "高频抽样",
};
console.log("分类统计（错误/警告）：");
for (const t of typeOrder) {
  const s = byType[t] || { error: 0, warn: 0 };
  if (s.error || s.warn) {
    console.log(`  ${typeTitle[t] || t}：${s.error} / ${s.warn}`);
  }
}
if (!errors.length && !warns.length) console.log("  （全部通过）");

function printGroups(title, groups, sev) {
  if (!groups.length) return;
  console.log("");
  console.log(`${title}：`);
  for (const g of groups.slice(0, 12)) {
    console.log(`  [${g.type}] ${g.label} × ${g.items.length}`);
    for (const it of g.items.slice(0, 3)) {
      console.log(`      #${it.idx} ${it.word}${it.detail ? "  — " + short(it.detail, 50) : ""}`);
    }
    if (g.items.length > 3) console.log(`      … 共 ${g.items.length} 条`);
  }
  if (groups.length > 12) console.log(`  … 另有 ${groups.length - 12} 类`);
}
printGroups("错误明细", errGroups, "error");
printGroups("警告明细", warnGroups, "warn");

console.log("");
console.log(`报告：tests/reports/数据校验报告.md`);
console.log(`结论：${verdict}`);
console.log(`退出码：${exitCode}${exitCode === 0 ? "（无 error）" : "（有 error）"}`);

// ---------- 报告 ----------
function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderGroups(groups, sevTitle) {
  const parts = [`## ${sevTitle}`, ""];
  if (!groups.length) {
    parts.push("（无）", "");
    return parts;
  }
  for (const g of groups) {
    const cap = Math.min(LIST_CAP, g.items.length);
    parts.push(`### ${mdEscape(g.label)}`);
    parts.push("");
    parts.push(`- 类别：\`${g.type}\`　数量：**${g.items.length}**${g.items.length > LIST_CAP ? `（仅列前 ${LIST_CAP} 条）` : ""}`);
    parts.push("");
    parts.push("| # | 下标 | 词条 | 说明 |");
    parts.push("|--:|--:|:--|:--|");
    g.items.slice(0, LIST_CAP).forEach((it, n) => {
      parts.push(`| ${n + 1} | ${it.idx} | \`${mdEscape(it.word)}\` | ${mdEscape(it.detail)} |`);
    });
    parts.push("");
  }
  return parts;
}

const md = [];
md.push("# 词库数据校验报告");
md.push("");
md.push(`- 生成时间：${stamp}`);
md.push("- 数据源：`js/words-data.js`（`window.WORDS_RAW`）");
md.push(`- 词条数：**${entries.length}**`);
md.push(`- 数据版本：v${bookMeta?.dataVersion ?? "缺失"}；迁移 ${(bookMeta?.migrations || []).length} 次（旧索引基线 8100）`);
md.push(`- 校验工具：\`js/validate-words.mjs\`（\`node js/validate-words.mjs\`）`);
md.push(`- 结论：**${verdict}**`);
md.push(`- 退出码规则：有 error → 1；仅 warning 或全部通过 → 0。**本次退出码：${exitCode}**`);
md.push("");
md.push("## 概览");
md.push("");
md.push("| 指标 | 数量 |");
md.push("|:--|--:|");
md.push(`| 错误（error） | ${errors.length} |`);
md.push(`| 警告（warning） | ${warns.length} |`);
md.push(`| 无问题词条 | ${cleanWords} / ${entries.length} |`);
md.push("");
md.push("### 分类统计");
md.push("");
md.push("| 类别 | 错误 | 警告 |");
md.push("|:--|--:|--:|");
for (const t of typeOrder) {
  const s = byType[t] || { error: 0, warn: 0 };
  md.push(`| ${typeTitle[t] || t} | ${s.error} | ${s.warn} |`);
}
md.push("");

// 数据画像（帮助理解「可解释」的分布）
md.push("## 数据画像");
md.push("");
if (entries.length && Array.isArray(entries[0]) && entries[0].length === 11) {
  const nPh = entries.filter((a) => a[1]).length;
  const nEx = entries.filter((a) => a[7]).length;
  const nKy = entries.filter((a) => a[9] === 1).length;
  const nFm = entries.filter((a) => a[10]).length;
  const fs_ = entries.map((a) => a[5]);
  const cs = entries.map((a) => a[6]);
  md.push(`- 音标非空：${nPh}；释义非空：${entries.filter((a) => a[2] && a[2].trim()).length}；例句非空：${nEx}；词形说明非空：${nFm}`);
  md.push(`- 考研大纲词（ky=1）：${nKy}（占 ${(100 * nKy / entries.length).toFixed(1)}%）`);
  md.push(`- 词频 f：min=${Math.min(...fs_)}, max=${Math.max(...fs_)}；试卷数 c：min=${Math.min(...cs)}, max=${Math.max(...cs)}`);
}
md.push(`- 已知残缺词形（与 \`tests/fixtures/spelling-fixes.json\` 交叉）：词库内命中 ${issues.filter((x) => x.label === "已知残缺词形").length} 条`);
md.push("");
md.push("> 说明：音标缺失、例句缺失在构建管线中属于已知状态（ECDICT 无词条 / 未抽到合格例句），计为**警告**而非错误；");
md.push("> 重复词条、释义占位、ky 非 0/1、r/f/c 越界等会破坏应用或进度主键语义的问题计为**错误**。");
md.push("");

md.push(...renderGroups(errGroups, "错误明细"));
md.push(...renderGroups(warnGroups, "警告明细"));

md.push("## 高频词释义抽样（r 前 50）");
md.push("");
md.push("抽查标准：释义非空、含中文、含词性前缀、长度 ≥ 6、无占位符/乱码。");
md.push("");
md.push("| r | 词条 | 释义（截断） | 抽查 |");
md.push("|--:|:--|:--|:--|");
for (const row of sampleRows) {
  md.push(`| ${row.r} | \`${mdEscape(row.w)}\` | ${mdEscape(row.m)} | ${row.ok ? "✅" : "⚠ " + mdEscape(row.note)} |`);
}
md.push("");

md.push("## 校验项与判定");
md.push("");
md.push("| # | 校验项 | 错误条件 | 警告条件 |");
md.push("|--:|:--|:--|:--|");
md.push("| 1 | 结构 | 非数组/空数组；字段数 ≠ 11；字段类型不符；p 越界 | — |");
md.push("| 2 | 单词 | 空；拼写非小写规范；含空白；重复 | 单字母；命中 spelling-fixes 残缺词形 |");
md.push("| 3 | 音标 | 混入中文/西里尔/乱码/控制符 | 缺失；含 IPA 不常见字符；非标准符号；不含元音 |");
md.push("| 4 | 释义 | 空；占位符；乱码/控制符 | 无中文；无词性前缀 |");
md.push("| 5 | 词频 r/f/c | r<1 或重复；f<1；c<1 或 c>46 或 c>f | r 不连续；r 最小≠1/最大≠N；r 与 f 逆序 |");
md.push("| 6 | 例句/来源 | — | 含中文；过短(<4词)；残留题号/选项；引号不配对；乱码；非常见字符；例句与来源不齐；来源格式不规范 |");
md.push("| 7 | ky 一致性 | ky∉{0,1}；大纲词缺释义 | 大纲词缺音标；残缺词形标大纲；词性 PROPN 却标大纲 |");
md.push("| 8 | 高频抽样 | — | r 前 50 释义不合格（无中文/无词性前缀/过短/占位/乱码） |");
md.push("| 9 | 内容修订回归 | 控制字符/替换符/私用区；2026-10-23 已确认污染例句回流 | 已核对词条（use/minute/lead/lie/unmistakable/statistics）的读音/词性/词形/例句偏离固定期望；例句回流 `_lQ_`、`In tum` 等已清理残留；例句不含目标词形 |");
md.push("");
md.push("字段顺序（与 `js/app.js` 一致）：`w, ph, m, p, r, f, c, ex, src, ky, fm`。");
md.push("");

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, md.join("\n") + "\n", "utf8");

process.exit(exitCode);
