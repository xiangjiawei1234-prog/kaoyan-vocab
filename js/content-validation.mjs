/** 词库校验器共用的内容门控；只供 Node 校验/测试，不进入页面或词库 11 元组。 */
import fs from 'node:fs';
import vm from 'node:vm';

const fixes = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/content-fixes-20261023.json', import.meta.url), 'utf8'));
const nextFixes = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/content-fixes-batch2-20261023.json', import.meta.url), 'utf8'));
const thirdFixesPath = new URL('../tests/fixtures/content-fixes-batch3-20261023.json', import.meta.url);
const thirdFixes = fs.existsSync(thirdFixesPath) ? JSON.parse(fs.readFileSync(thirdFixesPath, 'utf8')) : { confirmedBadExamples: [] };
const maintenanceFixes = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/content-fixes-maintenance-20261023.json', import.meta.url), 'utf8'));
const meaningFixesPath = new URL('../tests/fixtures/content-fixes-meaning-20261024.json', import.meta.url);
const meaningFixes = fs.existsSync(meaningFixesPath) ? JSON.parse(fs.readFileSync(meaningFixesPath, 'utf8')) : { corrections: [] };
const meaningFixes20261025Path = new URL('../tests/fixtures/content-fixes-meaning-20261025.json', import.meta.url);
const meaningFixes20261025 = fs.existsSync(meaningFixes20261025Path) ? JSON.parse(fs.readFileSync(meaningFixes20261025Path, 'utf8')) : { corrections: [] };
const phoneticFixesPath = new URL('../tests/fixtures/content-fixes-phonetic-20261025.json', import.meta.url);
const phoneticFixes = fs.existsSync(phoneticFixesPath) ? JSON.parse(fs.readFileSync(phoneticFixesPath, 'utf8')) : { corrections: [] };
const phoneticNormalizePath = new URL('../tests/fixtures/content-fixes-phonetic-normalize-20261025.json', import.meta.url);
const phoneticNormalize = fs.existsSync(phoneticNormalizePath) ? JSON.parse(fs.readFileSync(phoneticNormalizePath, 'utf8')) : { corrections: [] };
const formsFixesPath = new URL('../tests/fixtures/content-fixes-forms-20261025.json', import.meta.url);
const formsFixes = fs.existsSync(formsFixesPath) ? JSON.parse(fs.readFileSync(formsFixesPath, 'utf8')) : { corrections: [] };
const pronunciationFixesPath = new URL('../tests/fixtures/content-fixes-pronunciation-20261027.json', import.meta.url);
const pronunciationFixes = fs.existsSync(pronunciationFixesPath) ? JSON.parse(fs.readFileSync(pronunciationFixesPath, 'utf8')) : { corrections: [] };
const FIELD_NAMES = { 1: 'phonetic', 2: 'meaning', 3: 'posIdx', 7: 'example', 8: 'source', 10: 'forms' };
const normalized = text => String(text || '').replace(/\s+/g, ' ').trim();
const confirmedBadExamples = new Set(fixes.confirmedBadExamples.concat(nextFixes.confirmedBadExamples, thirdFixes.confirmedBadExamples || []).map(normalized));
const correctionByBookWord = new Map();
// 同一书+词多批次修不同字段时合并 before/after；同字段以更晚批次为准（A 的旧畸形值由格式门控兜底）。
for (const correction of [...maintenanceFixes.corrections, ...meaningFixes.corrections, ...meaningFixes20261025.corrections, ...phoneticNormalize.corrections, ...phoneticFixes.corrections, ...formsFixes.corrections, ...pronunciationFixes.corrections]) {
  for (const reference of correction.references) {
    const key = reference.book + ':' + correction.word;
    const prev = correctionByBookWord.get(key);
    if (prev) {
      // 同书同词可能被多个批次修过不同字段（如释义 + 音标），合并 before/after 后一起门控。
      correctionByBookWord.set(key, {
        id: [...new Set([prev.id, correction.id])].join('/'),
        before: { ...prev.before, ...correction.before },
        after: { ...prev.after, ...correction.after },
      });
    } else correctionByBookWord.set(key, correction);
  }
}
// 已删除的 OCR 假词条（如 relection）：删除走 dataVersion 迁移，不允许以任何释义重新回流。
const removedByBook = new Map();
for (const item of (meaningFixes.removedHeadwords || [])) {
  if (!removedByBook.has(item.book)) removedByBook.set(item.book, new Map());
  removedByBook.get(item.book).set(item.word, item);
}
// TAB/LF/CR 可作文本排版；其余 C0、DEL/C1、替换符与私用区不应成为交付学习文本。
export const BAD_CONTENT_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd\ufffe\uffff\u{e000}-\u{f8ff}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/u;

