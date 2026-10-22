/**
 * 语境义试点数据（js/senses-data.js）真实数据断言测试。
 * 运行：node --max-old-space-size=512 js/test-senses-data.mjs
 *
 * 不启动浏览器：用 vm 加载四书真实词库与 js/senses-data.js，
 * 逐条核对 schema、规模、四书隔离、surface 命中、真题出处溯源、
 * 综合书 apply「涂抹、敷」/ content「含量」补充义，以及
 * 与 js/app.js wordSenseEntry() 等价的数据契约回退语义。
 *
 * 注意：本文件只校验「内容层数据」。页面真实渲染由批次 D 的
 * js/test-senses.mjs（真实 app.js + DOM 桩）负责，不在此复制渲染逻辑。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const normLower = s => norm(s).toLowerCase();

const WORD_FILES = ["js/words-data.js", "js/cet-words-data.js", "js/combined-words-data.js"];
const SENSES_FILE = "js/senses-data.js";
const BOOK_KEYS = ["kaoyan", "cet4", "cet6", "combined"];
const BOOK_LABEL = { kaoyan: "考研英语", cet4: "英语四级", cet6: "英语六级", combined: "综合词书" };
const ARRAY_OF = { kaoyan: "WORDS_RAW", cet4: "WORDS_CET4", cet6: "WORDS_CET6", combined: "WORDS_COMBINED" };
const SRC_RE = /^(?:(?:四级|六级) \d{4}\.\d{2}|(?:英语一|英语二|旧题型) \d{4})$/;
const SELF_MADE_RE = /^自编(?:例句)?$/;
const CLAIM_RE = /真题考义|已核验|逐义核验|全部核验/;

// ---------- 加载真实数据（与页面一致的 window 全局赋值） ----------
const sensesSource = read(SENSES_FILE);
const wordsSource = WORD_FILES.map(read);
const box = vm.createContext({ window: {} });
for (const source of [...wordsSource, sensesSource]) vm.runInContext(source, box);
const W = box.window;
const SENSES = W.WORD_SENSES;
const wordBooks = {};
for (const key of BOOK_KEYS) {
  const arr = W[ARRAY_OF[key]];
  assert.ok(Array.isArray(arr), `词库 ${ARRAY_OF[key]} 必须存在`);
  wordBooks[key] = { arr, map: new Map(arr.map(t => [t[0], t])) };
}
// (source, quote) → 命中词书集合，用于综合书跨书证据溯源
const evidenceIndex = new Map();
for (const key of BOOK_KEYS) {
  for (const t of wordBooks[key].arr) {
    if (!Array.isArray(t)) continue;
    const source = String(t[8] ?? "");
    if (!source || SELF_MADE_RE.test(source)) continue;
    const k = source + "\u0000" + norm(t[7]);
    if (!evidenceIndex.has(k)) evidenceIndex.set(k, new Set());
    evidenceIndex.get(k).add(key);
  }
}

/** js/app.js wordSenseEntry() 契约的等价实现（词书 + 单词文本读取；不读取任何进度下标）。 */
function wordSenseEntry(data, bookId, word) {
  const object = v => v && typeof v === "object" && !Array.isArray(v);
  const own = (v, key) => object(v) && Object.prototype.hasOwnProperty.call(v, key);
  if (typeof word !== "string" || !object(data) || data.schemaVersion !== 1
      || !own(data.books, bookId) || !own(data.books[bookId], word)) return null;
  const entry = data.books[bookId][word];
  if (!object(entry) || !Array.isArray(entry.preferred) || !entry.preferred.length
      || typeof entry.additional !== "string") return null;
  for (const sense of entry.preferred) {
    if (!object(sense) || typeof sense.meaning !== "string" || !sense.meaning.trim()
        || !Array.isArray(sense.examples) || !sense.examples.length) return null;
    for (const example of sense.examples) {
      if (!object(example) || !["source", "quote", "surface"].every(k => typeof example[k] === "string" && example[k].trim())
          || (example.label !== undefined && typeof example.label !== "string")
          || !example.quote.replace(/\s+/g, " ").toLowerCase().includes(example.surface.replace(/\s+/g, " ").toLowerCase())) return null;
    }
  }
  return entry;
}

const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS  " + name);
  } catch (error) {
    failures.push({ name, error });
    console.log("FAIL  " + name + "\n      " + String(error.message || error).split("\n").join("\n      "));
  }
}

