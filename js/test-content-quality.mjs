/** 本轮内容硬门控、合法词形与进度主键回归；Node 运行，不启动浏览器。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contentEncodingFields, isConfirmedBadExample, exampleHasWordForm, mechanicalExampleRisks, confirmedCorrectionIssues } from './content-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/content-fixes-20261023.json'));
const nextFixture = JSON.parse(read('tests/fixtures/content-fixes-batch2-20261023.json'));
const thirdFixture = JSON.parse(read('tests/fixtures/content-fixes-batch3-20261023.json'));
const maintenanceFixture = JSON.parse(read('tests/fixtures/content-fixes-maintenance-20261023.json'));
const box = vm.createContext({ window: {} });
const dataFiles = ['js/words-data.js', 'js/cet-words-data.js', 'js/combined-words-data.js'];
dataFiles.forEach(file => vm.runInContext(read(file), box, { filename: file }));
const defs = { kaoyan: 'WORDS_RAW', cet4: 'WORDS_CET4', cet6: 'WORDS_CET6', combined: 'WORDS_COMBINED' };
const books = Object.fromEntries(Object.entries(defs).map(([book, key]) => [book, box.window[key]]));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS  ' + name); }

check('四书长度、词头顺序、r/f/c/ky、数据版本及逐词已核对的主词性更正保持', () => {
  for (const [book, rows] of Object.entries(books)) {
    const expected = fixture.baseline[book];
    assert.equal(rows.length, expected.count, book);
    assert.equal(box.window.WORD_BOOK_META[book].dataVersion, expected.dataVersion, book);
    assert.equal(hash(rows.map(row => [row[0], row[4], row[5], row[6], row[9]])), expected.indexHash, book + ' 进度主键/频次');
    assert.equal(hash(rows.map(row => [row[0], row[3], row[4], row[5], row[6], row[9]])), expected.posIndexHash, book + ' 主词性');
    assert.equal(rows.every(row => row.length === 11), true);
  }
});
check('四书所有字符串字段均无不可交付编码，已确认污染句不能回流', () => {
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    assert.equal(contentEncodingFields(row).length, 0, book + '#' + index + ' ' + row[0]);
    assert.equal(isConfirmedBadExample(row[7]), false, book + '#' + index + ' ' + row[0]);
  }
});
check('本批全部源书例句引用含目标词头/明确词形且来源如实', () => {
  assert.equal(fixture.repairedExamples.length, 153);
  for (const reference of fixture.repairedExamples) {
    const row = books[reference.book][reference.index];
    assert.equal(row[0], reference.word);
    assert.equal(row[8], reference.source, reference.book + ' ' + reference.word);
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, reference.book + ' ' + reference.word);
    assert.match(row[7], /[.!?]["']?$/);
  }
});
check('20 个缺项词头在相关四书均只保留一个有证据的主读音', () => {
  assert.equal(Object.keys(fixture.phonetics).length, 20);
  for (const [word, phonetic] of Object.entries(fixture.phonetics)) for (const [book, rows] of Object.entries(books)) {
    const row = rows.find(row => row[0] === word);
    if (!row) continue;
    assert.equal(row[1], phonetic, book + ' ' + word);
    assert.doesNotMatch(row[1], /[\s/]/);
  }
});
check('第二批20高优先缺音标跨书补齐，动词download只用动词主读音', () => {
  assert.equal(Object.keys(nextFixture.phonetics).length, 20);
  for (const [word, evidence] of Object.entries(nextFixture.phonetics)) {
    assert.match(evidence.url, /^https:\/\/www\.oxfordlearnersdictionaries\.com\/definition\/english\//);
    for (const [book, rows] of Object.entries(books)) {
      const row = rows.find(row => row[0] === word);
      if (row) assert.equal(row[1], evidence.phonetic, book + ' ' + word);
    }
  }
  assert.equal(books.kaoyan.find(row => row[0] === 'download')[1], 'ˌdaʊnˈləʊd');
});
check('第二批re/microelectronic/integrated及有证据名词的词性/词形精确修订', () => {
  for (const [word, expected] of Object.entries(nextFixture.semanticCorrections)) for (const [book, rows] of Object.entries(books)) {
    const row = rows.find(row => row[0] === word);
    if (!row) continue;
    for (const [field, value] of Object.entries(expected)) assert.equal(row[Number(field)], value, book + ' ' + word + ' 字段' + field);
  }
});
check('第二批45已确认坏句族全部引用修复、来源自编且目标词形命中', () => {
  assert.equal(nextFixture.confirmedBadExamples.length, 45);
  assert.equal(nextFixture.repairedExamples.length, 101);
  for (const reference of nextFixture.repairedExamples) {
    const row = books[reference.book][reference.index];
    assert.equal(row[0], reference.word);
    assert.equal(row[8], '自编', reference.book + ' ' + reference.word);
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, reference.book + ' ' + reference.word);
    assert.match(row[7], /[.!?]["']?$/);
  }
});
check('motif/odd/pediatric只修目标词关联；合法共享原句及独立词形门控保持', () => {
  assert.equal(nextFixture.targetedAssociations.length, 3);
  assert.equal(nextFixture.targetedAssociations.reduce((n, item) => n + item.references.length, 0), 5);
  for (const item of nextFixture.targetedAssociations) {
    assert.equal(isConfirmedBadExample(item.oldExample), false, '完整合法原句不能整句封禁 ' + item.word);
    for (const reference of item.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], item.word);
      assert.equal(row[7], item.newExample);
      assert.equal(row[8], '自编');
      assert.equal(exampleHasWordForm(row[0], item.oldExample, row[10]), false, item.word + ' 不等同另一独立词');
      assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, item.word);
    }
    for (const reference of item.unchangedOriginalReferences) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], reference.word);
      assert.equal(row[7], reference.example, '合法引用不连带替换 ' + reference.word);
      assert.equal(row[8], reference.source);
    }
  }
});
check('graffiti保持主名词与明确词形边界；目标例句使用名词且共享原句保持', () => {
  const item = nextFixture.graffitiNounExample;
  assert.equal(item.references.length, 2);
  for (const { book, index } of item.references) {
    const row = books[book][index];
    assert.equal(row[0], 'graffiti');
    assert.equal(row[3], 0);
    assert.equal(row[7], item.newExample);
    assert.equal(row[8], '自编');
    assert.equal(row[10], '', '没有词典屈折证据时不猜补fm');
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true);
  }
  assert.equal(isConfirmedBadExample(item.oldExample), false, '旧句完整，不作为全局污染句封禁');
  for (const reference of item.unchangedOriginalReferences) {
    const row = books[reference.book][reference.index];
    assert.equal(row[0], reference.word);
    assert.equal(row[7], reference.example);
    assert.equal(row[8], reference.source);
  }
});
check('tum 保留词头、真实名词义与自编例句；modem 保留调制解调器义；questions 保留', () => {
  for (const book of ['cet4', 'cet6', 'combined']) {
    const tum = books[book].find(row => row[0] === 'tum');
    assert.ok(tum); assert.equal(tum[3], 0); assert.match(tum[2], /肚子.*胃/); assert.equal(tum[8], '自编');
    const modem = books[book].find(row => row[0] === 'modem');
    assert.ok(modem); assert.match(modem[2], /调制解调器/);
  }
  assert.ok(books.cet6.some(row => row[0] === 'questions'));
});
check('M03–M06四词八引用按逐字段证据修补，其余字段保持', () => {
  assert.equal(maintenanceFixture.corrections.length, 4);
  assert.deepEqual(maintenanceFixture.corrections.map(item => item.id), ['M03', 'M04', 'M05', 'M06']);
  const mismatches = [];
  for (const item of maintenanceFixture.corrections) {
    assert.equal(item.references.length, 2, item.id);
    assert.ok(item.evidence.every(url => /^https:\/\/www\.oxfordlearnersdictionaries\.com\/definition\/english\//.test(url)));
    for (const reference of item.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], item.word, item.id + ' 词头/索引不变');
      const expected = reference.originalRow.slice();
      for (const [field, value] of Object.entries(item.after)) expected[Number(field)] = value;
      if (JSON.stringify(row) !== JSON.stringify(expected)) mismatches.push(item.id + ' ' + reference.book + '#' + reference.index + ' ' + item.word);
    }
  }
  assert.deepEqual(mismatches, [], '已确认四词修补尚未落地或存在超范围字段变更');
});
check('M03 resit保持真实词头、动词主读音和明确屈折，不接收旧错误词形', () => {
  const item = maintenanceFixture.corrections.find(item => item.id === 'M03');
  for (const reference of item.references) {
    const row = books[reference.book][reference.index];
    assert.equal(row[1], 'ˌriːˈsɪt'); assert.doesNotMatch(row[1], /[\s/]/);
    assert.match(row[10], /第三人称单数 resits/); assert.doesNotMatch(row[10], /resiting|resited|复数/);
    for (const form of ['resits', 'resitting', 'resat']) assert.equal(exampleHasWordForm(row[0], 'She is ' + form + ' the exam.', row[10]), true, form);
    for (const form of ['resiting', 'resited', 'resist', 'resisting']) assert.equal(exampleHasWordForm(row[0], 'She is ' + form + ' the exam.', row[10]), false, form);
  }
});
check('M04 shifty eyes覆盖躲闪/显得不诚实语境，已有义与自编例句保留', () => {
  const item = maintenanceFixture.corrections.find(item => item.id === 'M04');
  for (const reference of item.references) {
    const row = books[reference.book][reference.index];
    assert.match(row[2], /躲闪/); assert.match(row[2], /不诚实/); assert.match(row[2], /变化/);
    assert.match(row[7], /shifty eyes/); assert.equal(row[7], reference.originalRow[7]); assert.equal(row[8], '自编');
  }
});
check('M05/M06目标例句与词义词形一致，自编来源准确，旧完整句不作全局封禁', () => {
  for (const item of maintenanceFixture.corrections.filter(item => ['M05', 'M06'].includes(item.id))) {
    assert.equal(isConfirmedBadExample(item.before['7']), false, item.word + ' 只拒绝目标词错配');
    for (const reference of item.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[7], item.after['7']); assert.equal(row[8], '自编');
      assert.equal(exampleHasWordForm(item.word, item.before['7'], row[10]), false, item.word + ' 旧句不是本词词形');
      assert.equal(exampleHasWordForm(item.word, row[7], row[10]), true, item.word + ' 新句含目标词形');
      assert.deepEqual(mechanicalExampleRisks(row[7]), []);
      if (item.id === 'M06') { assert.equal(row[3], 0); assert.match(row[2], /枪战/); assert.match(row[7], /soldiers.*firefight/); }
    }
  }
});
check('M06只修firefight关联，firefighting与完整旧句其他六引用逐字段不变', () => {
  assert.equal(maintenanceFixture.protectedReferences.length, 6);
  assert.equal(maintenanceFixture.protectedReferences.filter(reference => reference.row[0] === 'firefighting').length, 2);
  for (const reference of maintenanceFixture.protectedReferences) {
    const row = books[reference.book][reference.index];
    assert.equal(JSON.stringify(row), JSON.stringify(reference.row), reference.book + '#' + reference.index + ' ' + row[0]);
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, row[0]);
    assert.deepEqual(confirmedCorrectionIssues(reference.book, row), [], row[0] + ' 合法共享原句不误伤');
  }
});
check('维护窄门控逐字段拒绝旧值回流，合法新值/旧来源/其他词头和其他词书不误伤', () => {
  for (const item of maintenanceFixture.corrections) for (const reference of item.references) {
    const corrected = reference.originalRow.slice();
    for (const [field, value] of Object.entries(item.after)) corrected[Number(field)] = value;
    assert.deepEqual(confirmedCorrectionIssues(reference.book, corrected), [], item.id + ' 修后行应允许');
    for (const field of Object.keys(item.after).filter(field => field !== '8')) {
      const reverted = corrected.slice(); reverted[Number(field)] = item.before[field];
      assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' 字段' + field + ' 旧值应拒绝');
      const otherHead = reverted.slice(); otherHead[0] = 'unrelated';
      assert.deepEqual(confirmedCorrectionIssues(reference.book, otherHead), [], item.id + ' 其他词头不套此规则');
      const otherBook = Object.keys(books).find(book => !item.references.some(ref => ref.book === book));
      assert.deepEqual(confirmedCorrectionIssues(otherBook, reverted), [], item.id + ' 非指定词书不套此规则');
      if (field === '7') {
        reverted[7] = '  ' + item.before['7'].replace(/\s/g, '  ') + '\n';
        assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' 旧句多空白仍拒绝');
      }
    }
    if (Object.hasOwn(item.before, '8')) {
      const futureExam = corrected.slice(); futureExam[8] = item.before['8'];
      assert.deepEqual(confirmedCorrectionIssues(reference.book, futureExam), [], item.id + ' 不单独封禁旧来源标签');
    }
  }
});
check('维护批次进度主键/统计/版本全不动，主词性仅允许firefight两引用纠正', () => {
  for (const [book, rows] of Object.entries(books)) {
    const baseline = maintenanceFixture.baseline[book];
    assert.equal(rows.length, baseline.count); assert.equal(box.window.WORD_BOOK_META[book].dataVersion, baseline.dataVersion);
    assert.equal(hash(rows.map(row => [row[0], row[4], row[5], row[6], row[9]])), baseline.indexHash, book);
    assert.equal(hash(rows.map(row => [row[0], row[3], row[4], row[5], row[6], row[9]])), baseline.expectedPosIndexHash, book);
    const restored = rows.map(row => [row[0], row[0] === 'firefight' ? 1 : row[3], row[4], row[5], row[6], row[9]]);
    assert.equal(hash(restored), baseline.oldPosIndexHash, book + ' 其余词性不变');
    assert.equal(fixture.baseline[book].posIndexHash, baseline.expectedPosIndexHash, book + ' 既有基线精确更新');
  }
});
check('第三批夹具逐族 id/批次唯一，追加残留句全部可被机械污染 warning 扫描召回', () => {
  const ids = thirdFixture.families.map(family => family.id);
  assert.equal(ids.length, 400);
  assert.equal(new Set(ids).size, 400, '句族 id 必须唯一');
  for (const id of ids) assert.match(id, /^R3-\d+$/, '句族 id 形态：' + id);
  assert.equal(thirdFixture.families.filter(family => family.batch === '独立复审追加').length, 46);
  assert.equal(thirdFixture.families.filter(family => family.batch === '扫描盲区追加').length, 11);
  const residual = thirdFixture.families.filter(family => family.batch !== '首轮');
  assert.equal(residual.length, 57);
  for (const family of residual) assert.ok(mechanicalExampleRisks(family.oldExample).length > 0, '追加残留句 ' + family.id + ' 应可被 warning 扫描召回');
});

check('DEL/C1、替换符与各平面私用区逐字段拒绝；正常 IPA 和重音标记允许', () => {
  for (const char of ['\u007f', '\u0083', '\u009f', '\ufffd', '\ue001', '\u{100073}']) {
    for (const field of [0, 1, 2, 7, 8, 10]) {
      const row = ['word', 'wɜːd', 'n. 单词', 0, 1, 1, 1, 'This is a word.', '自编', 1, '复数 words'];
      row[field] += char; assert.deepEqual(contentEncodingFields(row), [field]);
    }
  }
  assert.equal(contentEncodingFields(['é £ ½ ˈ ˌ ɜː 中文\t\n']).length, 0);
});
check('全部已确认错误样本被识别，正常缩写/引号/自编完整句不会被泛化误伤', () => {
  for (const example of fixture.confirmedBadExamples.concat(nextFixture.confirmedBadExamples, thirdFixture.confirmedBadExamples)) assert.equal(isConfirmedBadExample(example), true);
  assert.equal(isConfirmedBadExample('A study led by Dr. Smith was published today.'), false);
  assert.equal(isConfirmedBadExample('The child rubbed his tum after the meal.'), false);
  assert.equal(isConfirmedBadExample('It is one of the most popular running events in the southeastern U.S.'), false);
  assert.equal(isConfirmedBadExample('The letters range from A to K.'), false);
});
check('真实 led/caught 由各条 fm 接受；相似前缀和未记录派生形不自动通过', () => {
  for (const word of ['lead', 'catch']) {
    const row = books.cet4.find(row => row[0] === word);
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, word);
  }
  assert.equal(exampleHasWordForm('lead', 'The leadership team met today.', '过去式 led'), false);
  assert.equal(exampleHasWordForm('catch', 'The cattle stood in the field.', '过去式 caught'), false);
  assert.equal(exampleHasWordForm('cat', 'The scattered papers were on the desk.'), false);
  assert.equal(exampleHasWordForm('overfish', 'The report discusses overfishing.'), false);
});

check('第三批343个机械污染句族全部源书引用修复、旧句四书0残留且来源策略正确', () => {
  const fixed = thirdFixture.families.filter(family => family.decision === 'fix');
  assert.equal(fixed.length, 343);
  assert.equal(thirdFixture.expected.fixFamilies, 343);
  assert.equal(thirdFixture.expected.references, 513);
  assert.equal(thirdFixture.expected.detach, 128);
  assert.equal(thirdFixture.expected.rewrite, 385);
  const confirmed = new Set(thirdFixture.confirmedBadExamples.map(value => String(value).replace(/\s+/g, ' ').trim()));
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    const example = String(row[7] || '').replace(/\s+/g, ' ').trim();
    assert.equal(confirmed.has(example), false, book + '#' + index + ' ' + row[0] + ' 第三批旧污染句回流');
  }
  let references = 0;
  for (const family of fixed) for (const reference of family.references) {
    references++;
    const row = books[reference.book][reference.index];
    assert.equal(row[0], reference.word, reference.book + '#' + reference.index + ' 词头');
    assert.equal(row[7], reference.newExample, reference.book + '#' + reference.index + ' 新句未落地');
    assert.equal(row[8], reference.newSource, reference.book + '#' + reference.index + ' 来源');
    if (reference.action === 'detach') assert.equal(reference.newSource, reference.oldSource, reference.book + '#' + reference.index + ' detach 保留原来源');
    else { assert.equal(reference.action, 'rewrite'); assert.equal(reference.newSource, '自编'); }
    assert.equal(exampleHasWordForm(row[0], row[7], row[10]), true, reference.book + '#' + reference.index + ' ' + row[0]);
    assert.match(row[7], /[.!?]["']?$/);
  }
  assert.equal(references, 513);
});
check('第三批 keep 句族不作防回归封禁；机械污染 warning 扫描器召回题干类且不误伤新句', () => {
  const kept = thirdFixture.families.filter(family => family.decision === 'keep');
  assert.equal(kept.length, 57);
  assert.equal(kept.length + thirdFixture.families.filter(family => family.decision === 'fix').length, 400);
  for (const family of kept) assert.equal(isConfirmedBadExample(family.oldExample), false, 'keep 句族不得整句封禁：' + family.oldExample.slice(0, 80));
  const fixed = thirdFixture.families.filter(family => family.decision === 'fix');
  const questionStem = fixed.filter(family => family.className === 'question-stem');
  assert.equal(questionStem.length, 31);
  for (const family of questionStem) assert.ok(mechanicalExampleRisks(family.oldExample).length > 0, 'warning 扫描应命中题干残留：' + family.oldExample.slice(0, 80));
  for (const family of fixed) for (const reference of family.references) {
    assert.deepEqual(mechanicalExampleRisks(reference.newExample), [], '新句不应命中机械污染扫描：' + reference.newExample);
  }
  for (const legit of [
    'An adult with a BMI of 18 to 25 is often considered to be normal weight.',
    'He sometimes played two slot machines at a time, all night, until the boat docked at 5 a.m., then went back aboard when the casino opened at 9 a.m.',
    'Most roads, bridges, transit, water systems, the electric grid, and communications networks were installed 50 to 100 years ago, and they are largely taken for granted until they fail.',
    'A study led by Dr. Smith was published today.',
    'She wrote down the events of each day in her diary before bed.'
  ]) assert.deepEqual(mechanicalExampleRisks(legit), [], '合法句/新自编句被误伤：' + legit);
});

// 在隔离目录执行真实校验器，证明门控会使退出码失败，而不只是多打印一条 warning。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-content-gate-'));
try {
  for (const file of [...dataFiles, 'js/content-validation.mjs', 'js/validate-words.mjs', 'js/validate-cet-data.mjs', 'tests/fixtures/content-fixes-20261023.json', 'tests/fixtures/content-fixes-batch2-20261023.json', 'tests/fixtures/content-fixes-batch3-20261023.json', 'tests/fixtures/content-fixes-maintenance-20261023.json']) {
    const target = path.join(tmp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, read(file));
  }
  for (const [validator, file, key] of [['js/validate-words.mjs', 'js/words-data.js', 'kaoyan'], ['js/validate-cet-data.mjs', 'js/cet-words-data.js', 'cet4']]) {
    for (const [label, example, expected] of [['C1', 'An example with \u0083 control.', /字段含控制字符/], ['已确认残句', fixture.confirmedBadExamples[0], /已确认污染例句回流/], ['第二批残句', nextFixture.confirmedBadExamples[0], /已确认污染例句回流/], ['第三批残句', thirdFixture.confirmedBadExamples[0], /已确认污染例句回流/]]) {
      check(validator + ' 对 ' + label + ' 返回失败', () => {
        const row = Array.from(books[key][0]), original = JSON.stringify(row);
        row[7] = example;
        const source = read(file); assert.equal(source.includes(original), true);
        fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(row)));
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], { cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.status, 1, label + ' 应拒绝');
        assert.match(result.stdout + result.stderr, expected);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
    const sourceBooks = key === 'kaoyan' ? ['kaoyan'] : ['cet4', 'cet6'];
    for (const item of maintenanceFixture.corrections) {
      const reference = item.references.find(reference => sourceBooks.includes(reference.book));
      if (!reference) continue;
      for (const field of Object.keys(item.after).filter(field => field !== '8')) {
        check(validator + ' 对 ' + item.id + ' ' + item.word + ' 字段' + field + ' 回流返回失败', () => {
          const row = Array.from(books[reference.book][reference.index]), original = JSON.stringify(row);
          row[Number(field)] = item.before[field];
          const source = read(file); assert.equal(source.includes(original), true, item.word + ' 正式源中存在修后行');
          fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(row)));
          const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
          assert.equal(result.status, 1, item.id + ' 字段' + field + ' 应拒绝');
          assert.match(result.stdout + result.stderr, /已确认内容修订回流/);
          fs.writeFileSync(path.join(tmp, file), source);
        });
      }
    }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n内容质量回归：${passed} 组通过 / 0 失败`);