export function contentEncodingFields(row) {
  return Array.isArray(row) ? row.flatMap((value, index) => typeof value === 'string' && BAD_CONTENT_CHAR_RE.test(value) ? [index] : []) : [];
}

const CJK_RE = /[\u4e00-\u9fff]/g;
// 释义必须是中文词义：拼写变体交叉引用（v. <主英>=rationalize）、派生词「X的变形」说明、
// 只有词形说明（a. prove的过去分词）或纯英文都不是可背的释义。命中即由校验器报错。
export function meaningContentIssues(meaning) {
  if (typeof meaning !== 'string' || !meaning.trim()) return ['释义为空'];
  const text = meaning.trim();
  const cjk = (text.match(CJK_RE) || []).length;
  const issues = [];
  if (cjk === 0) issues.push('释义不含中文');
  if (/\b[a-z]{1,2}\.\s*(?:<[^>]{1,8}>)?\s*=\s*[a-z]/i.test(text)) issues.push('释义为拼写变体交叉引用（=原形），缺少中文词义');
  if (/的变形/.test(text)) issues.push('释义为派生词「X的变形」说明，缺少中文词义');
  const stripped = text.replace(/的?(变体|变形|过去分词|过去式|现在分词|复数|比较级|最高级|缩写|简称)/g, '').replace(/[和与及或等的]/g, '');
  if (cjk > 0 && (stripped.match(CJK_RE) || []).length === 0 && /[a-zA-Z]{3,}/.test(text)) issues.push('释义中文仅为词形/变体说明，缺少实际词义');
  return [...new Set(issues)];
}

export function isRemovedHeadword(book, word) {
  return Boolean(removedByBook.get(book)?.has(String(word || '')));
}

export function removedHeadwordIssues(book, rows) {
  const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows : [rows];
  return list.flatMap(row => Array.isArray(row) && isRemovedHeadword(book, row[0])
    ? ['已删除词头回流：' + row[0] + '（' + removedByBook.get(book).get(row[0]).removedAt + ' 迁移删除）']
    : []);
}

export function isConfirmedBadExample(example) {
  const text = normalized(example);
  return confirmedBadExamples.has(text) || /_lQ_|In tum, feeling close to objects can loneliness\.|alretJ\.dy|fif\?Jd_s/.test(text);
}

// 仅拦截有词典证据的本书/词头旧值回流，不把合法共享原句列为全库污染。
// 来源字段不单独封禁：同年真题可能合法，错配只按目标词的旧例句识别。
export function confirmedCorrectionIssues(book, row) {
  if (!Array.isArray(row)) return [];
  const correction = correctionByBookWord.get(book + ':' + row[0]);
  if (!correction) return [];
  return Object.entries(correction.before).flatMap(([field, before]) => {
    if (field === '8' || before === correction.after[field]) return [];
    const reverted = field === '7' ? normalized(row[7]) === normalized(before) : row[Number(field)] === before;
    return reverted ? [correction.id + ' ' + FIELD_NAMES[Number(field)] + ' 旧值'] : [];
  });
}