// 统计
const stats = {};
let totalWords = 0, totalSenses = 0, totalExamples = 0;
if (SENSES && SENSES.books) {
  for (const key of BOOK_KEYS) {
    const entries = SENSES.books[key] || {};
    const words = Object.keys(entries);
    const senses = words.reduce((n, w) => n + (Array.isArray(entries[w]?.preferred) ? entries[w].preferred.length : 0), 0);
    const examples = words.reduce((n, w) => n + (Array.isArray(entries[w]?.preferred)
      ? entries[w].preferred.reduce((m, s) => m + (Array.isArray(s?.examples) ? s.examples.length : 0), 0) : 0), 0);
    stats[key] = { words: words.length, senses, examples };
    totalWords += words.length; totalSenses += senses; totalExamples += examples;
  }
}

check("数据文件可直接作为 <script> 执行，schemaVersion=1 且 books 恰好四书", () => {
  assert.ok(SENSES, "window.WORD_SENSES 必须存在");
  assert.equal(SENSES.schemaVersion, 1);
  assert.deepEqual(Object.keys(SENSES.books).sort(), [...BOOK_KEYS].sort());
  for (const key of BOOK_KEYS) {
    assert.ok(SENSES.books[key] && typeof SENSES.books[key] === "object" && !Array.isArray(SENSES.books[key]), `books.${key} 必须是对象`);
  }
});

