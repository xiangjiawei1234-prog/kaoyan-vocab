/** 本轮内容硬门控、合法词形与进度主键回归；Node 运行，不启动浏览器。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contentEncodingFields, isConfirmedBadExample, exampleHasWordForm, exampleHasInflectedForm, mechanicalExampleRisks, confirmedCorrectionIssues, isRemovedHeadword, removedHeadwordIssues, meaningContentIssues } from './content-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/content-fixes-20261023.json'));
const nextFixture = JSON.parse(read('tests/fixtures/content-fixes-batch2-20261023.json'));
const thirdFixture = JSON.parse(read('tests/fixtures/content-fixes-batch3-20261023.json'));
const maintenanceFixture = JSON.parse(read('tests/fixtures/content-fixes-maintenance-20261023.json'));
const meaningFixture = JSON.parse(read('tests/fixtures/content-fixes-meaning-20261024.json'));
const variantFixture = JSON.parse(read('tests/fixtures/content-fixes-meaning-20261025.json'));
const phoneticFixture = JSON.parse(read('tests/fixtures/content-fixes-phonetic-20261025.json'));
const normalizeFixture = JSON.parse(read('tests/fixtures/content-fixes-phonetic-normalize-20261025.json'));
const formsFixture = JSON.parse(read('tests/fixtures/content-fixes-forms-20261025.json'));
const pronunciationFixture = JSON.parse(read('tests/fixtures/content-fixes-pronunciation-20261027.json'));
const pronunciationMain = new Map(pronunciationFixture.corrections.flatMap(item => item.references.map(ref => [ref.book + ':' + item.word, item.after['1']])));
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
check('释义错配修复：37 词四书行与修复快照一致，进度主键/统计/主词性不变且旧值回流被门控', () => {
  for (const [book, rows] of Object.entries(books)) {
    const baseline = meaningFixture.baseline[book];
    assert.equal(rows.length, baseline.count, book);
    assert.equal(box.window.WORD_BOOK_META[book].dataVersion, baseline.dataVersion, book);
    assert.equal(hash(rows.map(row => [row[0], row[4], row[5], row[6], row[9]])), baseline.indexHash, book + ' 进度主键');
    assert.equal(hash(rows.map(row => [row[0], row[3], row[4], row[5], row[6], row[9]])), baseline.posIndexHash, book + ' 主词性');
  }
  assert.equal(meaningFixture.corrections.length, 37);
  for (const item of meaningFixture.corrections) {
    assert.notEqual(item.before['2'], item.after['2'], item.id + ' 释义必须有变化');
    for (const reference of item.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], item.word, item.id + ' ' + reference.book + ' 词头');
      const corrected = reference.originalRow.slice();
      for (const [field, value] of Object.entries(item.after)) corrected[Number(field)] = value;
      assert.equal(JSON.stringify(row), JSON.stringify(corrected), item.id + ' ' + item.word + ' ' + reference.book + ' 修后行');
      assert.deepEqual(confirmedCorrectionIssues(reference.book, row), [], item.id + ' 修后行应允许');
      for (const [field, before] of Object.entries(item.before)) {
        const reverted = corrected.slice(); reverted[Number(field)] = before;
        assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' ' + item.word + ' 字段' + field + ' 旧值应拒绝');
        const otherHead = reverted.slice(); otherHead[0] = 'unrelated';
        assert.deepEqual(confirmedCorrectionIssues(reference.book, otherHead), [], item.id + ' 其他词头不套此规则');
      }
      if (item.after['7']) {
        assert.equal(row[7], item.after['7'], item.id + ' 新例句');
        assert.equal(row[8], '自编', item.id + ' 改写句保留自编来源');
        assert.equal(exampleHasWordForm(item.word, row[7], row[10]), true, item.id + ' 新例句含目标词形');
      }
    }
    for (const book of ['cet4', 'cet6', 'combined']) {
      const hit = books[book].find(row => row[0] === item.word);
      if (hit) assert.notEqual(hit[2], item.before['2'], item.word + ' 旧释义残留 @' + book);
    }
  }
});
check('释义修复不改动词条顺序与历史基线；relection 走删除迁移而非改义', () => {
  for (const [book, rows] of Object.entries(books)) {
    assert.equal(meaningFixture.baseline[book].indexHash, fixture.baseline[book].indexHash, book + ' 索引基线沿用');
    assert.equal(meaningFixture.baseline[book].posIndexHash, fixture.baseline[book].posIndexHash, book + ' 词性基线沿用');
  }
  assert.equal(meaningFixture.corrections.find(item => item.word === 'relection'), undefined, 'relection 走删除迁移，不得混入释义修正');
  for (const [book, rows] of Object.entries(books)) {
    assert.equal(rows.some(row => row[0] === 'relection'), false, book + ' OCR 假词条已删除');
    const reflection = rows.find(row => row[0] === 'reflection');
    assert.ok(reflection, book + ' reflection 必须存在');
    assert.equal(reflection[2], 'n. 反思, 沉思, 反映, 映像', book + ' reflection 释义保持');
  }
  const cet4Meta = box.window.WORD_BOOK_META.cet4;
  const combinedMeta = box.window.WORD_BOOK_META.combined;
  assert.equal(cet4Meta.dataVersion, meaningFixture.baseline.cet4.dataVersion, 'cet4 数据版本');
  assert.equal(combinedMeta.dataVersion, meaningFixture.baseline.combined.dataVersion, '综合书数据版本');
  const cet4Migration = cet4Meta.migrations.find(m => m.from === meaningFixture.migrations.cet4.from);
  const combinedMigration = combinedMeta.migrations.find(m => m.from === meaningFixture.migrations.combined.from);
  assert.deepEqual(Array.from(cet4Migration.removed), meaningFixture.migrations.cet4.removed, 'cet4 删除下标');
  assert.deepEqual(Array.from(cet4Migration.removedWords), meaningFixture.migrations.cet4.removedWords, 'cet4 删除词名');
  assert.equal(cet4Migration.previousWordCount, meaningFixture.migrations.cet4.previousWordCount, 'cet4 迁移前词数');
  assert.deepEqual(Array.from(combinedMigration.removed), meaningFixture.migrations.combined.removed, '综合书删除下标');
  assert.deepEqual(Array.from(combinedMigration.removedWords), meaningFixture.migrations.combined.removedWords, '综合书删除词名');
  assert.equal(combinedMigration.previousWordCount, meaningFixture.migrations.combined.previousWordCount, '综合书迁移前词数');
  for (const item of meaningFixture.removedHeadwords) {
    const fakeRow = ['relection', '', 'n. 选择', 0, 6606, 1, 1, 'Most of them require critical thinking and relection.', '四级 2021.12', 0, ''];
    assert.deepEqual(removedHeadwordIssues(item.book, fakeRow), ['已删除词头回流：relection（2026-10-24 迁移删除）'], item.book + ' 删除词头门控');
    assert.deepEqual(removedHeadwordIssues(item.book, books[item.book][0]), [], item.book + ' 其他词头不误伤');
    assert.equal(isRemovedHeadword(item.book, 'relection'), true, item.book + ' isRemovedHeadword');
  }
});
check('释义交叉引用/变形说明修复：19 词落地，旧值回流被拒绝，规则门控可召回且不误伤', () => {
  assert.equal(variantFixture.corrections.length, 19);
  for (const item of variantFixture.corrections) {
    for (const reference of item.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], item.word, item.id + ' ' + reference.book + ' 词头');
      const corrected = reference.originalRow.slice();
      for (const [field, value] of Object.entries(item.after)) corrected[Number(field)] = value;
      assert.equal(JSON.stringify(row), JSON.stringify(corrected), item.id + ' ' + item.word + ' ' + reference.book + ' 修后行');
      assert.deepEqual(confirmedCorrectionIssues(reference.book, row), [], item.id + ' 修后行应允许');
      for (const [field, before] of Object.entries(item.before)) {
        const reverted = corrected.slice(); reverted[Number(field)] = before;
        assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' ' + item.word + ' 字段' + field + ' 旧值应拒绝');
      }
    }
  }
  const badSamples = ['v. <主英>=rationalize', 'a. organise的变形', 'n. <美>=cancellation', 'a. & n.<口>=postdoctoral', 'adv. oversleep的过去式和过去分词', 'n. 生态旅游 (ecotourism的变形)', 'a. prove的过去分词', 'n. = rationalize'];
  for (const bad of badSamples) assert.ok(meaningContentIssues(bad).length > 0, '规则门控应召回：' + bad);
  const goodSamples = ['n. 广告（advertisement 的缩写）', 'n. (=barbecue)烤肉野餐, 烤肉架；v. 烤肉', 'pl. 牙齿（tooth 的复数）', 'n. 月', 'n. 博士后（postdoctoral 的缩写）', 'v. 睡过头（oversleep 的过去式和过去分词）', 'a. 更安静的（quiet 的比较级）', 'n. 代表（representative 缩写）, 名声（俚）'];
  for (const good of goodSamples) assert.deepEqual(meaningContentIssues(good), [], '规则门控不应误伤：' + good);
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    assert.deepEqual(meaningContentIssues(row[2]), [], book + '#' + index + ' ' + row[0] + ' 当前释义规则');
  }
});
check('音标空缺已全量补齐：792 词头/1077 行落地，旧空音标回流被拒绝，四书无缺失', () => {
  assert.equal(phoneticFixture.corrections.length, 792);
  assert.deepEqual(phoneticFixture.missingAfter, []);
  assert.deepEqual(phoneticFixture.sourceStats, {"youdao.us": 42, "youdao.uk": 606, "youdao.collins": 19, manual: 125});
  const reg = /^[ ()\-.;a-zæðŋɑɒɔəɛɜɝɡɪʃʊʌʒθˈˌː]*$/i;
  const vowel = /[aeiouyæɑɒɔəɛɜɪʊʌ]/i;
  // 批次 A 已把其中 22 个多读音/跨书矛盾词规范为单一主读音；空音标回流仍由本夹具门控。
  const normalizedLater = new Set(normalizeFixture.corrections.map(item => item.word));
  for (const item of phoneticFixture.corrections) {
    assert.equal(item.before['1'], '', item.id + ' 原值为空');
    assert.ok(reg.test(item.after['1']) && vowel.test(item.after['1']) && item.after['1'].length <= 45, item.id + ' 音标格式 ' + item.after['1']);
    for (const reference of item.references) {
      const row = books[reference.book].find(row => row[0] === item.word);
      assert.ok(row, item.id + ' ' + reference.book + ' 行存在');
      if (normalizedLater.has(item.word)) assert.ok(String(row[1] || '').trim(), item.id + ' ' + item.word + ' 规范化后仍须非空');
      else assert.equal(row[1], pronunciationMain.get(reference.book + ':' + item.word) || item.after['1'], item.id + ' ' + item.word + ' ' + reference.book + ' 音标');
      assert.deepEqual(confirmedCorrectionIssues(reference.book, row), [], item.id + ' 修后行应允许');
      const reverted = row.slice(); reverted[1] = '';
      assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' 空音标旧值应拒绝');
    }
  }
  for (const [book, rows] of Object.entries(books)) {
    assert.equal(rows.filter(row => !String(row[1] || '').trim()).length, 0, book + ' 不得再有缺音标');
  }
  for (const item of phoneticFixture.corrections) {
    const row = books.combined.find(row => row[0] === item.word);
    if (row) assert.ok(String(row[1] || '').trim(), '综合书 ' + item.word + ' 音标同步');
  }
});
check('批次 A 音标规范化：1,191 词头/2,217 行落地，单主读音且旧畸形值不能静默回流', () => {
  assert.equal(normalizeFixture.corrections.length, 2217);
  assert.equal(new Set(normalizeFixture.corrections.map(item => item.word)).size, 1191);
  const clean = /^[()\-a-zæðŋɑɒɔəɛɜɝɡɪʃʊʌʒθˈˌː]+$/i;
  const vowel = /[aeiouyæɑɒɔəɛɜɪʊʌ]/i;
  for (const item of normalizeFixture.corrections) {
    assert.deepEqual(Object.keys(item.after), ['1'], item.id);
    assert.ok(clean.test(item.after['1']) && vowel.test(item.after['1']) && item.after['1'].length <= 45, item.id + ' 音标格式 ' + item.after['1']);
    for (const reference of item.references) {
      const row = books[reference.book].find(row => row[0] === item.word);
      assert.ok(row, item.id + ' ' + reference.book + ' 行存在');
      assert.equal(row[1], pronunciationMain.get(reference.book + ':' + item.word) || item.after['1'], item.id + ' ' + item.word + ' ' + reference.book + ' 音标');
      assert.deepEqual(confirmedCorrectionIssues(reference.book, row), [], item.id + ' 修后行应允许');
      const reverted = row.slice(); reverted[1] = item.before['1'];
      const gated = confirmedCorrectionIssues(reference.book, reverted).length > 0;
      const malformed = !clean.test(item.before['1']);
      assert.ok(gated || malformed || item.action === 'cross-book-dict', item.id + ' 旧值回流必须被门控或格式拒绝：' + item.before['1']);
    }
  }
});
check('四书音标格式有效；有证据的异读按各书主词性，其他同词与综合书逐字节一致', () => {
  const legacy = /[\u02b9\u03b5\u02ca\u02cb\u025a\u0279]/;
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    assert.doesNotMatch(row[1], /^\s*\./, book + '#' + index + ' ' + row[0] + ' 前导点');
    assert.doesNotMatch(row[1], /[;；]|\.\s/, book + '#' + index + ' ' + row[0] + ' 多读音分隔');
    assert.doesNotMatch(row[1], /\s/, book + '#' + index + ' ' + row[0] + ' 空白');
    assert.doesNotMatch(row[1], /-$/, book + '#' + index + ' ' + row[0] + ' 悬空连字符');
    assert.doesNotMatch(row[1], legacy, book + '#' + index + ' ' + row[0] + ' 非标准符号');
  }
  const byWord = new Map();
  for (const book of ['kaoyan', 'cet4', 'cet6']) for (const row of books[book]) {
    if (!byWord.has(row[0])) byWord.set(row[0], new Map());
    byWord.get(row[0]).set(book, row[1]);
  }
  for (const [word, map] of byWord) {
    const exception = pronunciationFixture.crossBookMainDifferences.find(item => item.word === word);
    if (exception) {
      for (const [book, ipa] of map) {
        const expected = exception.books.find(item => item.book === book);
        assert.ok(expected, book + ' ' + word + ' 白名单必须逐书列明');
        assert.equal(books[book].find(row => row[0] === word)[3], expected.posIdx, book + ' ' + word + ' 白名单主词性');
        assert.equal(ipa, expected.ipa, book + ' ' + word + ' 白名单主读音');
      }
    } else if (map.size > 1) assert.equal(new Set(map.values()).size, 1, word + ' 跨书音标不一致：' + [...map.entries()].join(' | '));
  }
  for (const row of books.combined) {
    const source = byWord.get(row[0]);
    if (source) assert.equal(row[1], [...source.values()][0], row[0] + ' 综合书音标未同步');
  }
  for (const word of ['healthcare', 'parenting', 'childcare', 'cosmos', 'carer', 'hardworking', 'will', 'may', 'own', 'politics']) {
    const values = new Set(['kaoyan', 'cet4', 'cet6'].map(book => books[book].find(row => row[0] === word)?.[1]).filter(Boolean));
    assert.equal(values.size, 1, word + ' 跨书音标矛盾未统一');
  }
});
check('批次 C1 逐书主音标与证据一致，旧错配值回流被门控且进度主键保持', () => {
  assert.equal(pronunciationFixture.variants.length, 29);
  assert.equal(pronunciationFixture.corrections.length, 93);
  assert.equal(pronunciationFixture.crossBookMainDifferences.length, 8);
  for (const [book, rows] of Object.entries(books)) {
    const baseline = pronunciationFixture.baseline[book];
    assert.equal(rows.length, baseline.count, book);
    assert.equal(box.window.WORD_BOOK_META[book].dataVersion, baseline.dataVersion, book);
    assert.equal(hash(rows.map(row => [row[0], row[3], row[4], row[5], row[6], row[9]])), baseline.posIndexHash, book + ' 主键和主词性');
  }
  for (const correction of pronunciationFixture.corrections) {
    assert.deepEqual(Object.keys(correction.after), ['1']);
    assert.ok(correction.sources.every(source => /^https:\/\//.test(source.url)));
    for (const reference of correction.references) {
      const row = books[reference.book][reference.index];
      assert.equal(row[0], correction.word);
      assert.equal(row[3], reference.posIdx);
      assert.equal(row[1], correction.after['1'], correction.id + ' ' + reference.book);
      assert.deepEqual(confirmedCorrectionIssues(reference.book, row), []);
      const reverted = row.slice(); reverted[1] = correction.before['1'];
      assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, correction.id + ' 旧错配主读音');
    }
  }
});
check('批次 B 词形说明：82 词头/135 行落地，复数畸形清零、跨书一致、旧值回流被拒绝', () => {
  assert.equal(formsFixture.corrections.length, 135);
  assert.equal(new Set(formsFixture.corrections.map(item => item.word)).size, 82);
  const fmPart = /^(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)\s+[a-z]+(?:\/[a-z]+)*$/;
  for (const item of formsFixture.corrections) {
    assert.deepEqual(Object.keys(item.after), ['10'], item.id);
    for (const reference of item.references) {
      const row = books[reference.book].find(row => row[0] === item.word);
      assert.ok(row, item.id + ' ' + reference.book + ' 行存在');
      assert.equal(row[10], item.after['10'], item.id + ' ' + item.word + ' ' + reference.book + ' 词形');
      const reverted = row.slice(); reverted[10] = item.before['10'];
      assert.ok(confirmedCorrectionIssues(reference.book, reverted).length > 0, item.id + ' 旧词形应拒绝');
    }
  }
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    const fm = String(row[10] || '');
    if (!fm || row[0] === 'lie') continue;
    for (const part of fm.split(/[；;]/).map(x => x.trim()).filter(Boolean)) assert.match(part, fmPart, book + '#' + index + ' ' + row[0] + ' 不可解析：' + part);
    for (const match of fm.matchAll(/复数\s+([a-z]+)/g)) {
      if (/(ss|zz|xx)$/.test(match[1]) && !/(ss|zz|xx)$/.test(row[0])) assert.fail(book + '#' + index + ' ' + row[0] + ' 复数畸形：' + match[1]);
    }
  }
  const byWord = new Map();
  for (const book of ['kaoyan', 'cet4', 'cet6']) for (const row of books[book]) {
    if (!byWord.has(row[0])) byWord.set(row[0], new Map());
    byWord.get(row[0]).set(book, row[10]);
  }
  for (const [word, map] of byWord) if (map.size > 1) assert.equal(new Set(map.values()).size, 1, word + ' 跨书词形不一致：' + [...map.entries()].join(' | '));
  for (const row of books.combined) {
    const source = byWord.get(row[0]);
    if (source) assert.equal(row[10], [...source.values()][0], row[0] + ' 综合书词形未同步');
  }
  const expect = {
    campus: '复数 campuses', politics: '', alumnus: '复数 alumni', calculus: '复数 calculi',
    coronavirus: '复数 coronaviruses', lotus: '复数 lotuses', cosmos: '复数 cosmoses',
    bite: null, strike: null, medium: null, daydream: null,
  };
  for (const [word, fm] of Object.entries(expect)) {
    const row = books.kaoyan.find(row => row[0] === word) || books.cet6.find(row => row[0] === word);
    assert.ok(row, word + ' 词条存在');
    if (fm !== null) assert.equal(row[10], fm, word);
  }
  assert.match(books.kaoyan.find(row => row[0] === 'bite')[10], /过去分词 bitten/);
  assert.match(books.kaoyan.find(row => row[0] === 'strike')[10], /现在分词 striking/);
  assert.match(books.kaoyan.find(row => row[0] === 'medium')[10], /media/);
  assert.doesNotMatch(books.cet6.find(row => row[0] === 'daydream')[10], /'/);
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

check('例句覆盖复用页面不规则/规则屈折，四书全部命中且不放宽历史精确证据', () => {
  for (const [book, rows] of Object.entries(books)) for (const [index, row] of rows.entries()) {
    assert.equal(exampleHasInflectedForm(row[0], row[7], row[10], row[3]), true, book + '#' + index + ' ' + row[0]);
  }
  for (const [word, form, pos] of [['medium', 'media', 0], ['swim', 'swam', 1], ['contextualize', 'contextualizing', 1], ['downsize', 'downsizing', 1], ['study', 'studies', 1], ['stop', 'stopping', 1]]) {
    assert.equal(exampleHasInflectedForm(word, 'They discuss ' + form + ' today.', '', pos), true, word + ' → ' + form);
    assert.equal(exampleHasWordForm(word, 'They discuss ' + form + ' today.'), false, '已确认修订仍需精确词形证据');
  }
});
check('例句覆盖保留整词、独立派生词与star/stare碰撞边界', () => {
  for (const [word, example, pos] of [['lead', 'The leadership team met today.', 1], ['catch', 'The cattle stood in the field.', 1], ['cat', 'The scattered papers were on the desk.', 0], ['star', 'She stared into the sky.', 1], ['motif', 'Their motives remain unclear today.', 0], ['paper', 'They read a newspaper today.', 0]]) {
    assert.equal(exampleHasInflectedForm(word, example, '', pos), false, word + ' 不能宽泛前缀/删e匹配');
  }
  assert.equal(exampleHasInflectedForm('star', 'She starred in the film.', '', 1), true);
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
  for (const file of [...dataFiles, 'js/app.js', 'js/content-validation.mjs', 'js/validate-words.mjs', 'js/validate-cet-data.mjs', 'tests/fixtures/content-fixes-20261023.json', 'tests/fixtures/content-fixes-batch2-20261023.json', 'tests/fixtures/content-fixes-batch3-20261023.json', 'tests/fixtures/content-fixes-maintenance-20261023.json', 'tests/fixtures/content-fixes-meaning-20261024.json', 'tests/fixtures/content-fixes-meaning-20261025.json', 'tests/fixtures/content-fixes-phonetic-20261025.json', 'tests/fixtures/content-fixes-phonetic-normalize-20261025.json', 'tests/fixtures/content-fixes-forms-20261025.json', 'tests/fixtures/content-fixes-pronunciation-20261027.json']) {
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
    check(validator + ' 真实错配例句仍报告覆盖warning且不冒充语义error', () => {
      const row = Array.from(books[key][0]), original = JSON.stringify(row);
      row[7] = 'A nearby garden was quiet after sunset.';
      assert.equal(exampleHasInflectedForm(row[0], row[7], row[10], row[3]), false);
      const source = read(file); assert.equal(source.includes(original), true);
      fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(row)));
      const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], { cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
      assert.equal(result.status, 0, '一般覆盖疑点仍为warning');
      const report = fs.readFileSync(path.join(tmp, 'tests/reports', key === 'kaoyan' ? '数据校验报告.md' : '四六级数据校验报告.md'), 'utf8');
      assert.match(report, /例句疑似不含对应词头\/合理屈折/);
      fs.writeFileSync(path.join(tmp, file), source);
    });
    check(validator + ' 对批次C1 record名词主音标退回动词读音返回失败', () => {
      const correction = pronunciationFixture.corrections.find(item => item.word === 'record' && item.references[0].book === key);
      const reference = correction.references[0];
      const row = Array.from(books[reference.book][reference.index]), original = JSON.stringify(row);
      row[1] = correction.before['1'];
      const source = read(file); assert.equal(source.includes(original), true);
      fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(row)));
      const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding:'utf8', maxBuffer:2*1024*1024});
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /已确认内容修订回流/);
      fs.writeFileSync(path.join(tmp, file), source);
    });
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
    const troublingFix = meaningFixture.corrections.find(item => item.word === 'troubling');
    const troublingRef = troublingFix?.references.find(reference => sourceBooks.includes(reference.book));
    if (troublingRef) {
      check(validator + ' 对 troubling 旧释义回流返回失败', () => {
        const row = Array.from(books[troublingRef.book][troublingRef.index]), original = JSON.stringify(row);
        row[2] = troublingFix.before['2'];
        const source = read(file); assert.equal(source.includes(original), true, '正式源中存在修后行');
        fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(row)));
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
        assert.equal(result.status, 1, 'troubling 旧释义应拒绝');
        assert.match(result.stdout + result.stderr, /已确认内容修订回流/);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
    if (key !== 'kaoyan') {
      check(validator + ' 对已删除词头 relection 回流返回失败', () => {
        const source = read(file);
        const marker = 'window.WORDS_CET4 = [\n';
        assert.equal(source.includes(marker), true, '正式源存在四级数组');
        const injected = source.replace(marker, marker + '["relection","","n. 选择",0,6606,1,1,"Most of them require critical thinking and relection.","四级 2021.12",0,""],\n');
        fs.writeFileSync(path.join(tmp, file), injected);
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
        assert.equal(result.status, 1, 'relection 假词条回流应拒绝');
        assert.match(result.stdout + result.stderr, /已删除词头回流/);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
    check(validator + ' 对音标缺失回流返回失败', () => {
      const bookKey = key === 'kaoyan' ? 'kaoyan' : 'cet4';
      const row = Array.from(books[bookKey][0]), original = JSON.stringify(row);
      const changed = row.slice(); changed[1] = '';
      const source = read(file); assert.equal(source.includes(original), true, '正式源存在首行');
      fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(changed)));
      const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
      assert.equal(result.status, 1, '音标缺失应拒绝');
      assert.match(result.stdout + result.stderr, /音标缺失/);
      fs.writeFileSync(path.join(tmp, file), source);
    });
    for (const [label, badPh, expected] of [
      ['前导点', '.juːniˈvəːsiti', /音标以分隔点开头/],
      ['分号多读音', 'ˈesei; eˈsei', /音标含多读音/],
      ['内部空白', 'ˈmiθikə l', /音标含空白/],
      ['悬空连字符', 'ˈriəlaiz-', /音标以连字符结尾/],
      ['非标准符号', 'kənˊtent', /音标含非标准符号/],
    ]) {
      check(validator + ' 对音标' + label + '返回失败', () => {
        const bookKey = key === 'kaoyan' ? 'kaoyan' : 'cet4';
        const row = Array.from(books[bookKey][0]), original = JSON.stringify(row);
        const changed = row.slice(); changed[1] = badPh;
        const source = read(file); assert.equal(source.includes(original), true, '正式源存在首行');
        fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(changed)));
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
        assert.equal(result.status, 1, label + ' 应拒绝');
        assert.match(result.stdout + result.stderr, expected);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
    for (const [label, badFm, expected] of [
      ['不可解析', "第三人称单数 daydreams'", /词形说明不可解析/],
      ['复数机械加s', '复数 thuss', /复数词形疑似机械加 s/],
    ]) {
      check(validator + ' 对词形' + label + '返回失败', () => {
        const bookKey = key === 'kaoyan' ? 'kaoyan' : 'cet4';
        const row = Array.from(books[bookKey][0]), original = JSON.stringify(row);
        const changed = row.slice(); changed[10] = badFm;
        const source = read(file); assert.equal(source.includes(original), true, '正式源存在首行');
        fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(changed)));
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
        assert.equal(result.status, 1, label + ' 应拒绝');
        assert.match(result.stdout + result.stderr, expected);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
    if (key !== 'kaoyan') {
      check(validator + ' 对交叉引用/变形说明释义回流返回失败', () => {
        const row = Array.from(books.cet4[0]), original = JSON.stringify(row);
        const changed = row.slice(); changed[2] = 'a. organise的变形';
        const source = read(file); assert.equal(source.includes(original), true, '正式源存在首行');
        fs.writeFileSync(path.join(tmp, file), source.replace(original, JSON.stringify(changed)));
        const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(tmp, validator)], {cwd: tmp, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024});
        assert.equal(result.status, 1, '变形说明释义应拒绝');
        assert.match(result.stdout + result.stderr, /释义内容异常/);
        fs.writeFileSync(path.join(tmp, file), source);
      });
    }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n内容质量回归：${passed} 组通过 / 0 失败`);