// 精确匹配词头或该条 fm 明列的屈折形；不靠前几字母/宽泛后缀吞掉真正的错配。
// fm 仍是唯一已交付词形来源，不在验证器发明新派生关系。
export function exampleWordForms(word, fm = '') {
  return [...new Set([String(word || '').toLowerCase(), ...(String(fm).match(/[a-z]+(?:['-][a-z]+)*/gi) || []).map(s => s.toLowerCase())].filter(Boolean))];
}

export function exampleHasWordForm(word, example, fm = '') {
  const tokens = new Set((String(example || '').toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) || []));
  return exampleWordForms(word, fm).some(form => tokens.has(form));
}

// 覆盖检查沿用页面已经交付的保守屈折算法；严格的已确认修订门控仍用上方 fm-only 检查。
// 只在 Node 中执行本地 app.js 的纯函数区，不启动页面，也不维护第二份不规则表/后缀规则。
let coverageForms = null;
function appExampleWordForms() {
  if (coverageForms) return coverageForms;
  const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const start = source.indexOf('  const IRREGULAR_FORMS = {');
  const end = source.indexOf('  /* ---- 例句查义：', start);
  if (start < 0 || end <= start) throw new Error('无法定位 app.js 的例句词形纯函数区；请同步内容校验器');
  // 综合书是三源书精确词头并集；与页面的四书并集一样保护 star/stare 等删 e 碰撞。
  const dataContext = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(new URL('./combined-words-data.js', import.meta.url), 'utf8'), dataContext, { timeout: 10000 });
  const rows = dataContext.window.WORDS_COMBINED;
  if (!Array.isArray(rows) || !rows.length) throw new Error('综合词书不可用，不能执行例句覆盖校验');
  const wordIndex = new Set(rows.map(row => row[0]));
  const context = vm.createContext({ BOOKS: { combined: { wordIndex } } });
  coverageForms = vm.runInContext(source.slice(start, end) + '\nexampleWordForms;', context, { timeout: 1000 });
  return coverageForms;
}

// 只证明“句内有目标词或合理屈折”，不证明词义匹配、语法自然或真题来源真实性。
export function exampleHasInflectedForm(word, example, fm = '', pos) {
  const tokens = new Set(String(example || '').toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:['-][a-z]+)*/g) || []);
  const forms = appExampleWordForms()({ w: String(word || ''), fm, p: pos });
  return [...forms].some(form => tokens.has(form));
}

// ---------- 机械污染 warning 级扫描（只报告，不自动改；不进入硬门控） ----------
// 依据 docs/优化工作记录-2026-10-23-交付复审.md 第 3 节 P2 建议：句末题号、题号填空、双逗号、
// 明显 OCR 词等只做 warning，供下一批人工核验；已确认句族走 confirmedBadExamples 硬门控。
const FUNC_WORDS = 'the|a|an|of|to|in|on|at|for|with|from|by|as|and|or|but|is|are|was|were|be|been|being|has|have|had|will|would|could|can|may|might|must|should|who|which|that|than|then|so|if|when|where|while|because|into|about|over|under|between|through|during|without|within|after|before|against|toward|towards|upon|per|also|only|even|still|just|not|no|very|more|less|he|she|they|we|it|this|these|those|there|your|our|their|his|her|its|some|most|such|own|same|both|each|other|another|any|all';
const FUNC_SET = new Set(FUNC_WORDS.split('|'));
const CLOZE_PREV_SET = new Set('the a an some of to most who which that will would could can may might must should not from with at in on for into about he she they we it this these those there your our their his her its own same both each other another any all also only even still just no very more less'.split(' '));
const CLOZE_NEXT_LEGIT = new Set(['or', 'and', 'but', 'other', 'more', 'less', 'fewer']);
const NUMBERED_NOUNS = new Set(['aisle', 'section', 'chapter', 'unit', 'volume', 'page', 'question', 'lesson', 'part', 'gate', 'room', 'floor', 'exit', 'route', 'highway', 'motorway', 'flight', 'bus', 'train', 'article', 'act', 'rule', 'text', 'passage', 'item', 'step', 'figure', 'table', 'exhibit', 'grade', 'level']);
const OCR_WORD_RE = /\b(?:araid|mamed|fanners|opportun\s+es|youropinions|pigeons9|tecnology|infom\s+d|tor\s+many|ctDr|Compassionis)\b/i;
const OCR_GLUE_WHITELIST = /^(?:co2|h2o|o2|no2|so2|pm2|pm10|2d|3d|4k|5g|4g|mp3|g7|g20|m25|a300|b2b|covid19)$/i;
const QUESTION_STEM_RE = /(?:^|[\s.!?])\d{1,2}\s*[.．]\s*(?:What|Which|Why|How|Who|When|Where|It\s+can\s+be|The\s+author|According\s+to|In\s+which|What\s+does|Which\s+of\s+the)\b/i;
const QUESTION_SECTION_RE = /\bQuestions?\s+\d+\s+to\s+\d+\s+are\s+based\b|\bPassage\s+(?:One|Two|Three|Four)\b|\bText\s+\d+\b/;
const OPTION_RESIDUE_RE = /(?:^|\s)[A-D]\s?\)\s*(?:[A-Z][a-z]|The|It|They|He|She|To|In|By|Because|Our|Its|Their|His|Her|This|That|These|Those|Opting|Using|Making|Find|Give|Look|Carry|Soak|Take|Figure|Help|Try|Allow|Play|Bring|Why|What|Which|How)\b/;
const WRONG_WORD_PERIOD_RE = /\b(?:the|and|but|with|from|that|this|have|will|would|could|should|which|there|their)\.\s+[a-z]/;
const JUNK_SYMBOL_RE = /,{2,}|(?<!\.)\.\.(?!\.)|\(\s*\.{2,}|\(\s*[;{]|[{}]|;\]|\(\s*[A-Z]?\.\.|[()]\s*[;,.±]\s*[)]/;

// 只把 Latin-1（重音字母/货币/°）、通用标点、货币、分数、×÷ 视为正常阅读字符；Latin Extended-A/B
// 在合法例句中未出现，多为 OCR 替字（ť/ţ/Ŧ/Ğ/ǧ/ď/Đ…），纳入 warning。
const ALLOWED_NONASCII = /[\u00A0-\u00FF\u2000-\u206F\u20A0-\u20BF\u2150-\u218F\u2212\u00D7\u00F7]/;
const OCR_WORD_EXTRA_RE = /\b(?:aaolescence|mot\s+including)\b/i;
const OPTION_EO_RE = /(?:^|[\s.!?"'])[E-O]\s?\)\s*(?:[A-Z]|The|It|They|He|She|To|In|By|Because|All|Ideally|Twelve|But|Food|Illuminum|There|What|Which|Why|How|No|One|Some|Many|Most|This|That|These|Those|When|Where)/;
const NUMBERED_OPTION_RE = /(?:^|\s)\d\)\s+[A-Z]/;
const LETTER_OPTION_RE = /(?:^|[\s.!?"'])[A-O]\s?\)\s+[a-z]/;
const TRAILING_NO_PUNCT_RE = /[A-Za-z]['")\]]?$/;

function hasUnclosedParen(text) {
  return (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length && /\w/.test(text);
}

function hasParenJunk(text) {
  for (const match of text.matchAll(/\(([^()]{1,30})\)/g)) {
    const inner = match[1];
    if (/[#^&*±⁄|~`\\<>]/.test(inner)) return true;
    if (/\$\s|\$[^\d]|[^\d\s]\$/.test(inner)) return true;
    if (/[!?;]/.test(inner)) return true;
    if (/,\S/.test(inner) && !/\d[\d,]*,\d/.test(inner)) return true;
    if (/[^\x00-\x7F]/.test(inner) && !ALLOWED_NONASCII.test(inner)) return true;
    if (/^[A-Z][a-z]$/.test(inner)) return true;
    if (/^[A-Z]{2}$/.test(inner) && !/[AEIOU]/.test(inner)) return true;
  }
  return false;
}

function hasStrayCloseParen(text) {
  if (/^(?:In your (?:writing|essay)|Write\b)/.test(text)) return false; // 写作题 1) 2) 指令
  return (text.match(/\)/g) || []).length > (text.match(/\(/g) || []).length;
}

function hasWeirdChars(text) {
  return [...text].some(ch => ch.codePointAt(0) > 127 && !ALLOWED_NONASCII.test(ch) && !/[\u3400-\u9fff]/.test(ch));
}

// 先剥离合法数字结构（年份/日期/区间/年龄/单位/百分比/时间/编号专名），避免题号填空规则误伤正常数字。
function stripLegitNumbers(text) {
  return text
    .replace(/\b\d{1,3}\s*(?:to|or|-|–|—|and)\s*\d{1,3}\b/g, ' NUM ')
    .replace(/\b\d{1,2}\s+or\s+(?:more|fewer|less)\b/gi, ' NUM ')
    .replace(/\b(?:aged?|under|over|about|around|nearly|approximately|somewhere between)\s+\d{1,2}\b/gi, ' NUM ')
    .replace(/\b\d{1,2}\s*(?:percent|per cent|per\b|%|°|a\.m|p\.m|years?|months?|weeks?|days?|hours?|minutes?|seconds?|million|billion|thousand|hundred|metres?|meters?|miles?|kilomet|pounds?|dollars?|cents?|euros?|degrees?|times?|people|students|words|pages|items?|types?|kinds?|ways?|steps?|parts?|cases?|countries|states?|cities|companies|schools?|persons?|km|cm|mm|kg|grams?|tons?|tonnes?|liters?|litres?|barrels?|baskets?|o'clock)\b/gi, ' NUM ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' YEAR ')
    .replace(/\b\d{1,2}\s*(?:st|nd|rd|th)\b/gi, ' NUM ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi, ' DATE ')
    .replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, ' DATE ')
    .replace(/\b(?:CO2|H2O|O2|NO2|SO2|PM2\.5|PM10|3D|2D|4K|5G|4G|MP3|G7|G20|M25|A300|B2B|COVID-19?)\b/gi, ' PROPER ');
}
const WORD_TOKEN_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*|\d{1,2}/g;

function clozeNumberRisks(text) {
  const stripped = stripLegitNumbers(text);
  const parts = stripped.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d{1,2}(?!\d)|[^\s]/g) || [];
  const hits = [];
  for (let i = 0; i < parts.length; i++) {
    if (!/^\d{1,2}$/.test(parts[i])) continue;
    const n = Number(parts[i]);
    if (n < 1 || n > 99) continue;
    const prev = (parts[i - 1] || '').toLowerCase();
    const next = (parts[i + 1] || '').toLowerCase();
    if (prev && NUMBERED_NOUNS.has(prev)) continue;
    const prevFunc = FUNC_SET.has(prev);
    const nextFunc = FUNC_SET.has(next);
    if (prevFunc && nextFunc) {
      if (CLOZE_PREV_SET.has(prev) && !CLOZE_NEXT_LEGIT.has(next)) { hits.push('题号填空残留'); break; }
    } else if (!prevFunc && nextFunc) {
      if (!CLOZE_NEXT_LEGIT.has(next) && /^[a-z]{3,}$/.test(prev)) { hits.push('题号填空残留'); break; }
    }
  }
  return hits;
}

/**
 * 返回机械污染风险类别数组；空数组表示未命中。warning 级，不参与硬失败。
 * 只覆盖可机器判定的残留形状，语义/风格问题仍由人工台账处理。
 */
export function mechanicalExampleRisks(example) {
  const text = normalized(example);
  if (!text) return [];
  const risks = [];
  if (QUESTION_STEM_RE.test(text)) risks.push('阅读理解题干残留');
  if (QUESTION_SECTION_RE.test(text)) risks.push('篇章标题/听力题干残留');
  if (OPTION_RESIDUE_RE.test(text)) risks.push('选项文本残留');
  if (!risks.includes('题号填空残留')) risks.push(...clozeNumberRisks(text));
  if (JUNK_SYMBOL_RE.test(text) || WRONG_WORD_PERIOD_RE.test(text)) risks.push('标点/乱码碎片');
  if (hasUnclosedParen(text)) risks.push('括号不闭合/截断');
  if (hasParenJunk(text)) risks.push('括号乱码');
  if (OPTION_EO_RE.test(text) || NUMBERED_OPTION_RE.test(text) || LETTER_OPTION_RE.test(text)) risks.push('选项/题号残片');
  if (hasStrayCloseParen(text)) risks.push('括号不闭合/截断');
  if (hasWeirdChars(text)) risks.push('怪字符/OCR怪字');
  if (OCR_WORD_RE.test(text) || OCR_WORD_EXTRA_RE.test(text)) risks.push('疑似OCR错字/缺空格');
  else {
    const glue = (text.match(/\b[a-z]{2,}\d{1,2}\b|\b\d{1,2}(?:rom|toy|in|of|y)\b/gi) || []).filter(t => !OCR_GLUE_WHITELIST.test(t));
    if (glue.length) risks.push('疑似OCR错字/缺空格');
  }
  if (!/[.!?]["']?$/.test(text) && TRAILING_NO_PUNCT_RE.test(text) && text.split(/\s+/).length >= 4) risks.push('句末无标点/截断');
  return [...new Set(risks)];
}