check("数据文件无模块/网络依赖（可离线 <script> 加载，不引入独立 JSON 请求）", () => {
  assert.ok(!/(^|\n)\s*(?:import\s|export\s)/.test(sensesSource), "不得使用 import/export");
  assert.ok(!/\brequire\s*\(|\bfetch\s*\(|XMLHttpRequest/.test(sensesSource), "不得使用 require/fetch/XMLHttpRequest");
  assert.ok(Buffer.byteLength(sensesSource) < 200 * 1024, `文件体积应可控，实际 ${Buffer.byteLength(sensesSource)} bytes`);
  assert.ok(sensesSource.includes("window.WORD_SENSES"), "必须以 window.WORD_SENSES 全局赋值交付");
});

check("规模符合试点要求：总条目 50–100，kaoyan≈40 / cet4≈20 / cet6≈20 / combined 10–20", () => {
  assert.ok(totalWords >= 50 && totalWords <= 100, `总条目应为 50–100，实际 ${totalWords}`);
  const range = { kaoyan: [35, 45], cet4: [15, 25], cet6: [15, 25], combined: [10, 20] };
  for (const key of BOOK_KEYS) {
    const [min, max] = range[key];
    assert.ok(stats[key].words >= min && stats[key].words <= max, `${BOOK_LABEL[key]}条目应为 ${min}–${max}，实际 ${stats[key].words}`);
  }
  assert.ok(totalSenses >= totalWords, "义项数不得少于条目数");
  console.log(`      条目 ${totalWords}（kaoyan ${stats.kaoyan.words} / cet4 ${stats.cet4.words} / cet6 ${stats.cet6.words} / combined ${stats.combined.words}），义项 ${totalSenses}，例句 ${totalExamples}`);
});

check("每个词键存在于对应词书的真实 11 元组（四书各自隔离）", () => {
  for (const key of BOOK_KEYS) {
    for (const word of Object.keys(SENSES.books[key])) {
      assert.match(word, /^[a-z][a-z'’-]*$/, `${key}/${word} 必须是小写英文词键`);
      assert.ok(wordBooks[key].map.has(word), `${key}/${word} 不在本书词库中（页面按词书隔离读取，永远命中不了）`);
    }
  }
});

check("所有真实条目都通过 wordSenseEntry 等价契约（不合格会整条回退）", () => {
  for (const key of BOOK_KEYS) {
    for (const word of Object.keys(SENSES.books[key])) {
      assert.ok(wordSenseEntry(SENSES, key, word), `${key}/${word} 未通过 wordSenseEntry 契约`);
    }
  }
});

check("每个 preferred 义项有简洁中文释义与非空例句，additional 均为字符串", () => {
  for (const key of BOOK_KEYS) {
    for (const [word, entry] of Object.entries(SENSES.books[key])) {
      assert.ok(Array.isArray(entry.preferred) && entry.preferred.length, `${key}/${word}.preferred 必须是非空数组`);
      assert.equal(typeof entry.additional, "string", `${key}/${word}.additional 必须是字符串`);
      assert.ok(!CLAIM_RE.test(entry.additional), `${key}/${word}.additional 不得声称已核验/真题考义`);
      for (const sense of entry.preferred) {
        assert.equal(typeof sense.meaning, "string");
        assert.ok(sense.meaning.trim(), `${key}/${word} 义项释义不得为空`);
        assert.ok(Array.isArray(sense.examples) && sense.examples.length, `${key}/${word} 义项必须有原句`);
      }
    }
  }
});

check("每条例句 surface 在 quote 中命中（空白归一、大小写不敏感）且 source/quote/surface 非空", () => {
  for (const key of BOOK_KEYS) {
    for (const [word, entry] of Object.entries(SENSES.books[key])) {
      for (const sense of entry.preferred) for (const example of sense.examples) {
        for (const field of ["source", "quote", "surface"]) {
          assert.equal(typeof example[field], "string", `${key}/${word}.${field} 必须是字符串`);
          assert.ok(example[field].trim(), `${key}/${word}.${field} 不得为空`);
        }
        assert.ok(normLower(example.quote).includes(normLower(example.surface)), `${key}/${word} surface「${example.surface}」未命中 quote`);
        if (example.label !== undefined) assert.equal(typeof example.label, "string");
      }
    }
  }
});

check("自编例句不得作为 preferred 证据；真题来源格式合法且可在词库溯源", () => {
  let selfMade = 0;
  for (const key of BOOK_KEYS) {
    for (const [word, entry] of Object.entries(SENSES.books[key])) {
      for (const sense of entry.preferred) for (const example of sense.examples) {
        assert.ok(!SELF_MADE_RE.test(example.source), `${key}/${word} 把自编例句（${example.source}）当成了真题证据`);
        assert.match(example.source, SRC_RE, `${key}/${word} source 不像真题出处：${example.source}`);
        if (key === "combined") {
          const hit = evidenceIndex.get(example.source + "\u0000" + norm(example.quote));
          assert.ok(hit, `${key}/${word} 在四书词库中找不到该 (source, quote) 真题原句`);
        } else {
          const tuple = wordBooks[key].map.get(word);
          assert.ok(tuple, `${key}/${word} 不在本书词库`);
          assert.equal(String(tuple[8]), example.source, `${key}/${word} 非综合书证据必须来自本书该词自己的词条（source 不一致）`);
          assert.equal(norm(tuple[7]), norm(example.quote), `${key}/${word} 非综合书证据必须来自本书该词自己的词条（quote 不一致）`);
          selfMade += SELF_MADE_RE.test(String(tuple[8])) ? 1 : 0;
        }
      }
    }
  }
  assert.equal(selfMade, 0);
});

check("人工复核语境：短语整体义、benefit 及物义及三条残句不回流", () => {
  for (const [book, word, phrase] of [
    ["kaoyan", "high", "high street"], ["combined", "high", "high street"],
    ["kaoyan", "take", "take turns"], ["combined", "take", "take turns"],
    ["cet6", "place", "take place"], ["kaoyan", "effect", "in effect"],
  ]) {
    const entry = SENSES.books[book][word];
    assert.ok(entry.preferred.some(s => s.meaning.includes("搭配") && s.meaning.includes(phrase)),
      `${book}/${word} 必须明确 ${phrase} 是搭配整体义，不能误标单词词性`);
  }
  assert.ok(SENSES.books.cet6.benefit.preferred.some(s => /^vt\./.test(s.meaning) && /使受益|有益于/.test(s.meaning)),
    "To benefit both researchers... 中 benefit 带直接宾语，应为及物的使受益义");
  for (const book of BOOK_KEYS) for (const [word, entry] of Object.entries(SENSES.books[book])) {
    for (const sense of entry.preferred) for (const example of sense.examples) {
      assert.doesNotMatch(norm(example.quote), /\bby St\.$|\bacts\.\s+of advocacy\b|\battribute to various gadgets\.$/i,
        `${book}/${word} 不得把已确认的截断、异常句号或缺词当作已核对证据`);
    }
  }
  assert.deepEqual([totalWords, totalSenses, totalExamples], [96, 98, 98], "本次局部修订保留 96/98/98 试点规模");
});

check("综合书补充义：apply「涂抹、敷」、content「含量」存在且来源/标签标明四级真题", () => {
  const apply = SENSES.books.combined.apply;
  const content = SENSES.books.combined.content;
  assert.ok(apply && content, "综合书必须含 apply 与 content 补充试点");
  const applySense = apply.preferred.find(s => s.meaning.includes("涂抹"));
  const contentSense = content.preferred.find(s => s.meaning.includes("含量"));
  assert.ok(applySense, "combined.apply 缺少「涂抹、敷」义项");
  assert.ok(contentSense, "combined.content 缺少「含量」义项");
  for (const [word, sense, keyword] of [["apply", applySense, "涂抹"], ["content", contentSense, "含量"]]) {
    const example = sense.examples[0];
    assert.ok(example.source.startsWith("四级"), `combined.${word}「${keyword}」的 source 必须写明四级真题来源，实际「${example.source}」`);
    assert.ok(/四级/.test(String(example.label || "")) || /四级/.test(example.source), `combined.${word}「${keyword}」必须明确标注四级真题来源（source/label）`);
    const hit = evidenceIndex.get(example.source + "\u0000" + norm(example.quote));
    assert.ok(hit && hit.has("cet4"), `combined.${word}「${keyword}」的原句必须能在四级词库中找到`);
    console.log(`      ${word}「${keyword}」← ${example.source}${example.label ? " · " + example.label : ""}`);
  }
  // 不得机械拼接：综合书补充义只在综合书出现，其他书 apply/content 保持原有义项
  for (const key of ["kaoyan", "cet6"]) {
    const entry = SENSES.books[key].apply;
    if (entry) assert.ok(!entry.preferred.some(s => s.meaning.includes("涂抹")), `${key}.apply 不得回写综合书补充义`);
  }
  assert.equal(SENSES.books.cet4.apply.preferred.length, 1, "四级 apply 保持原有单义项，补充义只在综合书");
});

check("四书隔离：未在当前书收录的词返回 null，同一单词各书独立键控", () => {
  assert.ok(wordSenseEntry(SENSES, "kaoyan", "can"), "kaoyan/can 应有语境义");
  assert.equal(wordSenseEntry(SENSES, "cet4", "can"), null, "cet4 未收录 can 的语境义，必须回退（四书隔离）");
  assert.equal(wordSenseEntry(SENSES, "kaoyan", "this-word-not-in-books"), null);
  assert.equal(wordSenseEntry(SENSES, "not-a-book", "can"), null);
  // 同一单词跨书独立：combined.apply 有 2 个义项，cet4.apply 只有自己的 1 个
  assert.equal(SENSES.books.combined.apply.preferred.length, 2);
  assert.equal(SENSES.books.cet4.apply.preferred.length, 1);
  // combined 独有补充义不得泄漏到其他书
  assert.ok(!SENSES.books.kaoyan.apply, "kaoyan 未收录 apply 语境义（不在试点清单）");
});

check("无效数据完整回退为 null（schema/词书/词条/preferred/additional/surface 六类）", () => {
  const badVersion = clone(SENSES); badVersion.schemaVersion = 2;
  assert.equal(wordSenseEntry(badVersion, "kaoyan", "can"), null, "schemaVersion 非 1 必须回退");
  const badBooks = clone(SENSES); delete badBooks.books.cet4;
  assert.equal(wordSenseEntry(badBooks, "cet4", "apply"), null, "缺本书 books 项必须回退");
  const badWord = clone(SENSES); delete badWord.books.kaoyan.can;
  assert.equal(wordSenseEntry(badWord, "kaoyan", "can"), null, "缺词条必须回退");
  const emptyPreferred = clone(SENSES); emptyPreferred.books.kaoyan.can.preferred = [];
  assert.equal(wordSenseEntry(emptyPreferred, "kaoyan", "can"), null, "preferred 为空必须回退");
  const badAdditional = clone(SENSES); delete badAdditional.books.kaoyan.can.additional;
  assert.equal(wordSenseEntry(badAdditional, "kaoyan", "can"), null, "additional 非字符串必须回退");
  const badSurface = clone(SENSES); badSurface.books.kaoyan.can.preferred[0].examples[0].surface = "definitely-not-in-quote";
  assert.equal(wordSenseEntry(badSurface, "kaoyan", "can"), null, "surface 未命中必须回退");
  const badLabel = clone(SENSES); badLabel.books.kaoyan.can.preferred[0].examples[0].label = 42;
  assert.equal(wordSenseEntry(badLabel, "kaoyan", "can"), null, "label 非字符串必须回退");
});

console.log(`\n${failures.length ? "FAIL" : "OK"}  js/test-senses-data.mjs：${passed} 项通过${failures.length ? `，${failures.length} 项失败` : ""}`);
if (failures.length) {
  for (const { name, error } of failures) console.error(`\n✗ ${name}\n${error.stack || error.message || error}`);
  process.exit(1);
}
console.log("语境义数据断言全部通过：四书隔离、surface 命中、真题溯源、综合补充义与回退语义均符合 app.js 契约。");
