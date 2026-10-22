/* =========================================================
   背单词网页 · app.js（考研 / 英语四级 / 英语六级 / 综合词书）
   门控：未判定（recall）时「下一个」不翻页
   ========================================================= */
(function () {
  "use strict";

  /* ================= 数据与词书注册 ================= */
  const POSN = ["名词","动词","形容词","副词","介词","限定词","代词","助动词","并列连词","从属连词","数词","小品词","专有名词","感叹词","其他","符号"];
  const POSIDX = {"NOUN":0,"VERB":1,"ADJ":2,"ADV":3,"ADP":4,"DET":5,"PRON":6,"AUX":7,"CCONJ":8,"SCONJ":9,"NUM":10,"PART":11,"PROPN":12,"INTJ":13,"X":14,"SYM":15};

  /**
   * 词书注册（数组顺序即 UI 顺序）。
   * 数据来源：考研 js/words-data.js → window.WORDS_RAW；
   * 四/六级 js/cet-words-data.js → window.WORDS_CET4 / window.WORDS_CET6（由 vocab-builder 生成）。
   * 存储键、文案、默认筛选各书独立；考研键名保持历史原样，老用户进度零迁移。
   * paperCount / yearRange 优先取 window.WORD_BOOK_META[id]，缺省 paperCount 用 max(词条.c)。
   */
  const BOOK_DEFS = [
    { id: "kaoyan", name: "考研英语", mark: "研", dataKey: "WORDS_RAW",
      KEY: "kaoyan_vocab_v1", PROF_KEY: "kaoyan_vocab_proficient_v1",
      SURVEY_KEY: "kaoyan_vocab_survey_v1",
      paperUnit: "套考研真题", tagLabel: "考研大纲", kyOnlyLabel: "只保留考研大纲词", defaultPmin: 2 },
    { id: "cet4", name: "英语四级", mark: "四", dataKey: "WORDS_CET4",
      KEY: "cet4_vocab_v1", PROF_KEY: "cet4_vocab_proficient_v1",
      SURVEY_KEY: "cet4_vocab_survey_v1",
      paperUnit: "套四级真题", tagLabel: "四级大纲", kyOnlyLabel: "只保留四级大纲词", defaultPmin: 2 },
    { id: "cet6", name: "英语六级", mark: "六", dataKey: "WORDS_CET6",
      KEY: "cet6_vocab_v1", PROF_KEY: "cet6_vocab_proficient_v1",
      SURVEY_KEY: "cet6_vocab_survey_v1",
      paperUnit: "套六级真题", tagLabel: "六级大纲", kyOnlyLabel: "只保留六级大纲词", defaultPmin: 2 },
    { id: "combined", name: "综合词书", mark: "综", dataKey: "WORDS_COMBINED",
      KEY: "combined_vocab_v1", PROF_KEY: "combined_vocab_proficient_v1",
      SURVEY_KEY: "combined_vocab_survey_v1",
      paperUnit: "套真题（考研/四级/六级合计）", tagLabel: "考试大纲", kyOnlyLabel: "只保留任一考试大纲词", defaultPmin: 2,
      requires: ["WORDS_RAW", "WORDS_CET4", "WORDS_CET6"] }
  ];
  /** 当前词书 id（纯字符串，如 "cet4"），缺省/非法/数据不可用 → 考研 */
  const ACTIVE_KEY = "vocab_active_book_v1";

  /** 11 元组 → 内部结构（与 words-data.js 字段一致） */
  function mapWords(raw){
    return (Array.isArray(raw) ? raw : []).map(a => ({
      w: a[0], ph: a[1], m: a[2], p: a[3], r: a[4], f: a[5], c: a[6],
      ex: a[7], src: a[8], ky: a[9], fm: a[10]
    }));
  }
  /**
   * 解析词书数据版本与迁移链（数据侧契约，见 task-9）：
   *   meta.dataVersion: 当前词书数据版本（整数，缺省 1）
   *   meta.migrations: [{from,to,removed:[旧下标…]}]，from→from+1，removed 升序唯一
   * 非法/缺失 → 忽略迁移、dataVersion 默认 1，**不得抛错**。
   * 校验方式：从目标版本倒推每一版旧数组长度，确认 removed 下标都在范围内；
   * 迁移链必须从 1 连续到 dataVersion，否则整组忽略（避免半套映射错位）。
   */
  function readBookDataVersion(meta, newLength){
    const fallback = {dataVersion: 1, migrations: []};
    if (!meta || typeof meta !== "object") return fallback;
    const v = meta.dataVersion;
    if (!(typeof v === "number" && isFinite(v) && v >= 1 && Math.floor(v) === v)) return fallback;
    const version = Math.floor(v);
    if (version === 1) return fallback;
    if (!Array.isArray(meta.migrations)) return fallback;
    const byFrom = new Map();
    for (const m of meta.migrations) {
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      if (!Number.isInteger(m.from) || !Number.isInteger(m.to) || m.to !== m.from + 1 || m.from < 1) continue;
      if (!Array.isArray(m.removed)) continue;
      let prev = -1, bad = false;
      for (const r of m.removed) {
        if (!Number.isInteger(r) || r <= prev) { bad = true; break; }   // 升序、唯一、非负
        prev = r;
      }
      if (bad || byFrom.has(m.from)) continue;   // 非法/重复 from：忽略该条
      const entry = {from: m.from, to: m.to, removed: m.removed.slice(), addedCount: 0};
      if (Array.isArray(m.removedWords) && m.removedWords.length === m.removed.length
          && m.removedWords.every(w => typeof w === "string" && /^[a-z]+$/.test(w))) {
        entry.removedWords = m.removedWords.slice();
      }
      if (Array.isArray(m.added) && m.added.every(n => Number.isInteger(n) && n >= 0)) entry.addedCount = m.added.length;
      else if (Array.isArray(m.addedWords) && m.addedWords.every(w => typeof w === "string" && /^[a-z]+$/.test(w))) entry.addedCount = m.addedWords.length;
      byFrom.set(m.from, entry);
    }
    const chain = [];
    let ver = version, len = newLength;
    while (ver > 1) {
      const m = byFrom.get(ver - 1);
      if (!m) return fallback;                        // 迁移链不完整 → 整组忽略
      const oldLen = len + m.removed.length - (m.addedCount || 0);
      if (oldLen <= 0 || m.removed.length >= oldLen) return fallback;
      for (const r of m.removed) if (r >= oldLen) return fallback;
      chain.unshift(m);
      len = oldLen;
      ver = m.from;
    }
    return {dataVersion: version, migrations: chain};
  }

  /** 注册全部词书；数据缺失/空数组 → 不可用（老缓存页面缺 cet 数据时只有考研可用） */
  const BOOKS = {};
  BOOK_DEFS.forEach(def => {
    const words = mapWords(window[def.dataKey]);
    const meta = (window.WORD_BOOK_META && window.WORD_BOOK_META[def.id]) || {};
    let paperCount = meta.paperCount;
    if (!(typeof paperCount === "number" && isFinite(paperCount) && paperCount > 0)) {
      paperCount = 0;
      for (const x of words) if (x.c > paperCount) paperCount = x.c;
    }
    const dv = readBookDataVersion(meta, words.length);
    BOOKS[def.id] = Object.assign({}, def, {
      words: words,
      available: words.length > 0 && (!def.requires || def.requires.every(key => Array.isArray(window[key]) && window[key].length > 0)),
      paperCount: paperCount,
      yearRange: typeof meta.yearRange === "string" ? meta.yearRange : "",
      wordIndex: new Map(words.map((x, i) => [x.w, i])),
      dataVersion: dv.dataVersion,
      migrations: dv.migrations,
      removedWords: dv.migrations.length && dv.migrations.every(m => Array.isArray(m.removedWords))
        ? new Set(dv.migrations.flatMap(m => m.removedWords)) : null
    });
  });
  function pickActiveBook(stored){
    if (stored && BOOKS[stored] && BOOKS[stored].available) return stored;
    if (BOOKS.kaoyan && BOOKS.kaoyan.available) return "kaoyan";
    const first = BOOK_DEFS.map(d => d.id).find(id => BOOKS[id].available);
    return first || "kaoyan";
  }
  let currentBookId = pickActiveBook((function () {
    try { return localStorage.getItem(ACTIVE_KEY); } catch (e) { return null; }
  })());
  function currentBook(){ return BOOKS[currentBookId]; }
  function bookOf(id){ return Object.prototype.hasOwnProperty.call(BOOKS, id) ? BOOKS[id] : null; }
  function wordBookTags(word){
    if (currentBookId !== "combined") return "";
    return BOOK_DEFS.filter(def => def.id !== "combined" && BOOKS[def.id].wordIndex.has(word))
      .map(def => '<span class="tag">' + esc(def.name) + '</span>').join("");
  }

  /** 当前词书数据（切换词书时整体重建；数组顺序即进度主键，各书互不影响） */
  let W = BOOKS[currentBookId].words;
  let wordIndex = BOOKS[currentBookId].wordIndex;
  /** 当前词书的存储键（切换词书时更新；考研键名与历史版本完全一致） */
  let KEY = BOOKS[currentBookId].KEY;
  let PROF_KEY = BOOKS[currentBookId].PROF_KEY;
  let SURVEY_KEY = BOOKS[currentBookId].SURVEY_KEY;
  /** 乱序模式随机抽样：单词 → 0/1（1 = 首次作答「会」）。按词文本存，跨数据版本天然对齐。 */
  let SURVEY = {};
  let lastSurvey = {};

  /* ================= 艾宾浩斯调度 ================= */
  const STAGES = [
    {t:"5 分钟",  ms:5*60*1000},
    {t:"30 分钟", ms:30*60*1000},
    {t:"12 小时", ms:12*60*60*1000},
    {t:"1 天",    ms:24*60*60*1000},
    {t:"2 天",    ms:2*24*60*60*1000},
    {t:"4 天",    ms:4*24*60*60*1000},
    {t:"7 天",    ms:7*24*60*60*1000},
    {t:"15 天",   ms:15*24*60*60*1000},
    {t:"30 天",   ms:30*24*60*60*1000},
    {t:"60 天",   ms:60*24*60*60*1000}
  ];
  /** 已掌握 = 走完全部 10 档复习（含 60 天档）之后再答对一次 */
  const MASTER = STAGES.length + 1;
  const RELRN = 5*60*1000;

  function nextOnKnow(stage){
    return {stage: Math.min(stage + 1, MASTER), delay: STAGES[Math.min(stage, STAGES.length - 1)].ms};
  }
  function nextOnForget(){ return {stage:0, delay:RELRN}; }
  function stageLabel(stage){
    if(stage>=MASTER) return "已掌握";
    if(stage<=0) return "新学";
    return "第 "+stage+" 档 · "+STAGES[stage-1].t;
  }
  function todayStr(d){ d=d||new Date(); const p=n=>String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }
  function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function shuffle(arr,seed){ const r=rng(seed), a=arr.slice();
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); const tmp=a[i]; a[i]=a[j]; a[j]=tmp; } return a; }

  /* ================= 状态与持久化 ================= */
  // KEY / PROF_KEY 已在上方按当前词书初始化：考研键名 = 历史键名，老用户零迁移。
  // Only explicit proficiency actions write PROF_KEY; stale tabs cannot erase exclusions.
  const DEFKEYS = {know:"f", dont:"j", next:" ", speak:"s", star:"b", proficient:"m"};
  const DEF = {
    settings: {
      dailyNew: 30, order: "freq",
      fmin: 1, fmax: 0, pmin: 2, kyOnly: false, pos: [],
      theme: "auto",
      showPh: true, showEx: true, showFm: true, autoSpk: false,
      singleCharKeys: true,
      keys: Object.assign({}, DEFKEYS)
    },
    progress: {}, days: {}, stars: {}, proficient: {}, timeSec: 0, dv: 1
  };
  /** 空白记录：dv = 该词书当前数据版本（旧记录无 dv 视作 1） */
  function freshState(book){
    const st = JSON.parse(JSON.stringify(DEF));
    st.dv = ((book || currentBook()).dataVersion) || 1;
    return st;
  }
  const POSCHIPS = [
    {k:"n", t:"名词"}, {k:"v", t:"动词"}, {k:"a", t:"形容词"}, {k:"d", t:"副词"}, {k:"x", t:"其他"}
  ];
  const POSMAP = {n:[0], v:[1], a:[2], d:[3]};

  let S = freshState(currentBook());
  let storageOK = true;
  let loadError = null;
  // 某本书的主记录损坏/存储被禁用时暂停该书写入，避免把可恢复的备份覆盖成空记录。
  // 只影响损坏的那一本；切换到另一本仍可正常读写。
  const blockedBooks = new Set();
  let lastMainRaw = null;
  // 渲染会建立空的当日计数；空计数不代表有尚未保存的用户改动。
  function savedStateSignature(state){
    return JSON.stringify([state.settings, state.progress,
      Object.fromEntries(Object.entries(state.days).filter(([, d]) => d.r > 0)),
      state.stars, state.proficient, state.timeSec]);
  }
  let lastSavedSignature = savedStateSignature(S);
  /**
   * 熟练键写入失败时，新增/取消操作仍保留在本页内存中。导出与后续保存
   * 用「最新存储 + 待写入操作」合并，既不丢这次操作，也不覆盖别的标签页。
   */
  const pendingProf = new Map();
  function pendingProfOf(bookId){
    let p = pendingProf.get(bookId);
    if (!p) { p = {add: new Map(), remove: new Set()}; pendingProf.set(bookId, p); }
    return p;
  }
  function markProfPending(bookId, word, value, at){
    const p = pendingProfOf(bookId);
    if (value) { p.add.set(word, at || Date.now()); p.remove.delete(word); }
    else { p.remove.add(word); p.add.delete(word); }
    if (!p.add.size && !p.remove.size) pendingProf.delete(bookId);
  }
  function clearProfPending(bookId){ pendingProf.delete(bookId); }
  function mergePendingProficient(list, bookId){
    const p = pendingProf.get(bookId);
    if (!p) return Object.assign({}, list || {});
    const out = Object.assign({}, list || {});
    for (const w of p.remove) delete out[w];
    for (const [w, at] of p.add) out[w] = at;
    return out;
  }
  function pendingProfCount(bookId){
    const p = pendingProf.get(bookId);
    return p ? p.add.size + p.remove.size : 0;
  }
  function snapshotPendingProf(){
    const out = new Map();
    for (const [id, p] of pendingProf) out.set(id, {add: new Map(p.add), remove: new Set(p.remove)});
    return out;
  }
  function restorePendingProf(snap){
    pendingProf.clear();
    for (const [id, p] of snap || []) pendingProf.set(id, {add: new Map(p.add), remove: new Set(p.remove)});
  }

  // spaCy 残缺词形 → 正确词形（与 tests/fixtures/spelling-fixes.json 保持一致）。
  // 仅当旧拼写已不在词库、新拼写存在时才迁移熟练名单键，避免与保留的同名词条冲突。
  const SPELLING_FIX = {
    "acqui": "acquire",
    "alloparente": "alloparent",
    "backloade": "backload",
    "bestselle": "bestseller",
    "blogge": "blog",
    "cofounde": "cofound",
    "complie": "comply",
    "conceite": "conceit",
    "cosmo": "cosmos",
    "diabete": "diabetes",
    "dispassione": "dispassion",
    "downshifte": "downshift",
    "downstair": "downstairs",
    "earning": "earnings",
    "farsighte": "farsighted",
    "farth": "far",
    "firefighte": "firefight",
    "foresighte": "foresight",
    "freethinke": "freethinking",
    "goode": "good",
    "graf": "grave",
    "graffitie": "graffiti",
    "groundbreake": "groundbreaker",
    "hardworke": "hardworking",
    "hearte": "heart",
    "housebuilde": "housebuilding",
    "hoverflie": "hoverfly",
    "inboxe": "inbox",
    "inputte": "input",
    "justifie": "justify",
    "laborsave": "laborsaving",
    "maladapte": "maladapted",
    "manif": "manifest",
    "maste": "master",
    "mathematic": "mathematics",
    "misadjuste": "misadjust",
    "mispredicte": "mispredict",
    "modifie": "modify",
    "overfishe": "overfish",
    "overfunde": "overfund",
    "paywalle": "paywall",
    "photocopi": "photocopy",
    "plateaue": "plateau",
    "policymake": "policymaking",
    "quirki": "quirky",
    "readmitte": "readmit",
    "remedie": "remedy",
    "renowne": "renowned",
    "reskille": "reskill",
    "satisfie": "satisfy",
    "sens": "sense",
    "sensore": "sensor",
    "suppresse": "suppress",
    "talente": "talent",
    "uncontrolle": "uncontrolled",
    "underfunde": "underfund",
    "undiscusse": "undiscussed",
    "unhampere": "unhampered",
    "unmentione": "unmentioned",
    "unquestione": "unquestioned",
    "unreflecte": "unreflecting",
    "upskille": "upskill",
    "vanishe": "vanish",
    "wellbee": "wellbeing"
  };
  const isRecord = o => !!o && typeof o === "object" && !Array.isArray(o);
  /** 单词下标是否合法（按指定词书的词库长度判断） */
  const validIndex = (k, book) => /^(0|[1-9]\d*)$/.test(k) && +k < (book || currentBook()).words.length;
  const nonnegative = n => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const validProgress = p => Array.isArray(p) && p.length === 5 && p.every(nonnegative)
    && Number.isInteger(p[0]) && p[0] <= MASTER && Number.isInteger(p[2]) && Number.isInteger(p[3]);
  const integer = (n, fallback, min, max) => nonnegative(n)
    ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
  const validKey = k => typeof k === "string" && /^[a-z0-9 ]$/i.test(k);
  function resolveProficientWord(w, book){
    const idx = (book || currentBook()).wordIndex;
    if (idx.has(w)) return w;
    const fixed = SPELLING_FIX[w];
    return fixed && idx.has(fixed) ? fixed : w;
  }
  /** 熟练名单按单词文本存；校验词必须存在于指定词书 */
  function normalizeProficient(o, book){
    if (!isRecord(o)) throw new Error("熟练标记格式不正确");
    book = book || currentBook();
    const out = {};
    for (const [w0, v] of Object.entries(o)) {
      const w = resolveProficientWord(w0, book);
      if (!book.wordIndex.has(w) || !nonnegative(v) || !v) throw new Error("熟练词条不存在或格式不正确");
      if (out[w] === undefined) out[w] = v;
    }
    return out;
  }
  /** 迁移时旧下标 → 新下标：new = old - count(removed < old)（removed 已升序） */
  function countRemovedBefore(removed, old){
    let lo = 0, hi = removed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (removed[mid] < old) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  /** 单步迁移（from → to）：progress/stars 下标重映射，删词对应的熟练标记丢弃，其余原样保留 */
  function applyBookMigration(st, migration, book){
    const removed = migration.removed;
    const removedSet = new Set(removed);
    const oldLength = book.words.length + book.migrations
      .filter(m => m.from >= migration.from)
      .reduce((n, m) => n + m.removed.length - (m.addedCount || 0), 0);
    const out = JSON.parse(JSON.stringify(st));
    if (isRecord(st.progress)) {
      const progress = {};
      for (const [k, v] of Object.entries(st.progress)) {
        // 删除之前也必须校验旧条目，不能让迁移掩盖损坏的备份。
        if (!/^(0|[1-9]\d*)$/.test(k) || +k >= oldLength || !validProgress(v)) {
          throw new Error("单词进度格式不正确");
        }
        const old = +k;
        if (removedSet.has(old)) continue;                              // 被删词条 → 丢弃该条进度
        progress[String(old - countRemovedBefore(removed, old))] = v;
      }
      out.progress = progress;
    }
    if (isRecord(st.stars)) {
      const stars = {};
      for (const [k, v] of Object.entries(st.stars)) {
        if (!/^(0|[1-9]\d*)$/.test(k) || +k >= oldLength) throw new Error("收藏词条不存在");
        const old = +k;
        if (removedSet.has(old)) continue;
        stars[String(old - countRemovedBefore(removed, old))] = v;
      }
      out.stars = stars;
    }
    if (isRecord(st.proficient)) {
      const proficient = {};
      for (const [w0, v] of Object.entries(st.proficient)) {
        if (!nonnegative(v) || !v) throw new Error("熟练词条格式不正确");
        const w = resolveProficientWord(w0, book);
        if (!book.wordIndex.has(w)) {
          if (book.removedWords && !book.removedWords.has(w0)) throw new Error("熟练词条不存在");
          continue;   // 仅清理确认被删的词；旧元数据无词名时兼容原迁移口径。
        }
        if (proficient[w] === undefined) proficient[w] = v;
      }
      out.proficient = proficient;
    }
    out.dv = migration.to;
    return out;
  }
  /**
   * 把记录迁移到词书当前 dataVersion：无 dv 视作 1；已是当前/更新版本原样返回；
   * 旧版本按 migrations 链逐级迁移。缺少迁移链时抛错（读记录 → blocked，导入 → 整份拒绝）。
   */
  function migrateState(o, book){
    book = book || currentBook();
    if (!isRecord(o)) return o;                       // 交给 normalizeState 报错
    const target = book.dataVersion || 1;
    const dv = integer(o.dv, 1, 1, Number.MAX_SAFE_INTEGER);
    if (dv > target) {
      throw new Error("学习记录来自更新的词库（数据版本 " + dv + " > 当前 " + target + "）；请更新应用后再导入，原记录不会被覆盖");
    }
    if (dv === target) return o;
    let cur = o, v = dv;
    while (v < target) {
      const m = book.migrations.find(x => x.from === v);
      if (!m) throw new Error("学习记录版本过旧，缺少迁移映射");
      cur = applyBookMigration(cur, m, book);
      v = m.to;
    }
    cur.dv = target;
    return cur;
  }
  /** 熟练名单容错归一：数据重建删词后，已不在词书里的键丢弃（不因删词判整份损坏） */
  function normalizeProficientLenient(o, book){
    if (!isRecord(o)) throw new Error("熟练标记格式不正确");
    book = book || currentBook();
    const out = {};
    for (const [w0, v] of Object.entries(o)) {
      if (!nonnegative(v) || !v) throw new Error("熟练词条格式不正确");
      const w = resolveProficientWord(w0, book);
      if (!book.wordIndex.has(w)) {
        if (book.removedWords && !book.removedWords.has(w0)) throw new Error("熟练词条不存在");
        continue;
      }
      if (out[w] === undefined) out[w] = v;
    }
    return out;
  }
  /** 按词书是否带迁移决定熟练名单校验口径（有迁移=数据重建过，允许丢弃已删词） */
  function normalizeProficientByBook(o, book){
    book = book || currentBook();
    return book.migrations.length ? normalizeProficientLenient(o, book) : normalizeProficient(o, book);
  }
  /** 独立熟练键是最新名单；即使主记录损坏，导入/导出仍可保留它。 */
  function readBookProficient(book, fallback){
    const raw = localStorage.getItem(book.PROF_KEY);
    return raw === null ? fallback : normalizeProficientByBook(JSON.parse(raw), book);
  }
  function syncProficientFromStorage(){
    const raw = localStorage.getItem(PROF_KEY);
    if (raw === null) {
      // 独立键尚未建立时，主记录里的熟练名单仍然有效，不能被空值抹掉。
      S.proficient = mergePendingProficient(S.proficient, currentBookId);
      return;
    }
    const parsed = JSON.parse(raw);
    const next = normalizeProficientByBook(parsed, currentBook());
    // 旧拼写键已迁移 / 删词清理时回写一次，让 localStorage 与词库文本对齐。
    if (Object.keys(parsed).some(k => !(k in next))) {
      try { localStorage.setItem(PROF_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    }
    S.proficient = mergePendingProficient(next, currentBookId);
  }

  /**
   * Validate completely before replacing live state. Old v1 exports remain compatible.
   * bookId 缺省 = 当前词书；非法/本版本不可用的 bookId 回退当前书，再按该书的
   * 词库长度 / paperCount 校验（import v2 会先跳过不可用词书，不会误用回退口径）。
   */
  function normalizeState(o, bookId){
    const picked = typeof bookId === "string" ? bookOf(bookId) : null;
    const book = (picked && picked.available) ? picked : currentBook();
    if (!book || !book.available) throw new Error("词书数据未载入");
    o = migrateState(o, book);   // 关键顺序：先按 migrations 把旧下标迁到当前数组，再校验
    if (!isRecord(o) || !isRecord(o.progress) || !isRecord(o.days)) throw new Error("缺少学习记录");
    const out = JSON.parse(JSON.stringify(DEF));
    const old = isRecord(o.settings) ? o.settings : {};
    const s = out.settings;
    const pminMax = book.paperCount > 0 ? book.paperCount : (book.defaultPmin || 2);
    s.dailyNew = integer(old.dailyNew, 30, 1, 500);
    s.fmin = integer(old.fmin, 1, 1, 9999);
    s.fmax = integer(old.fmax, 0, 0, 9999);
    if (s.fmax) s.fmax = Math.max(s.fmin, s.fmax);
    s.pmin = integer(old.pmin, Math.min(book.defaultPmin || 2, pminMax), 0, pminMax);
    if (["freq", "shuffle", "wrong"].includes(old.order)) s.order = old.order;
    if (["auto", "light", "dark"].includes(old.theme)) s.theme = old.theme;
    for (const k of ["kyOnly", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys"]) {
      if (typeof old[k] === "boolean") s[k] = old[k];
    }
    s.pos = Array.isArray(old.pos) ? [...new Set(old.pos.filter(k => POSCHIPS.some(x => x.k === k)))] : [];
    migrateScope(old, s);
    if (isRecord(old.keys)) {
      for (const k of Object.keys(DEFKEYS)) {
        if (validKey(old.keys[k])) s.keys[k] = old.keys[k].toLowerCase();
      }
      if (new Set(Object.values(s.keys)).size !== Object.keys(s.keys).length) s.keys = Object.assign({}, DEFKEYS);
    }
    for (const [k, p] of Object.entries(o.progress)) {
      if (!validIndex(k, book) || !validProgress(p)) {
        throw new Error("单词进度格式不正确");
      }
      out.progress[k] = p.slice();
    }
    for (const [k, d] of Object.entries(o.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isRecord(d)
          || ![d.n, d.r, d.ok, d.no].every(n => nonnegative(n) && Number.isInteger(n))
          || d.n > d.r || d.ok + d.no !== d.r) throw new Error("每日记录格式不正确");
      const date = new Date(k + "T12:00:00");
      if (Number.isNaN(date.getTime()) || todayStr(date) !== k) throw new Error("记录日期不正确");
      out.days[k] = {n:d.n, r:d.r, ok:d.ok, no:d.no};
    }
    if (o.stars !== undefined && !isRecord(o.stars)) throw new Error("收藏格式不正确");
    for (const [k, v] of Object.entries(o.stars || {})) {
      if (!validIndex(k, book)) throw new Error("收藏词条不存在");
      if (v) out.stars[k] = 1;
    }
    out.proficient = normalizeProficient(o.proficient === undefined ? {} : o.proficient, book);
    out.timeSec = integer(o.timeSec, 0, 0, Number.MAX_SAFE_INTEGER);
    out.dv = book.dataVersion || 1;   // 迁移/校验完成后标记为当前数据版本
    return out;
  }
  /** 读取某本词书已保存的 state；无记录 → 空白默认记录，损坏 → 抛错 */
  function readBookState(book){
    const raw = localStorage.getItem(book.KEY);
    if (raw === null) return {state: freshState(book), raw: null};
    return {state: normalizeState(JSON.parse(raw), book.id), raw: raw};
  }
  function load(){
    const book = currentBook();
    try {
      const got = readBookState(book);
      S = got.state;
      lastMainRaw = got.raw;
      blockedBooks.delete(book.id);
      storageOK = true;
      loadError = null;
    } catch (e) {
      storageOK = false;
      blockedBooks.add(book.id);
      loadError = e && e.message ? e.message : "记录格式无法读取";
      // Do not overwrite an unreadable or damaged backup with empty records.
    }
    // Permanent exclusions can still be recovered if the main backup is damaged.
    try { syncProficientFromStorage(); }
    catch (e) { storageOK = false; blockedBooks.add(book.id); }
    lastSavedSignature = savedStateSignature(S);
    loadSurvey();
  }
  function save(proficiencyChanged = false, replaceAll = false){
    if (blockedBooks.has(currentBookId)) return false;   // 该书记录损坏/不可写时保护原文件
    try {
      if (proficiencyChanged) {
        localStorage.setItem(PROF_KEY, JSON.stringify(S.proficient));
        clearProfPending(currentBookId);
      } else {
        syncProficientFromStorage();
        // 上次熟练写入失败时，随这次主记录保存一并重试。
        if (pendingProfCount(currentBookId)) {
          localStorage.setItem(PROF_KEY, JSON.stringify(S.proficient));
          clearProfPending(currentBookId);
        }
      }
      const latest = localStorage.getItem(KEY);
      if (!replaceAll && latest !== lastMainRaw) {
        // A delayed storage event must not let an older tab overwrite newer learning records.
        S = latest !== null ? normalizeState(JSON.parse(latest), currentBookId) : freshState(currentBook());
        syncProficientFromStorage();
        lastMainRaw = latest;
        lastSavedSignature = savedStateSignature(S);
        bindSet(); applyFilter(); renderStats(); startSession();
        toast("另一窗口已更新记录，学习队列已同步");
        storageOK = true;
        blockedBooks.delete(currentBookId);
        return true;
      }
      const serialized = JSON.stringify(S);
      localStorage.setItem(KEY, serialized); lastMainRaw = serialized;
      lastSavedSignature = savedStateSignature(S);
      storageOK = true; blockedBooks.delete(currentBookId); clearAlert("save"); return true;
    }
    catch (e) {
      storageOK = false;
      showAlert("进度保存失败", "受影响词书：" + currentBook().name
        + "。浏览器存储不可用或空间不足；当前页面仍可继续学习，但刷新前请导出备份。"
        + (pendingProfCount(currentBookId) ? "另有熟练标记尚未写入。" : ""), {kind: "save", export: true});
      return false;
    }
  }
  function migrateScope(oldSet, cur){
    if (oldSet.fmin !== undefined) return;
    if (oldSet.scope === "high") cur.fmin = 5;
    else if (oldSet.scope === "ky") cur.kyOnly = true;
    else if (oldSet.scope === "all") { cur.fmin = 1; cur.fmax = 0; }
  }

  /* ================= 多词书：切换 / 统计 / 备份 ================= */
  /** 切换词书时携带的纯界面偏好（学习相关设置各书独立） */
  const CARRY_SETTINGS = ["theme", "keys", "showPh", "showEx", "showFm", "autoSpk", "singleCharKeys"];
  function cloneSettingsValue(v){
    return (v && typeof v === "object") ? JSON.parse(JSON.stringify(v)) : v;
  }
  /** 某书学习概况（用于词书列表展示）：已学 = 有进度记录的词数，已掌握 = 走完全部档位 */
  function bookStats(id){
    let prog = null;
    if (id === currentBookId && blockedBooks.has(id)) return {ok: false, learned: 0, mastered: 0};
    if (id === currentBookId) prog = S.progress;
    else {
      try {
        prog = readBookState(BOOKS[id]).state.progress;   // 迁移后再统计，删词不计入
      } catch (e) { return {ok: false, learned: 0, mastered: 0}; }
    }
    let learned = 0, mastered = 0;
    for (const k of Object.keys(prog || {})) {
      const p = prog[k];
      if (!Array.isArray(p) || !hasMainProgress(p)) continue;
      learned++;
      if (p[0] >= MASTER) mastered++;
    }
    return {ok: true, learned: learned, mastered: mastered};
  }
  /** 读取某书 state（qa 钩子用；非法/不可用 → null，未保存过 → 空白记录） */
  function getBookState(id){
    if (!bookOf(id)) return null;
    if (id === currentBookId) return S;
    if (!BOOKS[id].available) return null;
    try {
      const state = readBookState(BOOKS[id]).state;
      try { state.proficient = readBookProficient(BOOKS[id], state.proficient); } catch (e) {}
      state.proficient = mergePendingProficient(state.proficient, id);
      return state;
    }
    catch (e) { return null; }
  }
  /** 直接写入某本非当前词书（导入 v2 用）；主记录与熟练键都写，保持两处一致 */
  function writeBookState(id, state){
    const book = BOOKS[id];
    if (!book) return false;
    try {
      localStorage.setItem(book.KEY, JSON.stringify(state));
      localStorage.setItem(book.PROF_KEY, JSON.stringify(state.proficient));
      clearProfPending(id);
      blockedBooks.delete(id);
      return true;
    } catch (e) {
      storageOK = false;
      toast("部分词书记录未能保存，请检查浏览器存储空间");
      return false;
    }
  }
  /**
   * 切换当前词书。
   * opts.silent  不弹切换提示（跨标签页跟随时用）
   * opts.persist 是否写 ACTIVE_KEY 并保存界面偏好（跨标签页跟随时 false）
   * opts.carry   是否携带当前书的 theme/keys/显示偏好（导入恢复时为 false 以保留备份设置）
   */
  function switchBook(id, opts){
    opts = opts || {};
    const book = bookOf(id);
    if (!book || !book.available) {
      if (!opts.silent) toast("该词书数据未载入，暂时无法切换");
      return false;
    }
    if (id === currentBookId) {
      if (!opts.silent) { renderBookList(); if (activeSheet) closeSheet(); }
      return true;
    }
    saveListUi();
    const saved = opts.persist === false ? storageOK : save();
    if (!saved) {
      // 保存失败后切走会丢掉只能从当前内存导出的学习记录。
      // 初次读到损坏记录、尚未学习的书仍可切出，不妨碍其它词书使用。
      if (!blockedBooks.has(currentBookId) || savedStateSignature(S) !== lastSavedSignature) {
        toast("当前词书未能保存，已保留在本页；请先导出进度备份后再切换");
        return false;
      }
    }
    // 读取目标书记录；目标记录损坏时保护原文件（blocked）并先用空白记录，可由导入备份恢复
    let target = freshState(book);
    let targetRaw = null;
    let targetBlocked = false;
    try {
      const got = readBookState(book);
      target = got.state;
      targetRaw = got.raw;
      try {
        const profRaw = localStorage.getItem(book.PROF_KEY);
        if (profRaw !== null) target.proficient = normalizeProficientByBook(JSON.parse(profRaw), book);
      } catch (e) { targetBlocked = true; }
      target.proficient = mergePendingProficient(target.proficient, id);
    } catch (e) { targetBlocked = true; }
    if (opts.carry !== false) {
      for (const k of CARRY_SETTINGS) {
        if (S.settings[k] !== undefined) target.settings[k] = cloneSettingsValue(S.settings[k]);
      }
    }
    currentBookId = id;
    KEY = book.KEY;
    PROF_KEY = book.PROF_KEY;
    SURVEY_KEY = book.SURVEY_KEY;
    W = book.words;
    wordIndex = book.wordIndex;
    S = target;
    loadSurvey();
    lastMainRaw = targetRaw;
    lastSavedSignature = savedStateSignature(S);
    if (targetBlocked) blockedBooks.add(id); else blockedBooks.delete(id);
    storageOK = !targetBlocked;
    if (opts.persist !== false) {
      try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* ignore */ }
      save();   // 落盘携带的界面偏好（目标记录损坏时自动跳过）
    }
    rebinding = null;
    detailWord = null;
    if (activeSheet) closeSheet();
    bindSet();
    restoreListUi(id);
    applyFilter(false);
    renderStats();
    startSession();
    updateScopeCount();
    updateBar();
    applyBrand();
    renderBookList();
    if (!opts.silent) toast("已切换到「" + book.name + "」");
    return true;
  }
  /** 跨标签页跟随别的标签切换词书（不再写回 ACTIVE_KEY，避免来回触发） */
  function followActiveBook(){
    let id = null;
    try { id = localStorage.getItem(ACTIVE_KEY); } catch (e) { return; }
    if (!id || id === currentBookId || !bookOf(id) || !BOOKS[id].available) return;
    switchBook(id, {silent: true, persist: false, carry: false});
  }
  const APP_ID = "kaoyan-vocab";
  const JOURNAL_KEY = "vocab_import_journal_v1";

  /** 导出只读：最新独立熟练键 + 尚未落盘的增删操作；不修改 S。 */
  function currentExportProficient(){
    let stored = S.proficient;
    try {
      const raw = localStorage.getItem(PROF_KEY);
      if (raw !== null) stored = normalizeProficientByBook(JSON.parse(raw), currentBook());
    } catch (e) { /* 损坏/不可用时保留内存名单，collect 会给出警告 */ }
    return mergePendingProficient(stored, currentBookId);
  }
  function exportStateSnapshot(st, book, includePending){
    return JSON.parse(JSON.stringify({
      dv: st.dv || book.dataVersion || 1,
      settings: st.settings || DEF.settings, progress: st.progress || {}, days: st.days || {},
      stars: st.stars || {}, proficient: includePending ? currentExportProficient() : (st.proficient || {}),
      timeSec: st.timeSec || 0
    }));
  }
  /**
   * 只读收集全部词书。当前书用内存快照（可能含尚未落盘的学习进度），
   * 熟练名单与最新存储及待写入操作合并；其他书只读存储，绝不改动内存。
   */
  function collectExportData(){
    const books = {}, corrupted = [], warnings = [];
    for (const def of BOOK_DEFS) {
      const book = BOOKS[def.id];
      if (!book.available) continue;
      let raw = null, profRaw = null;
      try {
        raw = localStorage.getItem(book.KEY);
        profRaw = localStorage.getItem(book.PROF_KEY);
      } catch (e) {
        if (def.id === currentBookId) {
          warnings.push({id: def.id, name: book.name, reason: "memory-only"});
          books[def.id] = exportStateSnapshot(S, book, true);
        } else {
          warnings.push({id: def.id, name: book.name, reason: "storage-unavailable"});
        }
        continue;
      }
      if (def.id === currentBookId) {
        if (raw !== null) {
          try { normalizeState(JSON.parse(raw), def.id); }
          catch (err) {
            corrupted.push({id: def.id, name: book.name, raw: raw, proficient: profRaw, error: err.message});
            continue;
          }
        }
        books[def.id] = exportStateSnapshot(S, book, true);
        if (profRaw !== null) {
          try { normalizeProficientByBook(JSON.parse(profRaw), book); }
          catch (err) { warnings.push({id: def.id, name: book.name, reason: "proficient-unreadable"}); }
        }
        continue;
      }
      if (raw === null) {
        const empty = freshState(book);
        empty.proficient = mergePendingProficient(empty.proficient, def.id);
        books[def.id] = exportStateSnapshot(empty, book, false);
        continue;
      }
      let state;
      try { state = normalizeState(JSON.parse(raw), def.id); }
      catch (err) {
        corrupted.push({id: def.id, name: book.name, raw: raw, proficient: profRaw, error: err.message});
        continue;
      }
      if (profRaw !== null) {
        try { state.proficient = normalizeProficientByBook(JSON.parse(profRaw), book); }
        catch (err) { warnings.push({id: def.id, name: book.name, reason: "proficient-unreadable"}); }
      }
      state.proficient = mergePendingProficient(state.proficient, def.id);
      books[def.id] = exportStateSnapshot(state, book, false);
    }
    return {books: books, corrupted: corrupted, warnings: warnings};
  }
  function warningIds(warnings){
    return warnings.map(w => w.reason === "proficient-unreadable"
      ? w.name + "（熟练名单无法读取，已使用主记录中的名单）"
      : w.reason === "memory-only"
        ? w.name + "（存储不可用，已使用当前内存快照）"
        : w.name + "（当前浏览器存储不可用，未包含）").join("；");
  }
  /** 导出 v3：全部可用词书；任一主记录损坏时拒绝常规导出，避免伪装成空白记录。 */
  function buildExport(){
    const data = collectExportData();
    if (data.corrupted.length) {
      const error = new Error("有词书的记录无法读取：" + data.corrupted.map(c => c.name).join("、")
        + "。已停止常规导出，避免把损坏记录导出成空白；请使用救援导出保留原文。");
      error.code = "EXPORT_CORRUPTED";
      error.corrupted = data.corrupted;
      throw error;
    }
    const out = {
      app: APP_ID, version: 3, exportedAt: new Date().toISOString(),
      activeBook: currentBookId, books: data.books
    };
    if (data.warnings.length) out.warnings = data.warnings.map(w => ({id: w.id, name: w.name, reason: w.reason}));
    return out;
  }
  /** 救援导出：正常词书 + 损坏词书的原始文本；该文件明确标记为不可直接导入。 */
  function buildRescueExport(){
    const data = collectExportData();
    return {
      app: APP_ID, version: 3, exportedAt: new Date().toISOString(),
      activeBook: currentBookId, rescue: true, books: data.books,
      damaged: Object.fromEntries(data.corrupted.map(c => [c.id, {
        name: c.name, state: c.raw, proficient: c.proficient, error: c.error
      }])),
      warnings: data.warnings.map(w => ({id: w.id, name: w.name, reason: w.reason}))
    };
  }

  function validateBackupEnvelope(o){
    if (!isRecord(o)) throw new Error("备份内容不是对象");
    if (o.version === 2 || o.version === 3) {
      if (o.app !== APP_ID) throw new Error("不是本应用的进度备份（应用标识不匹配）");
      if (o.rescue) throw new Error("这是救援导出，包含损坏原文，不能直接导入；请先修复或重新导出正常备份");
      if (!isRecord(o.books)) throw new Error("备份缺少词书记录");
      return o.version;
    }
    if (o.version === undefined || o.version === 1) {
      if (o.app !== undefined && o.app !== APP_ID) throw new Error("不是本应用的进度备份（应用标识不匹配）");
      if (isRecord(o.books)) throw new Error("备份版本与内容不一致");
      return 1;
    }
    throw new Error("不支持的备份版本");
  }
  function stateHasRecoverableContent(raw, state){
    const has = o => isRecord(o) && Object.keys(o).length > 0;
    if (has(raw.progress) || has(raw.stars) || has(raw.proficient)) return true;
    if (isRecord(raw.days) && Object.values(raw.days).some(d => d && ((d.r || 0) > 0 || (d.n || 0) > 0))) return true;
    if (nonnegative(raw.timeSec) && raw.timeSec > 0) return true;
    // 只把显式改过的设置视为可恢复内容；默认设置的空备份仍然拒绝。
    if (isRecord(raw.settings)) {
      for (const [key, value] of Object.entries(raw.settings)) {
        if (JSON.stringify(value) !== JSON.stringify(DEF.settings[key])) return true;
      }
    }
    return !!(state && (Object.keys(state.progress || {}).length || Object.keys(state.stars || {}).length
      || Object.keys(state.proficient || {}).length));
  }
  function backupLearnedCount(state){
    return Object.values(state.progress || {}).filter(p => Array.isArray(p) && p[4] > 0).length;
  }
  function backupMasteredCount(state){
    return Object.values(state.progress || {}).filter(p => Array.isArray(p) && p[0] >= MASTER).length;
  }
  /** 导入前摘要：完整校验但不写入任何存储，用于展示备份时间、各书记录量与替换范围。 */
  function prepareImportPlan(o){
    const version = validateBackupEnvelope(o);
    if (version === 1) {
      const state = normalizeState(o, "kaoyan");
      if (!stateHasRecoverableContent(o, state)) throw new Error("备份中没有可恢复的学习记录");
      return {
        kind: "legacy", version: 1, exportedAt: null, activeBook: "kaoyan",
        books: [{id: "kaoyan", name: BOOKS.kaoyan.name, learned: backupLearnedCount(state),
          mastered: backupMasteredCount(state)}]
      };
    }
    const books = [], seen = new Set();
    for (const [id, raw] of Object.entries(o.books)) {
      const book = bookOf(id);
      if (!book || !book.available || seen.has(id)) continue;
      seen.add(id);
      const state = normalizeState(raw, id);
      books.push({id: id, name: book.name, learned: backupLearnedCount(state),
        mastered: backupMasteredCount(state), raw: raw});
    }
    if (!books.length) throw new Error("备份中没有可用于当前版本的词书记录");
    if (!books.some(b => stateHasRecoverableContent(b.raw, normalizeState(b.raw, b.id)))) {
      throw new Error("备份中没有可恢复的学习记录");
    }
    return {
      kind: "books", version: version,
      exportedAt: (typeof o.exportedAt === "string" && !Number.isNaN(Date.parse(o.exportedAt))) ? o.exportedAt : null,
      activeBook: (typeof o.activeBook === "string" && bookOf(o.activeBook) && BOOKS[o.activeBook].available) ? o.activeBook : null,
      books: books
    };
  }

  function captureStorageKeys(ids){
    const keys = {};
    for (const id of ids) {
      const book = BOOKS[id];
      if (!book) continue;
      keys[book.KEY] = localStorage.getItem(book.KEY);
      keys[book.PROF_KEY] = localStorage.getItem(book.PROF_KEY);
    }
    keys[ACTIVE_KEY] = localStorage.getItem(ACTIVE_KEY);
    return keys;
  }
  function beginImportJournal(ids){
    try {
      if (localStorage.getItem(JOURNAL_KEY)) {
        throw new Error("发现上次未完成的导入恢复点，请先在页面提示中恢复导入前记录，再重新导入");
      }
    } catch (e) {
      if (e && e.message && e.message.includes("恢复点")) throw e;
      throw new Error("浏览器存储不可用，导入未开始，现有记录未改动");
    }
    const originals = captureStorageKeys(ids);
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify({at: new Date().toISOString(), keys: originals})); }
    catch (e) { throw new Error("无法创建导入恢复点（浏览器存储空间不足），导入未开始，现有记录未改动"); }
    return originals;
  }
  function rollbackImportJournal(originals){
    try {
      for (const [key, value] of Object.entries(originals)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.removeItem(JOURNAL_KEY);
      return true;
    } catch (e) { return false; }
  }
  function endImportJournal(){
    try { localStorage.removeItem(JOURNAL_KEY); } catch (e) { /* ignore */ }
  }
  function recoverImportJournal(){
    let journal;
    try {
      const raw = localStorage.getItem(JOURNAL_KEY);
      journal = raw ? JSON.parse(raw) : null;
      if (!journal || !isRecord(journal.keys)) throw new Error("恢复日志格式不正确");
      for (const [key, value] of Object.entries(journal.keys)) {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.removeItem(JOURNAL_KEY);
    } catch (e) {
      showAlert("导入恢复失败", "恢复日志无法读取或写入：" + (e.message || "存储不可用") + "。请不要继续导入，先导出救援备份。", {kind: "import"});
      return false;
    }
    try {
      currentBookId = pickActiveBook(localStorage.getItem(ACTIVE_KEY));
    } catch (e) { /* 保持当前书 */ }
    const active = currentBook();
    KEY = active.KEY; PROF_KEY = active.PROF_KEY; SURVEY_KEY = active.SURVEY_KEY;
    W = active.words; wordIndex = active.wordIndex;
    load();
    bindSet(); restoreListUi(currentBookId); applyFilter(false); renderStats(); startSession();
    updateBar(); renderBookList(); applyBrand();
    clearAlert("import");
    toast("已恢复上次导入前的记录");
    return true;
  }
  function importFailureMessage(error, names){
    return (error && error.message ? error.message : "导入未完成")
      + (names && names.length ? "（受影响词书：" + names.join("、") + "）" : "");
  }
  function importCommittedState(entries, o){
    const failed = [];
    for (const entry of entries) {
      const id = entry.id, state = entry.state;
      if (id === currentBookId) {
        try { syncProficientFromStorage(); } catch (e) { /* 保留当前可用名单 */ }
        state.proficient = Object.assign({}, S.proficient, state.proficient);
        S = state;
        blockedBooks.delete(id);
        if (!save(true, true)) failed.push(id);
      } else {
        const existing = getBookState(id) || freshState(BOOKS[id]);
        try { existing.proficient = readBookProficient(BOOKS[id], existing.proficient); } catch (e) { /* ignore */ }
        state.proficient = Object.assign({}, existing.proficient, state.proficient);
        if (!writeBookState(id, state)) failed.push(id);
      }
    }
    if (failed.length) throw new Error(importFailureMessage(new Error("导入未能全部保存"), failed.map(id => BOOKS[id].name)));
    const target = (typeof o.activeBook === "string"
      && bookOf(o.activeBook) && BOOKS[o.activeBook].available) ? o.activeBook : null;
    if (target && target !== currentBookId) switchBook(target, {carry: false, silent: true});
    else {
      bindSet(); applyFilter(false); renderStats(); startSession(); updateBar();
      if (activeSheet) closeSheet();
      renderBookList();
    }
    endImportJournal();
    toast("进度已导入（备份中词书的记录已恢复，原有熟练标记已保留）");
    return S;
  }
  /** 导入旧版（v1 平铺）备份：固定按考研书解析，替换考研学习记录、保留考研已有熟练标记 */
  function importLegacyV1(o){
    validateBackupEnvelope(o);
    const imported = normalizeState(o, "kaoyan");
    if (!stateHasRecoverableContent(o, imported)) throw new Error("备份中没有可恢复的学习记录");
    const originals = beginImportJournal(["kaoyan"]);
    const beforeS = JSON.parse(JSON.stringify(S));
    const beforeBook = currentBookId;
    const beforeBlocked = new Set(blockedBooks);
    const beforeRaw = lastMainRaw;
    const beforeSig = lastSavedSignature;
    const beforeStorageOK = storageOK;
    const beforePending = snapshotPendingProf();
    try {
      if (currentBookId === "kaoyan") {
        // Importing an older backup cannot silently undo permanent manual exclusions.
        try { syncProficientFromStorage(); } catch (e) { /* keep memory */ }
        imported.proficient = Object.assign({}, S.proficient, imported.proficient);
        S = imported;
        blockedBooks.delete(currentBookId);
        if (!save(true, true)) throw new Error("考研记录未能保存");
        bindSet(); applyFilter(false); renderStats(); startSession();
        if (activeSheet) closeSheet();
        renderBookList();
      } else {
        // 当前在四/六级：只恢复考研书，不强制切书
        const existing = getBookState("kaoyan") || freshState(BOOKS.kaoyan);
        try { existing.proficient = readBookProficient(BOOKS.kaoyan, existing.proficient); } catch (e) { /* ignore */ }
        imported.proficient = Object.assign({}, existing.proficient, imported.proficient);
        if (!writeBookState("kaoyan", imported)) throw new Error("考研记录未能保存");
        if (activeSheet) closeSheet();
        renderBookList();
      }
      endImportJournal();
      toast("进度已导入（原有熟练标记已保留）");
      return S;
    } catch (err) {
      if (rollbackImportJournal(originals)) {
        S = beforeS; currentBookId = beforeBook;
        blockedBooks.clear(); beforeBlocked.forEach(id => blockedBooks.add(id));
        lastMainRaw = beforeRaw; lastSavedSignature = beforeSig;
        storageOK = beforeStorageOK;
        restorePendingProf(beforePending);
        KEY = BOOKS[currentBookId].KEY; PROF_KEY = BOOKS[currentBookId].PROF_KEY;
        SURVEY_KEY = BOOKS[currentBookId].SURVEY_KEY;
        W = BOOKS[currentBookId].words; wordIndex = BOOKS[currentBookId].wordIndex;
        bindSet(); applyFilter(false); renderStats(); startSession(); updateBar(); renderBookList();
        throw new Error(err.message + "；已回滚到导入前记录");
      }
      throw new Error("导入中断且自动回滚失败；恢复日志与损坏原文已保留，请立即导出救援备份");
    }
  }
  /**
   * 导入 v2/v3 全量备份：先整份校验，任一非法整份拒绝；建立恢复点后逐本合入，
   * 任一写入失败即整体回滚。activeBook 合法则切换。v2（无 dv）按 v1 逐书迁移后再校验。
   */
  function importBooksBackup(o){
    validateBackupEnvelope(o);
    const entries = [];
    let hasContent = false;
    for (const [id, raw] of Object.entries(o.books)) {
      const book = bookOf(id);
      if (!book || !book.available) continue;
      const state = normalizeState(raw, id);   // 任一非法直接抛错，零改动
      if (stateHasRecoverableContent(raw, state)) hasContent = true;
      entries.push({id: id, state: state});
    }
    if (!entries.length) throw new Error("备份中没有可用于当前版本的词书记录");
    if (!hasContent) throw new Error("备份中没有可恢复的学习记录");
    const originals = beginImportJournal(entries.map(e => e.id));
    const beforeS = JSON.parse(JSON.stringify(S));
    const beforeBook = currentBookId;
    const beforeBlocked = new Set(blockedBooks);
    const beforeRaw = lastMainRaw;
    const beforeSig = lastSavedSignature;
    const beforeStorageOK = storageOK;
    const beforePending = snapshotPendingProf();
    try {
      return importCommittedState(entries, o);
    } catch (err) {
      const rolled = rollbackImportJournal(originals);
      if (rolled) {
        S = beforeS;
        if (currentBookId !== beforeBook) {
          currentBookId = beforeBook;
          const book = currentBook();
          KEY = book.KEY; PROF_KEY = book.PROF_KEY; SURVEY_KEY = book.SURVEY_KEY;
          W = book.words; wordIndex = book.wordIndex;
        }
        blockedBooks.clear(); beforeBlocked.forEach(id => blockedBooks.add(id));
        lastMainRaw = beforeRaw; lastSavedSignature = beforeSig;
        storageOK = beforeStorageOK;
        restorePendingProf(beforePending);
        bindSet(); applyFilter(false); renderStats(); startSession(); updateBar(); renderBookList();
        throw new Error(err.message + "；已回滚到导入前记录");
      }
      throw new Error("导入中断且自动回滚失败；恢复日志与损坏原文已保留，请立即导出救援备份");
    }
  }


  function isStar(i){ return !!(S.stars && S.stars[i]); }
  function toggleStar(i){
    S.stars = S.stars || {};
    if (S.stars[i]) delete S.stars[i]; else S.stars[i] = 1;
    save();
  }
  function streak(){
    const d = new Date(); let n = 0;
    for (let k = 0; k <= Object.keys(S.days).length; k++) {
      const rec = S.days[todayStr(d)];
      if (rec && rec.r > 0) n++;
      else if (k > 0) break;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }
  function fmtTime(sec){
    sec = sec || 0;
    const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60);
    return h ? h + " 小时 " + m + " 分" : m + " 分钟";
  }
  function day(){
    const k = todayStr();
    if (!S.days[k]) S.days[k] = {n:0, r:0, ok:0, no:0};
    return S.days[k];
  }
  function st(i){ return S.progress[i]; }
  /**
   * 主学习过的判据：p[4] 是主判定时间。特训可为未学词建立 [0,0,0,错次,0]
   * 占位记录，它只属于错词本，不应算新词额度、应继续按新词入队。
   */
  function hasMainProgress(p){ return !!p && p[4] > 0; }
  function isMainLearned(i){ return hasMainProgress(st(i)); }
  function isMastered(i){ const p = st(i); return p && p[0] >= MASTER; }
  function isProficient(i){ return !!(W[i] && Object.prototype.hasOwnProperty.call(S.proficient, W[i].w)); }
  function proficientCount(){ return Object.keys(S.proficient).length; }

  /* ================= 乱序随机抽样 · 掌握率估计 ================= */
  /**
   * 乱序模式下新词按随机顺序出现，每张首次作答的新词卡相当于一次随机抽查：
   * 答「会」记为已掌握、答「不会」记为未掌握，用样本比例估计当前背诵范围的掌握率。
   * 样本按单词文本存储（不随词库数组顺序/数据版本迁移），每本书独立。
   */
  function wilsonInterval(k, n, z){
    z = z || 1.96;
    if (!(n > 0)) return {rate: 0, lo: 0, hi: 0};
    const p = k / n, z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
    return {rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half)};
  }
  /** 读取某本书的抽样记录；词库已清理的旧词直接忽略，损坏记录按空样本处理。 */
  function readSurvey(book){
    const out = {};
    try {
      const raw = localStorage.getItem(book.SURVEY_KEY);
      if (!raw) return out;
      const o = JSON.parse(raw);
      if (!isRecord(o)) return out;
      for (const [w, v] of Object.entries(o)) {
        if (typeof w !== "string" || !book.wordIndex.has(w)) continue;
        if (v === 1 || v === true) out[w] = 1;
        else if (v === 0 || v === false) out[w] = 0;
      }
    } catch (e) { /* 抽样记录损坏不影响主进度 */ }
    return out;
  }
  function loadSurvey(){
    SURVEY = readSurvey(currentBook());
    lastSurvey = Object.assign({}, SURVEY);
  }
  function saveSurvey(){
    try {
      // storage 事件可能尚未送达；只写本标签修改过的词，保留其它标签的新样本。
      const merged = readSurvey(currentBook());
      for (const w of new Set([...Object.keys(lastSurvey), ...Object.keys(SURVEY)])) {
        if (SURVEY[w] === lastSurvey[w]) continue;
        if (Object.prototype.hasOwnProperty.call(SURVEY, w)) merged[w] = SURVEY[w];
        else delete merged[w];
      }
      localStorage.setItem(SURVEY_KEY, JSON.stringify(merged));
      SURVEY = merged;
      lastSurvey = Object.assign({}, merged);
      return true;
    }
    catch (e) { return false; }
  }
  function surveyStats(){
    let n = 0, k = 0;
    for (const [w, v] of Object.entries(SURVEY)) {
      if (!wordIndex.has(w)) continue;
      n++;
      if (v) k++;
    }
    const ci = wilsonInterval(k, n);
    return {n: n, k: k, missed: n - k, rate: ci.rate, lo: ci.lo, hi: ci.hi,
      margin: (ci.hi - ci.lo) / 2};
  }
  function surveyPct(x){ return Math.round(x * 100) + "%"; }
  /** 只统计乱序模式下第一次出现的词；复习/特训/其它顺序都不计入，避免抽样偏差。 */
  function recordSurvey(i, known){
    if (drillMode || S.settings.order !== "shuffle") return false;
    const w = W[i] && W[i].w;
    if (!w || !wordIndex.has(w)) return false;
    const next = known ? 1 : 0;
    if (SURVEY[w] === next) return false;
    SURVEY[w] = next;
    saveSurvey();
    return true;
  }
  function resetSurvey(){
    SURVEY = {};
    lastSurvey = {};
    try { localStorage.removeItem(SURVEY_KEY); } catch (e) { /* ignore */ }
    renderSurvey();
  }
  /** 统计条 chip（仅乱序模式显示）与统计页面板共用同一份实时估计。 */
  function renderSurvey(){
    const stats = surveyStats();
    const chip = $("#surveyChip");
    if (chip) {
      const show = S.settings.order === "shuffle";
      chip.hidden = !show;
      if (show) {
        const val = $("#s-survey"), ci = $("#s-survey-ci");
        if (val) val.textContent = stats.n ? surveyPct(stats.rate) : "—";
        if (ci) ci.textContent = stats.n ? "95% 区间 " + surveyPct(stats.lo) + "–" + surveyPct(stats.hi) : "";
        chip.title = stats.n
          ? "历史首次自评样本：已记录 " + stats.n + " 词（首次就会 " + stats.k + " / 不会 " + stats.missed +
            "）；95% 置信区间 " + surveyPct(stats.lo) + "–" + surveyPct(stats.hi) +
            "。只含各次乱序学习中首次作答的新词，筛选范围可能已经变化，不代表当前范围或全书掌握率。"
          : "乱序模式下首次作答的新词会留下自评样本；这里展示历史样本的描述性统计，不代表全书掌握率。";
      }
    }
    const kpis = $("#surveyKpis");
    if (kpis) {
      kpis.innerHTML = stats.n
        ? [[surveyPct(stats.rate), "历史首次就会"],
           [surveyPct(stats.lo) + "–" + surveyPct(stats.hi), "95% 置信区间"],
           [stats.n + " 词", "历史样本"]]
            .map(([a, b]) => '<div class="kpi"><b>' + a + "</b><span>" + b + "</span></div>").join("")
        : '<div class="kpi"><b>—</b><span>还没有历史样本</span></div>';
    }
    const gauge = $("#surveyGauge");
    if (gauge) {
      const axis = '<div class="sg-axis"><span>0%</span><span>50%</span><span>100%</span></div>';
      gauge.innerHTML = stats.n
        ? axis +
          '<div class="sg-track" role="img" aria-label="历史首次自评比例 ' + surveyPct(stats.rate) +
            "，95% 置信区间 " + surveyPct(stats.lo) + " 到 " + surveyPct(stats.hi) + '">' +
            '<i class="sg-band" style="left:' + (stats.lo * 100) + "%;width:" + ((stats.hi - stats.lo) * 100) + '%"></i>' +
            '<b class="sg-dot" style="left:clamp(6px,' + (stats.rate * 100) + '%,calc(100% - 6px))"></b>' +
          "</div>" +
          '<div class="sg-note">实心点 = 样本估计 · 色带 = 95% 置信区间</div>'
        : axis + '<div class="sg-track sg-empty"></div><div class="sg-note">还没有样本可绘制区间</div>';
    }
    const hint = $("#surveyHint");
    if (hint) {
      const mode = S.settings.order === "shuffle";
      hint.textContent = !stats.n
        ? (mode
            ? "乱序模式首次作答的新词会留下自评样本。这里只描述你实际抽到过的词，样本范围随当时筛选变化，不代表当前范围或全书掌握率。"
            : "当前不是乱序模式。切到「乱序」后，首次作答的新词才会留下历史自评样本。")
        : (!mode
            ? "历史样本：" + stats.n + " 词，其中 " + stats.k + " 词首次就会。当前不是乱序模式，样本不再增加；切回「乱序」可继续累计。"
            : "历史样本：" + stats.n + " 词，其中 " + stats.k + " 词首次就会、" + stats.missed +
              " 词不会。这些词来自不同时间的乱序筛选，不能外推为当前范围或全书掌握率；复习与错词特训不计入。");
    }
  }

  /** A manual, permanent exclusion, independent of the spaced-repetition stage. */
  function setProficient(i, value){
    if (storageOK) { try { syncProficientFromStorage(); } catch (e) {} }
    if (!W[i] || isProficient(i) === !!value) return;
    const word = W[i].w;
    if (value) {
      S.proficient[word] = Date.now();
      markProfPending(currentBookId, word, true, S.proficient[word]);
      if (cur === i && phase === "revealed") qi++;
      Q = Q.slice(0, qi).concat(Q.slice(qi).filter(k => k !== i));
      undoStack = [];
      // 主会话在特训期间暂停；其旧撤销记录同样不能再指向已熟练的词。
      if (mainSnap) mainSnap.undoStack = [];
      if (cur === i) nextCard();
    } else {
      delete S.proficient[word];
      markProfPending(currentBookId, word, false);
      // Keep its previous review schedule. The next session will include it when due.
      undoStack = [];
    }
    const saved = save(true);
    renderCard(); updateScopeCount(); syncFreqControls(); applyFilter(false); renderStats(); updateBar();
    toast(saved ? (value ? "已移出背诵与复习；可在词表筛选「熟练」后取消" : "已取消熟练，下组将按原进度安排学习")
      : "熟练状态已更新，但未能保存；请立即导出进度备份");
  }
  function resetProficient(){
    for (const word of Object.keys(S.proficient)) markProfPending(currentBookId, word, false);
    S.proficient = {};
    const saved = save(true);
    startSession(); updateScopeCount(); syncFreqControls(); applyFilter(); renderStats(); updateBar();
    toast(saved ? "已清空熟练标记，按原进度恢复学习" : "已清空熟练标记，但未能保存；请导出备份");
  }

  /* ================= DOM ================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }

  /* ================= 例句点词查义 ================= */
  /** 例句切成「英文词 / 其它」片段，英文词可点击 */
  function exTokens(text){
    return String(text == null ? "" : text)
      .split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/g)
      .filter(s => s !== "");
  }
  /** 当前词与词典明确给出的屈折词形；不借助查词回退猜测派生词。 */
  function exampleWordForms(currentWord){
    const word = typeof currentWord === "string" ? currentWord : currentWord && currentWord.w;
    const base = String(word || "").toLowerCase();
    const entry = typeof currentWord === "string" ? W[wordIndex.get(base)] : currentWord;
    const forms = new Set(/^[a-z]+$/.test(base) ? [base] : []);
    for (const field of String(entry && entry.fm || "").split(/[；;]/)) {
      const match = field.trim().match(/^(?:复数|过去式|过去分词|现在分词|第三人称单数|比较级|最高级)\s+([a-z]+(?:\s*\/\s*[a-z]+)*)$/i);
      if (match) for (const form of match[1].split("/")) forms.add(form.trim().toLowerCase());
    }
    return forms;
  }
  /** 例句来源徽标：真题（可跨词书）/ 自编 / 词典。 */
  function srcBadge(src){
    const s=String(src||"");
    if(!s) return "例句";
    if(s==="自编"||s==="自编例句") return "自编例句";
    if(s==="词典例句") return "词典例句";
    return "真题例句 · "+s;
  }
  /** 例句 → 可点词 HTML；当前词及其已知词形用 strong 强调，其余原样转义。 */
  function exHtml(text, currentWord){
    const forms = exampleWordForms(currentWord);
    const lemma = String((typeof currentWord === "string" ? currentWord : currentWord && currentWord.w) || "").toLowerCase();
    return exTokens(text).map(part => {
      if (/^[A-Za-z]/.test(part)) {
        const current = forms.has(part.toLowerCase());
        // 例句整体只有一个键盘入口；词本身不再各占一个 Tab 停靠点。
        return '<span class="ex-word' + (current ? " ex-current" : "") + '" data-exw="' + esc(part) + '" tabindex="-1"'
          + (current ? ' data-exlemma="' + esc(lemma) + '"' : "") + '>'
          + (current ? "<strong>" + esc(part) + "</strong>" : esc(part)) + "</span>";
      }
      return esc(part);
    }).join("");
  }
  /* 可选义项证据：始终按词书与单词文本读取，不接触学习记录或进度下标。 */
  function wordSenseEntry(x){
    const data = window.WORD_SENSES;
    const object = v => v && typeof v === "object" && !Array.isArray(v);
    const own = (v, key) => object(v) && Object.prototype.hasOwnProperty.call(v, key);
    if (!x || typeof x.w !== "string" || !object(data) || data.schemaVersion !== 1
        || !own(data.books, currentBookId) || !own(data.books[currentBookId], x.w)) return null;
    const entry = data.books[currentBookId][x.w];
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
  /** 真题语境义与词典补充分别显示；无有效证据文件时完整降级到原释义。 */
  function meaningHtml(x, compact = false){
    const entry = wordSenseEntry(x);
    if (!entry) {
      return '<div class="sense-dictionary">' + esc(x.m || "（暂无词典释义，请参考例句）") + '</div>'
        + '<p class="sense-note">释义已按真题考义整理；例句点词可查义。</p>';
    }
    if (compact) {
      return '<div class="sense-popup">' + entry.preferred.map(s => esc(s.meaning)).join("；") + '</div>'
        + '<p class="sense-note">本书真题已核对义项优先；原句与其他释义见详情。</p>';
    }
    const preferred = entry.preferred.map(sense =>
      '<li class="sense-item"><div class="sense-meaning">' + esc(sense.meaning) + '</div>'
      + '<details class="sense-evidence"><summary>查看原句与出处</summary>'
      + sense.examples.map(example => '<div class="sense-example" data-ex-linked="1">'
        + '<p class="sense-quote" lang="en" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">' + exHtml(example.quote, x) + '</p>'
        + '<p class="sense-source">' + esc(example.label || example.source) + '</p></div>').join("")
      + '</details></li>'
    ).join("");
    const additional = entry.additional.trim()
      ? '<details class="sense-additional"><summary>其他词典释义</summary>'
        + '<div class="sense-additional-meaning">' + esc(entry.additional) + '</div>'
        + '<p class="sense-note">这些释义尚未逐义核验，不代表历年真题未考。</p></details>' : "";
    return '<div class="sense-block"><p class="sense-label">本书真题已核对义项</p>'
      + '<ol class="sense-preferred">' + preferred + '</ol>' + additional
      + '<p class="sense-note">按已核对原句前置，仅覆盖所列语境；尚未穷尽历年全部用法。</p></div>';
  }
  /** 轻量屈折还原后在词库中找词，找不到返回 -1 */
  function lookupExWord(token){
    let w = String(token == null ? "" : token).toLowerCase().replace(/[’]/g, "'");
    if (!w) return -1;
    const tryWords = [];
    const push = (x) => { if (x && tryWords.indexOf(x) < 0) tryWords.push(x); };
    push(w);
    push(w.replace(/'s$/, "").replace(/s'$/, "s"));
    // 常见后缀回退（词库以原形为主）
    if (/(ies)$/.test(w)) push(w.replace(/ies$/, "y"));
    if (/(es)$/.test(w)) { push(w.replace(/es$/, "")); push(w.replace(/es$/, "e")); }
    if (/(s)$/.test(w) && !/(ss)$/.test(w)) push(w.replace(/s$/, ""));
    if (/(ed)$/.test(w)) {
      push(w.replace(/ed$/, ""));
      push(w.replace(/ed$/, "e"));
      push(w.replace(/ied$/, "y"));
    }
    if (/(ing)$/.test(w)) {
      push(w.replace(/ing$/, ""));
      push(w.replace(/ing$/, "e"));
      push(w.replace(/ying$/, "ie"));
    }
    if (/(ly)$/.test(w)) push(w.replace(/ly$/, ""));
    if (/(er)$/.test(w)) { push(w.replace(/er$/, "")); push(w.replace(/er$/, "e")); }
    if (/(est)$/.test(w)) { push(w.replace(/est$/, "")); push(w.replace(/est$/, "e")); }
    for (let i = 0; i < tryWords.length; i++) {
      const hit = wordIndex.get(tryWords[i]);
      if (hit != null) return hit;
    }
    return -1;
  }
  let exPopReturn = null;
  function exContainerOf(el){
    return el && el.closest ? el.closest("[data-ex-linked]") : null;
  }
  function setExActive(container, wordEl){
    if (!container || !container.querySelectorAll) return;
    const words = Array.from(container.querySelectorAll(".ex-word"));
    for (const word of words) word.classList.toggle("ex-active", word === wordEl);
    if (wordEl) {
      container.setAttribute?.("aria-label", "例句，当前选中 " + (wordEl.getAttribute?.("data-exw") || wordEl.textContent)
        + "，左右方向键选词，回车查义");
    }
  }
  /** 例句查词浮层：键盘入口在整句，打开后焦点进入浮层，Esc 回到触发词。 */
  function showExPop(token, anchor){
    const pop = $("#exPop");
    if (!pop) return;
    // 高亮词已由该词条的明确词形生成，直接沿用其原形，支持 took/canned 等变化。
    const lemmaIndex = typeof anchor?.dataset?.exlemma === "string" ? wordIndex.get(anchor.dataset.exlemma) : undefined;
    const i = lemmaIndex === undefined ? lookupExWord(token) : lemmaIndex;
    const raw = String(token == null ? "" : token);
    const trigger = exContainerOf(anchor);
    exPopReturn = trigger ? {trigger: trigger, word: anchor} : null;
    if (trigger) trigger.setAttribute?.("aria-expanded", "true");
    if (i < 0) {
      pop.innerHTML =
        '<div class="ex-pop-w">' + esc(raw) + "</div>" +
        '<div class="ex-pop-m">词库未收录该词</div>';
    } else {
      const x = W[i];
      pop.innerHTML =
        '<div class="ex-pop-w">' + esc(x.w) +
          (x.ph ? ' <span class="ex-pop-ph">/' + esc(x.ph) + "/</span>" : "") +
        "</div>" +
        '<div class="ex-pop-m">' + meaningHtml(x, true) + "</div>" +
        '<div class="ex-pop-meta">词频 #' + x.r + " · " + x.f + " 次 / " + x.c + " 套卷</div>" +
        '<div class="ex-pop-acts">' +
          '<button type="button" class="btn ghost sm" id="exPopDetail">详情</button>' +
          '<button type="button" class="btn ghost sm" id="exPopSpeak" aria-label="发音">♪</button>' +
        "</div>";
      const detailBtn = pop.querySelector("#exPopDetail");
      if (detailBtn) detailBtn.onclick = (e) => {
        e.stopPropagation();
        hideExPop();
        openWord(i);
      };
      const spkBtn = pop.querySelector("#exPopSpeak");
      if (spkBtn) spkBtn.onclick = (e) => {
        e.stopPropagation();
        speak(x.w);
      };
    }
    pop.hidden = false;
    pop.classList.add("on");
    pop.setAttribute?.("aria-expanded", "true");
    // 就近定位（失败则居中偏下）
    try {
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      if (r && r.width) {
        const pw = pop.offsetWidth || 240;
        const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), (window.innerWidth || 900) - pw - 8);
        const top = (r.bottom + 8 + (pop.offsetHeight || 120) < (window.innerHeight || 700))
          ? r.bottom + 8
          : Math.max(8, r.top - (pop.offsetHeight || 120) - 8);
        pop.style.left = left + "px";
        pop.style.top = top + "px";
        pop.style.transform = "none";
      } else {
        pop.style.left = "50%";
        pop.style.top = "40%";
        pop.style.transform = "translate(-50%, 0)";
      }
    } catch (_) {
      pop.style.left = "50%";
      pop.style.top = "40%";
      pop.style.transform = "translate(-50%, 0)";
    }
    pop.focus?.({ preventScroll: true });
  }
  function hideExPop(restoreFocus){
    const pop = $("#exPop");
    if (!pop) return;
    const previous = exPopReturn;
    exPopReturn = null;
    pop.hidden = true;
    pop.classList.remove("on");
    pop.setAttribute?.("aria-expanded", "false");
    if (previous && previous.trigger) previous.trigger.setAttribute?.("aria-expanded", "false");
    if (restoreFocus && previous && previous.trigger) {
      setExActive(previous.trigger, previous.word);
      const target = previous.word && previous.word.isConnected !== false ? previous.word : previous.trigger;
      target.focus?.({ preventScroll: true });
    }
  }
  function bindExLookup(root){
    if (!root || root.__exLookupBound) return;
    root.__exLookupBound = true;
    root.addEventListener("click", (e) => {
      const t = e.target;
      const wordEl = t && t.closest ? t.closest(".ex-word") : null;
      if (!wordEl) return;
      e.preventDefault();
      e.stopPropagation();
      const container = exContainerOf(wordEl);
      if (container) setExActive(container, wordEl);
      showExPop(wordEl.getAttribute("data-exw") || wordEl.textContent, wordEl);
    });
    root.addEventListener("focusin", (e) => {
      const container = exContainerOf(e.target);
      if (!container || (root.contains && !root.contains(container))) return;
      const wordEl = e.target.closest ? e.target.closest(".ex-word") : null;
      if (wordEl) setExActive(container, wordEl);
      else {
        const first = container.querySelector(".ex-word");
        if (first && !container.querySelector(".ex-word.ex-active")) setExActive(container, first);
      }
    });
    root.addEventListener("keydown", (e) => {
      const container = exContainerOf(e.target);
      if (!container) return;
      const words = Array.from(container.querySelectorAll ? container.querySelectorAll(".ex-word") : []);
      if (!words.length) return;
      const active = container.querySelector(".ex-word.ex-active");
      let index = words.indexOf(active);
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Home") index = 0;
        else if (e.key === "End") index = words.length - 1;
        else if (index < 0) index = 0;
        else index = (index + (e.key === "ArrowRight" ? 1 : -1) + words.length) % words.length;
        setExActive(container, words[index]);
        words[index].focus?.({ preventScroll: true });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const wordEl = active || words[0];
        setExActive(container, wordEl);
        showExPop(wordEl.getAttribute("data-exw") || wordEl.textContent, wordEl);
        return;
      }
      if (e.key === "Escape" && !$("#exPop").hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideExPop(true);
      }
    });
  }

  /* ================= 主题 ================= */
  function applyTheme(){
    const t = S.settings.theme || "auto";
    const sysDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const dark = (t === "dark") || (t === "auto" && sysDark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const themeColor = $('meta[name="theme-color"]');
    themeColor?.setAttribute?.("content", dark ? "#1B1916" : "#F6F3ED");
    $$("#themeSeg button").forEach(b => {
      b.classList.toggle("on", b.dataset.theme === t);
      b.setAttribute?.("aria-pressed", String(b.dataset.theme === t));
    });
  }
  try {
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if ((S.settings.theme || "auto") === "auto") applyTheme();
      });
    }
  } catch (e) {}

  /* ================= 词库筛选 ================= */
  function passBaseFilters(x){
    const s = S.settings;
    if (s.pmin && x.c < s.pmin) return false;
    if (s.kyOnly && x.ky !== 1) return false;
    const sel = s.pos || [];
    if (sel.length) {
      let hit = false;
      for (const k of sel) {
        if (k === "x") { if (![0,1,2,3].includes(x.p)) hit = true; }
        else if (POSMAP[k] && POSMAP[k].includes(x.p)) hit = true;
        if (hit) break;
      }
      if (!hit) return false;
    }
    return true;
  }
  function inScope(i){
    const x = W[i], s = S.settings;
    if (x.f < (s.fmin || 1)) return false;
    if (s.fmax && x.f > s.fmax) return false;
    return passBaseFilters(x);
  }

  /* ================= 词频分布曲线 + 双端滑块 ================= */
  const FREQ_BINS = 20;
  const FREQ_POS_MAX = 1000;
  function bookMaxFreq(){
    let m = 1;
    for (let i = 0; i < W.length; i++) {
      const f = W[i].f;
      if (f > m) m = f;
    }
    return m;
  }
  /** 对数刻度：1 次在最左，maxF 次在最右 */
  function freqToPos(f, maxF){
    maxF = Math.max(1, maxF || 1);
    if (maxF <= 1) return 0;
    const v = Math.max(1, Math.min(maxF, +f || 1));
    return Math.round(Math.log(v) / Math.log(maxF) * FREQ_POS_MAX);
  }
  /** 1000 = 不限（仅上界）；下界 1000 = maxF */
  function posToFreq(pos, maxF, unlimited){
    pos = Math.max(0, Math.min(FREQ_POS_MAX, Math.round(+pos || 0)));
    if (unlimited && pos >= FREQ_POS_MAX) return 0;
    maxF = Math.max(1, maxF || 1);
    if (maxF <= 1) return 1;
    return Math.max(1, Math.min(maxF, Math.round(Math.pow(maxF, pos / FREQ_POS_MAX))));
  }
  function freqBinLayout(){
    const maxF = bookMaxFreq();
    const B = Math.max(1, Math.min(FREQ_BINS, maxF));
    const bnd = [1];
    for (let b = 1; b <= B; b++) {
      bnd[b] = Math.min(maxF, Math.max(bnd[b - 1] + 1, Math.round(Math.pow(maxF, b / B))));
    }
    bnd[B] = maxF;
    return { maxF: maxF, B: B, bnd: bnd };
  }
  /** 只按套卷/大纲/词性过滤，不受词频区间影响，拖动滑块时柱形保持稳定 */
  function freqHistogram(){
    const layout = freqBinLayout();
    const bins = new Array(layout.B).fill(0);
    let total = 0;
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (!passBaseFilters(x)) continue;
      total++;
      let b = 0;
      while (b < layout.B - 1 && x.f >= layout.bnd[b + 1]) b++;
      bins[b]++;
    }
    return {
      maxF: layout.maxF,
      total: total,
      bins: bins.map((count, b) => ({
        count: count,
        lo: layout.bnd[b],
        hi: b === layout.B - 1 ? layout.maxF : layout.bnd[b + 1] - 1
      }))
    };
  }
  function renderFreqAxis(maxF){
    const el = $("#freqAxis");
    if (!el) return;
    const width = el.clientWidth || 600;
    const ticks = [1, maxF];
    const occupied = [];
    const addTick = f => {
      if (f < 1 || f > maxF || occupied.some(t => t.f === f)) return;
      const x = freqToPos(f, maxF) / FREQ_POS_MAX * width;
      const labelWidth = String(f).length * 7;
      const left = f === 1 ? 0 : f === maxF ? width - labelWidth : x - labelWidth / 2;
      const right = left + labelWidth;
      if (f !== 1 && f !== maxF && occupied.some(t => left < t.right + 10 && right > t.left - 10)) return;
      occupied.push({f, left, right});
    };
    ticks.forEach(addTick);
    // 优先保留低频端的 2、5 和十进位刻度，窄屏自动略去会重叠的次要标签。
    [2, 5, 10, 100, 1000, 10000, 20, 50, 200, 500, 2000, 5000].forEach(addTick);
    const uniq = occupied.map(t => t.f).sort((a, b) => a - b);
    el.innerHTML = uniq.map((f, i) => {
      const cls = i === 0 ? "at-start" : (i === uniq.length - 1 ? "at-end" : "");
      return '<span class="' + cls + '" data-freq="' + f + '" style="left:' + (freqToPos(f, maxF) / 10) + '%">' + f + "</span>";
    }).join("");
  }
  /** 单调三次插值：保留分布走势，不产生高于采样峰值或低于零的过冲。 */
  function freqCurvePath(points){
    const slopes = [], tangent = [];
    for (let i = 0; i < points.length - 1; i++) slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
    tangent[0] = slopes[0];
    tangent[points.length - 1] = slopes[slopes.length - 1];
    for (let i = 1; i < points.length - 1; i++) tangent[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
    for (let i = 0; i < slopes.length; i++) {
      if (!slopes[i]) { tangent[i] = tangent[i + 1] = 0; continue; }
      const a = tangent[i] / slopes[i], b = tangent[i + 1] / slopes[i];
      const length = Math.hypot(a, b);
      if (length > 3) { tangent[i] = 3 * a * slopes[i] / length; tangent[i + 1] = 3 * b * slopes[i] / length; }
    }
    const round = n => Math.round(n * 100) / 100;
    let path = "M" + round(points[0].x) + "," + round(points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1], dx = (q.x - p.x) / 3;
      path += " C" + round(p.x + dx) + "," + round(p.y + tangent[i] * dx) + " " + round(q.x - dx) + "," +
        round(q.y - tangent[i + 1] * dx) + " " + round(q.x) + "," + round(q.y);
    }
    return path;
  }
  function renderFreqHistogram(){
    const el = $("#freqBars");
    if (!el) return;
    const h = freqHistogram();
    // 按真实次数聚合后在 log 坐标上平滑，不把不同宽度的 20 桶原始计数连成伪峰。
    // 固定 1.45 倍频次的带宽，让四本词书使用相同的平滑尺度。
    const counts = new Map();
    for (const word of W) if (passBaseFilters(word)) counts.set(word.f, (counts.get(word.f) || 0) + 1);
    const samples = Array.from(counts, ([frequency, count]) => ({log: Math.log(frequency), count}));
    const bandwidth = Math.log(1.45), maxLog = Math.log(h.maxF), resolution = 96;
    const density = Array.from({length: resolution + 1}, (_, i) => {
      const log = maxLog * i / resolution;
      let value = 0;
      for (const sample of samples) {
        const distance = (log - sample.log) / bandwidth;
        if (Math.abs(distance) <= 4) value += sample.count * Math.exp(-distance * distance / 2);
      }
      return value;
    });
    const peak = Math.max(1, ...density);
    const points = density.map((value, i) => ({x: FREQ_POS_MAX * i / resolution, y: 160 - value / peak * 140}));
    const curve = freqCurvePath(points), area = curve + " L1000,160 L0,160 Z";
    el.innerHTML = '<svg class="freq-curve" viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="freqCurveGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity=".04"/></linearGradient>' +
      '<clipPath id="freqCurveClip" clipPathUnits="userSpaceOnUse"><rect id="freqCurveClipRect" x="0" y="0" width="1000" height="160"/></clipPath></defs>' +
      '<path class="freq-curve-base-area" d="' + area + '"/><path class="freq-curve-base-line" d="' + curve + '"/>' +
      '<g clip-path="url(#freqCurveClip)"><path class="freq-curve-selected-area" fill="url(#freqCurveGradient)" d="' + area + '"/><path class="freq-curve-selected-line" d="' + curve + '"/></g></svg>' +
      (h.total ? "" : '<span class="freq-curve-empty">当前条件下暂无词频分布</span>');
    el.setAttribute?.("aria-label", "词频分布平滑概览：共 " + h.total + " 词，词频 1 至 " + h.maxF + " 次；精确筛选结果见下方词数");
    renderFreqAxis(h.maxF);
    syncFreqControls();
  }
  function renderFreqHandleLabels(lo, hi, loPos, hiPos){
    const low = $("#freqMinLabel"), high = $("#freqMaxLabel"), combined = $("#freqCombinedLabel");
    if (!low || !high || !combined) return;
    low.textContent = "≥ " + lo + " 次";
    high.textContent = hi ? "≤ " + hi + " 次" : "不限";
    const width = $("#freqTrack")?.clientWidth || 600;
    const textWidth = el => el.textContent.length * 7 + 16;
    const merged = (hiPos - loPos) / FREQ_POS_MAX * width < (textWidth(low) + textWidth(high)) / 2 + 12;
    low.hidden = high.hidden = merged;
    combined.hidden = !merged;
    combined.textContent = hi === lo ? "仅 " + lo + " 次" : !hi ? "≥ " + lo + " 次" : lo + "–" + hi + " 次";
    const place = (el, pos) => {
      el.style.left = (pos / 10) + "%";
      el.classList.toggle("at-start", pos / FREQ_POS_MAX * width < textWidth(el) / 2);
      el.classList.toggle("at-end", (1 - pos / FREQ_POS_MAX) * width < textWidth(el) / 2);
    };
    place(low, loPos); place(high, hiPos); place(combined, (loPos + hiPos) / 2);
  }
  function refreshFreqPresentation(){
    if (!$("#v-set")?.classList.contains("on")) return;
    renderFreqAxis(bookMaxFreq());
    syncFreqControls();
  }
  /** 滑块位置、选中窗口、柱形高亮与实时计数 */
  function syncFreqControls(){
    const s = S.settings;
    const maxF = bookMaxFreq();
    const loRaw = Math.max(1, s.fmin || 1);
    const hiRaw = s.fmax || 0;
    const loPos = loRaw > maxF ? FREQ_POS_MAX : freqToPos(loRaw, maxF);
    const hiPos = hiRaw ? freqToPos(Math.max(loRaw, Math.min(hiRaw, maxF)), maxF) : FREQ_POS_MAX;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (loEl) {
      loEl.value = String(loPos);
      loEl.setAttribute?.("aria-valuetext", loRaw + " 次");
      loEl.setAttribute?.("aria-valuemin", "0");
      loEl.setAttribute?.("aria-valuemax", String(hiPos));
    }
    if (hiEl) {
      hiEl.value = String(hiPos);
      hiEl.setAttribute?.("aria-valuetext", hiRaw ? hiRaw + " 次" : "不限");
      hiEl.setAttribute?.("aria-valuemin", String(loPos));
      hiEl.setAttribute?.("aria-valuemax", String(FREQ_POS_MAX));
    }
    const left = Math.min(100, loPos / 10);
    const right = Math.min(100, hiPos / 10);
    const win = $("#freqWin");
    if (win) {
      const single = hiRaw === loRaw && loRaw <= maxF;
      win.style.left = left + "%";
      win.style.width = Math.max(0, right - left) + "%";
      win.classList.toggle("single", single);
      win.hidden = right <= left && !single;
    }
    const fill = $("#freqFill");
    if (fill) {
      fill.style.left = left + "%";
      fill.style.width = Math.max(0, right - left) + "%";
    }
    renderFreqHandleLabels(loRaw, hiRaw, loPos, hiPos);
    const clip = $("#freqCurveClipRect");
    clip?.setAttribute?.("x", String(loPos));
    clip?.setAttribute?.("width", String(Math.max(0, hiPos - loPos)));
    let total = 0, inRange = 0, active = 0, proficient = 0;
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (!passBaseFilters(x)) continue;
      total++;
      if (x.f < loRaw || (hiRaw && x.f > hiRaw)) continue;
      inRange++;
      if (isProficient(i)) proficient++; else active++;
    }
    const rangeText = hiRaw === loRaw ? "仅 " + loRaw + " 次" : (loRaw > 1 || hiRaw)
      ? loRaw + " ～ " + (hiRaw || "不限") + " 次"
      : "全部词频";
    const rangeEl = $("#freqRangeNow");
    if (rangeEl) rangeEl.textContent = rangeText;
    const metaEl = $("#freqScopeNow");
    if (metaEl) {
      metaEl.innerHTML = '<span class="freq-result"><strong>' + active.toLocaleString() + '</strong> 个可背单词</span>' +
        '<span class="freq-result-note">候选词中有 ' + (total ? Math.round(inRange / total * 100) : 0) + '% 落在此范围' +
        (proficient ? ' · 已排除 ' + proficient + ' 个熟练词' : '') + '</span>';
    }
  }
  let freqRangeChanged = false;
  function setFreqActivity(which, dragging){
    const track = $("#freqTrack");
    if (!track) return;
    track.dataset.active = which;
    if (dragging !== undefined) track.dataset.dragging = String(dragging);
  }
  /** 写入精确次数；键盘以实际次数步进，避免低频区多次按键仍无变化。 */
  function setFreqValue(which, value){
    const s = S.settings, maxF = bookMaxFreq();
    const oldMin = s.fmin, oldMax = s.fmax;
    if (which === "min") {
      s.fmin = Math.max(1, Math.min(Math.round(value), s.fmax || maxF, maxF));
    } else {
      const f = Math.max(Math.min(s.fmin || 1, maxF), Math.min(maxF, Math.round(value)));
      s.fmax = f >= maxF ? 0 : f;
    }
    if (oldMin !== s.fmin || oldMax !== s.fmax) {
      freqRangeChanged = true;
      markSettingsEditing();
    }
    const minInput = $("#fmin"), maxInput = $("#fmax");
    if (minInput) minInput.value = s.fmin;
    if (maxInput) maxInput.value = s.fmax || "";
    setFreqActivity(which);
    syncFreqControls();
    updateScopeCount();
    syncPresets();
  }
  /** 把一个滑块位置换算成实际词频并写入设置 */
  function setFreqPos(which, pos){
    const s = S.settings;
    const maxF = bookMaxFreq();
    pos = Math.max(0, Math.min(FREQ_POS_MAX, Math.round(+pos || 0)));
    if (which === "min") {
      const cap = s.fmax ? freqToPos(Math.min(s.fmax, maxF), maxF) : FREQ_POS_MAX;
      pos = Math.min(pos, cap);
      setFreqValue(which, posToFreq(pos, maxF, false));
    } else {
      const floor = freqToPos(Math.max(1, Math.min(s.fmin || 1, maxF)), maxF);
      pos = Math.max(pos, floor);
      setFreqValue(which, posToFreq(pos, maxF, true) || maxF);
    }
  }
  /** 拖动滑块：先实时更新范围与计数，松手后再重建队列 */
  function onFreqRangeInput(which){
    // 部分触摸浏览器在 pointerdown 被阻止后仍派发原生 range 输入。
    // 重合手柄由方向分派独立控制，原生值只能还原，不能同时改写另一端。
    if (freqOverlapDrag) { syncFreqControls(); return false; }
    const el = $(which === "min" ? "#fminRange" : "#fmaxRange");
    if (el) setFreqPos(which, +el.value);
    return true;
  }
  function onFreqRangeKey(e, which){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const keys = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "PageDown", "PageUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const maxF = bookMaxFreq(), s = S.settings;
    const low = which === "min" ? 1 : Math.min(maxF, s.fmin || 1);
    const high = which === "min" ? (s.fmax || maxF) : maxF;
    let value = which === "min" ? s.fmin : (s.fmax || maxF);
    if (e.key === "Home") value = low;
    else if (e.key === "End") value = high;
    else {
      const delta = e.key.startsWith("Page") || e.shiftKey ? 10 : 1;
      value += ["ArrowLeft", "ArrowDown", "PageDown"].includes(e.key) ? -delta : delta;
    }
    setFreqValue(which, Math.max(low, Math.min(high, value)));
    commitFreqRange();
  }
  /** 点击轨道空白处：把最近的一端圆点移过去 */
  function onFreqTrackClick(e){
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest("input")) return;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (!loEl || !hiEl) return;
    e.preventDefault();
    const pos = freqPosFromEvent(e);
    const lo = +loEl.value, hi = +hiEl.value;
    const which = Math.abs(hi - lo) <= 1
      ? (pos < lo ? "min" : "max")
      : (Math.abs(pos - lo) < Math.abs(pos - hi) ? "min" : "max");
    setFreqPos(which, pos);
    $(which === "min" ? "#fminRange" : "#fmaxRange").focus?.({ preventScroll: true });
    commitFreqRange();
  }
  function commitFreqRange(){
    if (!freqRangeChanged) return;
    freqRangeChanged = false;
    onSet();
    bindSet();
    applyFilter();
    renderStats();
    startSession();
    markSettingsSaved();
  }
  /** 两个手柄重合时原生滑块只有一个能抓住：向右抬高上界、向左降低下界 */
  let freqOverlapDrag = null;
  let freqPointerDrag = null;
  function freqPosFromEvent(e){
    const bars = $("#freqBars");
    if (!bars) return 0;
    const rect = bars.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(FREQ_POS_MAX,
      Math.round((e.clientX - rect.left) / rect.width * FREQ_POS_MAX)));
  }
  function startFreqRangeDrag(e, which){
    if ((e.button !== undefined && e.button !== 0) || e.isPrimary === false) return;
    const loEl = $("#fminRange"), hiEl = $("#fmaxRange");
    if (!loEl || !hiEl) return;
    freqPointerDrag = { pointerId: e.pointerId, book: currentBookId };
    setFreqActivity(which, true);
    window.addEventListener("pointerup", endFreqRangeDrag);
    window.addEventListener("pointercancel", endFreqRangeDrag);
    const lo = +loEl.value, hi = +hiEl.value;
    if (Math.abs(hi - lo) > 12) return;   // 未重合，交给原生滑块
    e.preventDefault();
    freqOverlapDrag = { startX: e.clientX, moved: false, which: null };
    window.addEventListener("pointermove", moveFreqOverlapDrag, { passive: false });
  }
  function moveFreqOverlapDrag(e){
    if (!freqOverlapDrag || (freqPointerDrag && e.pointerId !== freqPointerDrag.pointerId)) return;
    const dx = e.clientX - freqOverlapDrag.startX;
    if (!freqOverlapDrag.moved && Math.abs(dx) < 3) return;
    freqOverlapDrag.moved = true;
    if (!freqOverlapDrag.which) freqOverlapDrag.which = dx > 0 ? "max" : "min";
    e.preventDefault();
    setFreqPos(freqOverlapDrag.which, freqPosFromEvent(e));
  }
  function endFreqRangeDrag(e){
    if (!freqPointerDrag || (e && e.pointerId !== freqPointerDrag.pointerId)) return;
    const book = freqPointerDrag.book;
    freqPointerDrag = null;
    freqOverlapDrag = null;
    window.removeEventListener("pointermove", moveFreqOverlapDrag);
    window.removeEventListener("pointerup", endFreqRangeDrag);
    window.removeEventListener("pointercancel", endFreqRangeDrag);
    const track = $("#freqTrack");
    if (track) track.dataset.dragging = "false";
    if (book === currentBookId) commitFreqRange();
    else freqRangeChanged = false;
  }
  function orderedPool(){
    const pool = [];
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) pool.push(i);
    if (S.settings.order === "wrong") {
      return pool.sort((a, b) => {
        const A = st(a), B = st(b);
        return ((B && B[3]) || 0) - ((A && A[3]) || 0) || W[a].r - W[b].r;
      });
    }
    return pool.sort((a, b) => W[a].r - W[b].r);
  }
  function buildQueue(now){
    now = now || Date.now();
    const due = [], fresh = [];
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!hasMainProgress(p)) fresh.push(i);
      else if (p[0] < MASTER && p[1] <= now) due.push(i);
    }
    const quota = Math.max(0, S.settings.dailyNew - day().n);
    if (S.settings.order === "shuffle") {
      return {
        due: shuffle(due, sessionSeed),
        fresh: shuffle(fresh, sessionSeed + 1).slice(0, quota)
      };
    }
    if (S.settings.order === "wrong") {
      // 错词优先：复习队列按错误次数降序，再按到期时间；新词仍按词频
      due.sort((a, b) => {
        const A = st(a), B = st(b);
        return ((B && B[3]) || 0) - ((A && A[3]) || 0) || (A && A[1] || 0) - (B && B[1] || 0);
      });
    } else {
      due.sort((a, b) => st(a)[1] - st(b)[1]);
    }
    const freshSet = new Set(fresh);
    const pool = orderedPool().filter(i => freshSet.has(i));
    return { due, fresh: pool.slice(0, quota) };
  }

  /* ================= 会话状态 ================= */
  let Q = [], qi = 0, rounds = {}, cur = null, answered = 0, rightN = 0;
  /** 本组初始词数：重考只增加待巩固，不扩大主进度分母。 */
  let groupTotal = 0;
  let sessionSeed = 1;
  /** verdict: null | true(会) | false(不会) */
  let verdict = null, snap = null, stageBefore = 0;
  /** phase: "recall" | "revealed" —— 门控核心 */
  let phase = "recall";
  let undoStack = [];
  let autoSpoken = false;
  /** 错词特训：独立队列，不影响主背诵队列与今日新词额度 */
  let drillMode = false;
  let mainSnap = null;

  function newSeed(){ return (Math.random() * 0x7fffffff) | 0; }

  /** 错词本：wrong>0 且未熟练。按错次降序、词频升序，不看当前筛选范围 */
  function wrongWordIndices(){
    const out = [];
    for (let i = 0; i < W.length; i++) {
      if (isProficient(i)) continue;
      const p = st(i);
      if (p && p[3] > 0) out.push(i);
    }
    out.sort((a, b) => (st(b)[3] - st(a)[3]) || (W[a].r - W[b].r));
    return out;
  }

  /* ================= 打印生词本（纯逻辑） ================= */
  /** TXT 导出：scope 对应设置页范围，filter 对应词表当前搜索/状态/范围。 */
  function wordBookTxt(source = "scope"){
    let indices;
    if (source === "filter") {
      applyFilter(false);
      indices = filt.slice();
    } else {
      indices = [];
      for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) indices.push(i);
      indices.sort((a, b) => W[a].r - W[b].r);
    }
    const words = indices.map(i => W[i].w);
    return words.length ? words.join("\n") + "\n" : "";
  }
  function exportWordBookTxt(source = "scope"){
    // 熟练名单以最新的独立存储为准，避免另一个窗口刚标记的熟练词漏排。
    try { syncProficientFromStorage(); } catch (e) { /* 保留当前内存中的名单 */ }
    const content = wordBookTxt(source);
    if (!content) { toast("当前范围没有可导出的单词，请调整筛选条件"); return false; }
    const count = content.trimEnd().split("\n").length;
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([content], {type: "text/plain;charset=utf-8"}));
    a.href = url;
    a.download = currentBook().name + (source === "filter" ? "_筛选结果_" : "_背诵范围_") + count + "词_" + todayStr() + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast("已导出 " + count + " 词，每行一个单词");
    return true;
  }
  /** 拆分只切连续区间，不改变导出顺序；均分时多出的词依次分给前几份。 */
  function splitTxtWords(words, mode, amount){
    if (!Array.isArray(words)) throw new Error("词表格式不正确");
    if (!["words", "parts"].includes(mode)) throw new Error("请选择拆分方式");
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("请输入大于 0 的整数");
    if (!words.length) return [];
    if (mode === "parts" && amount > words.length) throw new Error("份数不能超过单词总数");
    const count = mode === "parts" ? amount : Math.ceil(words.length / amount);
    const base = Math.floor(words.length / count), extra = words.length % count;
    const parts = [];
    let start = 0;
    for (let i = 0; i < count; i++) {
      const size = mode === "words" ? Math.min(amount, words.length - start) : base + (i < extra ? 1 : 0);
      parts.push(words.slice(start, start + size));
      start += size;
    }
    return parts;
  }
  let txtSplitContext = null, txtSplitPage = 0;
  const TXT_SPLIT_PAGE_SIZE = 20;
  function downloadWordBookFile(name, content, type){
    const url = URL.createObjectURL(new Blob([content], {type}));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function renderTxtSplitFiles(){
    const files = txtSplitContext ? txtSplitContext.files : [];
    const pages = Math.max(1, Math.ceil(files.length / TXT_SPLIT_PAGE_SIZE));
    txtSplitPage = Math.min(Math.max(0, txtSplitPage), pages - 1);
    const start = txtSplitPage * TXT_SPLIT_PAGE_SIZE;
    $("#txtSplitFiles").innerHTML = files.slice(start, start + TXT_SPLIT_PAGE_SIZE).map((file, n) =>
      '<div class="txt-split-file"><div><b>第 ' + (start + n + 1) + ' 份 · ' + file.count + ' 词</b>' +
      '<small>第 ' + file.start + '–' + file.end + ' 个单词</small></div>' +
      '<button type="button" class="btn ghost sm" data-txt-part="' + (start + n) + '" aria-label="下载第 ' + (start + n + 1) + ' 份 TXT">下载 TXT</button></div>'
    ).join("");
    $("#txtSplitPager").hidden = pages <= 1;
    $("#txtSplitPrev").disabled = txtSplitPage === 0;
    $("#txtSplitNext").disabled = txtSplitPage >= pages - 1;
    $("#txtSplitPage").textContent = (txtSplitPage + 1) + " / " + pages + " 页";
  }
  function renderTxtSplit(){
    if (!txtSplitContext) return [];
    txtSplitPage = 0;
    const mode = $("#txtSplitMode").value, raw = $("#txtSplitAmount").value.trim();
    const summary = $("#txtSplitSummary"), zip = $("#txtSplitZip");
    $("#txtSplitAmountLabel").textContent = mode === "parts" ? "分成几份" : "每份最多词数";
    if (mode === "parts") $("#txtSplitAmount").max = String(txtSplitContext.words.length);
    else $("#txtSplitAmount").removeAttribute?.("max");
    try {
      const parts = splitTxtWords(txtSplitContext.words, mode, raw ? Number(raw) : NaN);
      const width = String(txtSplitContext.words.length).length;
      const partWidth = Math.max(2, String(parts.length).length);
      let offset = 0;
      txtSplitContext.files = parts.map((words, i) => {
        const start = offset + 1, end = offset + words.length; offset = end;
        return {
          name: txtSplitContext.prefix + "_第" + String(i + 1).padStart(partWidth, "0") + "份_"
            + String(start).padStart(width, "0") + "-" + String(end).padStart(width, "0")
            + "_" + words.length + "词_" + txtSplitContext.date + ".txt",
          text: words.join("\n") + "\n", count: words.length, start, end
        };
      });
      summary.textContent = "共 " + txtSplitContext.words.length + " 词，将拆为 " + parts.length + " 份。"
        + (mode === "words" ? "每份最多 " + raw + " 词，最后一份保留余词。" : "各份词数相差不超过 1。");
      zip.disabled = !parts.length;
    } catch (e) {
      txtSplitContext.files = [];
      summary.textContent = e.message;
      zip.disabled = true;
    }
    renderTxtSplitFiles();
    return txtSplitContext.files;
  }
  function openTxtSplit(source = "scope"){
    try { syncProficientFromStorage(); } catch (e) { /* 保留内存中的名单 */ }
    const text = wordBookTxt(source);
    if (!text) { toast("当前范围没有可导出的单词，请调整筛选条件"); return false; }
    if (activeSheet) closeSheet();
    txtSplitContext = {
      bookId: currentBookId, prefix: currentBook().name + (source === "filter" ? "_筛选结果" : "_背诵范围"),
      date: todayStr(), words: text.trimEnd().split("\n"), files: []
    };
    $("#txtSplitSource").textContent = currentBook().name + " · " + (source === "filter" ? "当前筛选结果" : "当前背诵范围")
      + " · 共 " + txtSplitContext.words.length + " 词";
    $("#txtSplitMode").value = "words";
    $("#txtSplitAmount").value = "4000";
    renderTxtSplit();
    openSheet("#txtSplitSheet");
    return true;
  }
  function downloadTxtPart(index){
    const file = txtSplitContext && txtSplitContext.files[index];
    if (!Number.isInteger(index) || !file || txtSplitContext.bookId !== currentBookId) return false;
    downloadWordBookFile(file.name, file.text, "text/plain;charset=utf-8");
    toast("已下载第 " + (index + 1) + " 份（" + file.count + " 词）");
    return true;
  }
  function downloadTxtSplitZip(){
    if (!txtSplitContext || !txtSplitContext.files.length || txtSplitContext.bookId !== currentBookId) return false;
    try {
      if (typeof window.createTxtZipBytes !== "function") throw new Error("ZIP 组件未加载，请刷新后重试，或逐份下载 TXT");
      const bytes = window.createTxtZipBytes(txtSplitContext.files);
      downloadWordBookFile(txtSplitContext.prefix + "_" + txtSplitContext.files.length + "份_"
        + txtSplitContext.words.length + "词_" + txtSplitContext.date + ".zip", bytes, "application/zip");
      toast("已打包 " + txtSplitContext.files.length + " 份 TXT，解压后即可使用");
      return true;
    } catch (e) { toast(e.message || "打包失败，请逐份下载 TXT"); return false; }
  }
  const PRINT_SRC_LABEL = { wrong: "错词本", star: "收藏", filter: "筛选结果" };
  function printStatusLabel(i){
    const p = st(i);
    return isProficient(i) ? "熟练" : isMastered(i) ? "已掌握" : (hasMainProgress(p) ? "第" + p[0] + "档" : "未学");
  }
  function printMetaText(wrong, status, star){
    const parts = [];
    if (wrong > 0) parts.push("错 " + wrong + " 次");
    if (star) parts.push("收藏");
    parts.push(status || "未学");
    return parts.join(" · ");
  }
  /** source: "wrong" | "star" | "filter"（filter = 词表当前筛选结果） */
  function printBookEntries(source){
    let idx;
    if (source === "star") {
      idx = [];
      for (let i = 0; i < W.length; i++) if (isStar(i) && !isProficient(i)) idx.push(i);
      idx.sort((a, b) => W[a].r - W[b].r);
    } else if (source === "filter") {
      // 可能尚未打开过词表，或离开词表后又产生了新的学习记录。
      // 导出时按当前控件重新筛选，并保留词表滚动位置。
      applyFilter(false);
      idx = filt.slice();
    } else {
      idx = wrongWordIndices();
    }
    return idx.map(i => {
      const p = st(i), x = W[i];
      return {
        i, w: x.w, ph: x.ph || "", m: x.m || "",
        wrong: (p && p[3]) || 0,
        status: printStatusLabel(i),
        star: isStar(i)
      };
    });
  }
  function printBookMarkdown(entries, opts){
    opts = opts || {};
    const date = opts.date || todayStr();
    const label = opts.sourceLabel || PRINT_SRC_LABEL[opts.source] || "错词本";
    const list = entries || [];
    const lines = [
      "# " + currentBook().name + "生词本 · " + label,
      "",
      "日期：" + date + " · 共 " + list.length + " 词",
      ""
    ];
    for (const e of list) {
      const ph = e.ph ? " /" + e.ph + "/ " : " ";
      lines.push("- [ ] **" + e.w + "**" + ph + " " + (e.m || "—") +
        "（" + printMetaText(e.wrong, e.status, e.star) + "）");
    }
    lines.push("");
    return lines.join("\n");
  }

  /** 特训判定：只调错次 p[3]，不动学习档位 p[0]/到期时间 p[1]，不占今日新词额度 */
  function applyDrill(i, known){
    const prev = st(i), p = prev ? prev.slice() : [0, 0, 0, 0, 0];
    p[3] = known ? Math.max(0, p[3] - 1) : p[3] + 1;
    S.progress[i] = p;
    const d = day();
    if (known) d.ok++; else d.no++;
    d.r++;
  }

  /* ================= 学习热力图（纯函数） ================= */
  /** 当日学习量分级：vol = 新词 + 复习次数 = 当日总作答次数 r */
  function heatLevel(vol){
    if (!(vol > 0)) return 0;
    if (vol <= 4) return 1;
    if (vol <= 9) return 2;
    if (vol <= 19) return 3;
    return 4;
  }
  /**
   * 近 weeks 周学习热力（含本周；本周尚未到来的日子标记 future）。
   * 返回 cells：按时间升序，长度 weeks*7；每项 {date, n, r, ok, no, vol, level, future, weekday}。
   * 列=周、行=星期；cells[k] 的 weekday = k % 7（起点为周日）。
   */
  function heatmapData(days, todayKey, weeks){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey || "")) throw new Error("热力图日期不正确");
    const t = new Date(todayKey + "T12:00:00");
    if (Number.isNaN(t.getTime()) || todayStr(t) !== todayKey) throw new Error("热力图日期不正确");
    weeks = Math.min(26, Math.max(1, Math.floor(weeks) || 12));
    const dow = t.getDay();
    const end = new Date(t); end.setDate(t.getDate() + (6 - dow));
    const start = new Date(end); start.setDate(end.getDate() - (weeks * 7 - 1));
    const cells = [];
    for (let k = 0; k < weeks * 7; k++) {
      const d = new Date(start); d.setDate(start.getDate() + k);
      const date = todayStr(d);
      const rec = (days && days[date]) || null;
      const n = rec ? rec.n : 0, r = rec ? rec.r : 0;
      const ok = rec ? rec.ok : 0, no = rec ? rec.no : 0;
      const vol = r; // 新词 + 复习次数
      cells.push({ date, n, r, ok, no, vol, level: heatLevel(vol), future: date > todayKey, weekday: d.getDay() });
    }
    return cells;
  }

  function startSession(){
    drillMode = false;
    mainSnap = null;
    sessionSeed = newSeed();
    const { due, fresh } = buildQueue();
    let mix;
    if (S.settings.order === "shuffle") {
      mix = shuffle(due.concat(fresh), sessionSeed + 2);
    } else {
      mix = [];
      let a = 0, b = 0;
      while (a < due.length || b < fresh.length) {
        for (let k = 0; k < 5 && a < due.length; k++) mix.push(due[a++]);
        if (b < fresh.length) mix.push(fresh[b++]);
        if (a >= due.length && b >= fresh.length) break;
      }
    }
    Q = mix; qi = 0; rounds = {}; answered = 0; rightN = 0;
    groupTotal = Q.length;
    undoStack = [];
    nextCard();
    updateBar();
    renderDrillEntry();
  }

  /** 错词特训：独立队列；保存主会话，退出时原样恢复 */
  function startDrill(){
    const list = wrongWordIndices();
    if (!list.length) {
      toast("错词本为空，先在背诵中积累错词吧");
      return false;
    }
    if (!drillMode) {
      mainSnap = {
        Q: Q.slice(), qi, rounds: Object.assign({}, rounds), cur,
        answered, rightN, groupTotal, verdict, snap, phase, stageBefore,
        undoStack: undoStack.slice(), autoSpoken,
        drillBaseline: {
          wrong: Object.fromEntries(Object.entries(S.progress).map(([i, p]) => [i, p[3]])),
          days: Object.fromEntries(Object.entries(S.days).map(([date, d]) => [date, Object.assign({}, d)]))
        }
      };
    }
    drillMode = true;
    Q = list; qi = 0; rounds = {}; answered = 0; rightN = 0;
    groupTotal = Q.length;
    undoStack = [];
    nextCard();
    updateBar();
    renderDrillEntry();
    return true;
  }

  /**
   * 特训已写入同一份 progress/days。把这些增量补进暂停的主会话快照，
   * 这样返回后改判或撤销主会话，只回滚主会话本身，不会抹掉特训成果。
   */
  function rebaseMainSnapshots(s){
    if (!s.drillBaseline) return;
    const base = s.drillBaseline;
    const wrongDelta = new Map();
    for (const i of new Set(Object.keys(base.wrong).concat(Object.keys(S.progress)))) {
      const delta = ((S.progress[i] && S.progress[i][3]) || 0) - (base.wrong[i] || 0);
      if (delta) wrongDelta.set(+i, delta);
    }
    const dayDelta = {};
    for (const date of new Set(Object.keys(base.days).concat(Object.keys(S.days)))) {
      const before = base.days[date] || {}, after = S.days[date] || {};
      const delta = {};
      for (const k of ["n", "r", "ok", "no"]) delta[k] = (after[k] || 0) - (before[k] || 0);
      if (Object.values(delta).some(v => v !== 0)) dayDelta[date] = delta;
    }
    const seen = new Set();
    function rebase(record, i){
      // snap 和 originalSnap 可能被多个撤销条目共享，只能补一次。
      if (!record || seen.has(record)) return;
      seen.add(record);
      const delta = wrongDelta.get(i) || 0;
      // 抵消量可为负，必须保留到重放主判定之后再取零下界。
      // 提前截断会让“主不会→特训会→主改会→主改不会”重新长出已清零的错次。
      if (delta) record.drillWrongDelta = (record.drillWrongDelta || 0) + delta;
      for (const date of Object.keys(record.days)) {
        if (!dayDelta[date]) continue;
        const next = Object.assign({n:0, r:0, ok:0, no:0}, record.days[date]);
        for (const k of ["n", "r", "ok", "no"]) next[k] += dayDelta[date][k];
        record.days[date] = next;
      }
      if (record.days[record.date]) record.day = Object.assign({}, record.days[record.date]);
    }
    rebase(s.snap, s.cur);
    for (const u of s.undoStack) {
      rebase(u.snap, u.i);
      rebase(u.originalSnap, u.i);
    }
  }

  /** 退出特训：恢复进入前的主背诵会话，不影响今日新词额度 */
  function exitDrill(){
    if (!drillMode) return false;
    drillMode = false;
    const s = mainSnap;
    mainSnap = null;
    if (s) {
      rebaseMainSnapshots(s);
      Q = s.Q.slice();
      qi = s.qi;
      rounds = s.rounds;
      answered = s.answered;
      rightN = s.rightN;
      groupTotal = s.groupTotal || Q.length;
      undoStack = s.undoStack;
      verdict = s.verdict;
      snap = s.snap;
      phase = s.phase;
      stageBefore = s.stageBefore;
      autoSpoken = s.autoSpoken;
      cur = s.cur;
      // 特训期间若把主队列当前词标为熟练，返回时对齐队列
      if (qi < Q.length && Q[qi] === cur && !isProficient(cur)) renderCard();
      else nextCard();
      updateBar();
    } else {
      startSession();
    }
    renderDrillEntry();
    toast("已退出错词特训，回到普通背诵");
    return true;
  }

  function nextCard(){
    autoSpoken = false;
    while (qi < Q.length) {
      const i = Q[qi];
      if (isProficient(i)) { Q.splice(qi, 1); continue; }
      if (drillMode) {
        // 特训队列只留错词；错次清零后退出本组剩余队列
        const p = st(i);
        if (!p || !(p[3] > 0)) { Q.splice(qi, 1); continue; }
      } else if (!inScope(i)) {
        Q.splice(qi, 1); continue;
      }
      break;
    }
    if (qi >= Q.length) {
      cur = null; verdict = null; snap = null; phase = "recall";
      renderCard();
      return;
    }
    cur = Q[qi];
    verdict = null;
    snap = null;
    stageBefore = 0;
    phase = "recall";
    renderCard();
  }

  function snapshot(i, extraDates){
    const date = todayStr(), d = day();
    const dates = Array.from(new Set([date].concat(extraDates || [])));
    return {
      prog: st(i) ? st(i).slice() : null,
      survey: (W[i] && Object.prototype.hasOwnProperty.call(SURVEY, W[i].w)) ? SURVEY[W[i].w] : null,
      date,
      days: Object.fromEntries(dates.map(k => [k, S.days[k] ? Object.assign({}, S.days[k]) : null])),
      day: { n: d.n, r: d.r, ok: d.ok, no: d.no }
    };
  }
  function restore(i, s){
    const wrong = snapshotWrong(s);
    if (s.prog) {
      S.progress[i] = s.prog.slice();
      S.progress[i][3] = Math.max(0, wrong);
    } else if (wrong > 0) {
      // 撤销首次学习后仍保留特训产生的错次，不制造升档或新词配额。
      S.progress[i] = [0, 0, 0, wrong, 0];
    } else delete S.progress[i];
    for (const [k, d] of Object.entries(s.days)) {
      if (d) S.days[k] = Object.assign({}, d); else delete S.days[k];
    }
    if (W[i] && W[i].w) {
      const w = W[i].w;
      if (s.survey === null || s.survey === undefined) { if (w in SURVEY) { delete SURVEY[w]; saveSurvey(); } }
      else if (SURVEY[w] !== s.survey) { SURVEY[w] = s.survey; saveSurvey(); }
    }
  }
  function snapshotWrong(s){
    return ((s.prog && s.prog[3]) || 0) + (s.drillWrongDelta || 0);
  }
  function applySRS(i, known, wrongBefore, hadBefore){
    const prev = st(i), had = hadBefore === undefined ? hasMainProgress(prev) : hadBefore;
    const p = prev || [0,0,0,0,0], now = Date.now();
    const wrong = wrongBefore === undefined ? p[3] : wrongBefore;
    if (known) {
      const n = nextOnKnow(p[0]);
      S.progress[i] = [n.stage, now + n.delay, p[2] + 1, Math.max(0, wrong), now];
      day().ok++;
    } else {
      const n = nextOnForget();
      S.progress[i] = [n.stage, now + n.delay, p[2], Math.max(0, wrong + 1), now];
      day().no++;
    }
    if (!had) day().n++;
    day().r++;
  }

  /** 判定：首次判定或改判；完成后 phase → revealed */
  function judge(known){
    if (cur == null || isProficient(cur)) return;
    const i = cur;
    const apply = drillMode ? applyDrill : applySRS;
    if (verdict === null) {
      undoStack.push({ type: "judge", i, snap: snapshot(i), answeredBefore: answered, rightBefore: rightN });
      snap = snapshot(i);
      // 抽样独立保存；恢复早期备份后再次遇到同一新词，也不能覆盖首次作答。
      const firstSample = !hasMainProgress(snap.prog) && snap.survey === null;
      stageBefore = snap.prog ? snap.prog[0] : 0;
      verdict = known;
      answered++;
      if (known) rightN++;
      apply(i, known);
      if (firstSample) recordSurvey(i, known);
      phase = "revealed";
    } else if (verdict !== known) {
      const before = snapshot(i, Object.keys(snap.days));
      undoStack.push({ type: "rejudge", i, snap: before, originalSnap: snap, prevVerdict: verdict, answeredBefore: answered, rightBefore: rightN });
      // 后台标签跨午夜时，轮询可能尚未刷新。将新日期的作答前记录补入
      // 原始基线，让后续改判只保留一次作答，撤销也能完整还原中间日期。
      for (const [date, record] of Object.entries(before.days)) {
        if (!Object.prototype.hasOwnProperty.call(snap.days, date)) {
          snap.days[date] = record ? Object.assign({}, record) : null;
        }
      }
      restore(i, snap);
      apply(i, known, snapshotWrong(snap), hasMainProgress(snap.prog));
      rightN += known ? 1 : -1;
      verdict = known;
      if (!hasMainProgress(snap.prog) && snap.survey === null) recordSurvey(i, known);   // 只修正本次新增的样本
      phase = "revealed";
    } else {
      return;
    }
    save();
    renderCard();
    updateBar();
  }

  /** 待巩固词数：已安排/即将安排的重考，不计入本组主进度分母。 */
  function pendingReinforce(){
    let n = 0;
    const seen = new Set();
    for (let k = qi; k < Q.length; k++) {
      const i = Q[k];
      if ((rounds[i] || 0) > 0 && !seen.has(i)) { n++; seen.add(i); }
    }
    if (cur != null && verdict === false && (rounds[cur] || 0) < 2 && !seen.has(cur)) n++;
    return n;
  }

  /** 翻页：仅 revealed 阶段允许 */
  function tryNext(userTriggered){
    if (cur == null) return;
    if (phase !== "revealed") {
      if (userTriggered) gateBlock();
      return;
    }
    const i = cur;
    undoStack.push({
      type: "next",
      i,
      qiBefore: qi,
      queueLengthBefore: Q.length,
      roundsBefore: rounds[i] || 0,
      answeredBefore: answered,
      rightBefore: rightN,
      verdict: verdict,
      snap: snap,
      stageBefore
    });
    if (verdict === false && !isProficient(i) && (rounds[i] || 0) < 2) {
      rounds[i] = (rounds[i] || 0) + 1;
      Q.push(i);
    }
    qi++;
    verdict = null;
    snap = null;
    phase = "recall";
    nextCard();
    updateBar();
  }

  /** 撤销：支持 判定 / 改判 / 翻页 */
  function undo(){
    if (!undoStack.length) {
      toast("没有可撤销的操作");
      return;
    }
    const u = undoStack.pop();
    if (u.type === "judge" || u.type === "rejudge") {
      if (u.type === "rejudge") {
        restore(u.i, u.snap);
        verdict = u.prevVerdict;
        phase = "revealed";
        snap = u.originalSnap;
      } else {
        restore(u.i, u.snap);
        verdict = null;
        snap = null;
        phase = "recall";
        stageBefore = 0;
      }
      answered = u.answeredBefore;
      rightN = u.rightBefore;
      cur = u.i;
      save();
      renderCard();
      updateBar();
      toast(u.type === "judge" ? "已撤销判定" : "已撤销改判");
    } else if (u.type === "next") {
      Q.length = u.queueLengthBefore;
      qi = u.qiBefore;
      if (u.roundsBefore) rounds[u.i] = u.roundsBefore; else delete rounds[u.i];
      answered = u.answeredBefore;
      rightN = u.rightBefore;
      cur = Q[qi];
      stageBefore = u.stageBefore;
      if (u.verdict !== undefined && u.verdict !== null) {
        verdict = u.verdict;
        phase = "revealed";
        snap = u.snap || snapshot(cur);
      } else {
        verdict = null;
        phase = "recall";
        snap = null;
      }
      renderCard();
      updateBar();
      toast("已撤销翻页");
    }
  }

  /* ================= 发音 ================= */
  function speak(text){
    if (!("speechSynthesis" in window)) { toast("当前浏览器不支持发音，请尝试系统浏览器"); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.92;
      u.onerror = (e) => {
        if (e.error !== "canceled" && e.error !== "interrupted") toast("发音失败，请检查系统语音或网络设置");
      };
      speechSynthesis.speak(u);
    } catch (e) { toast("发音失败，请检查系统语音设置"); }
  }

  /* ================= 门控提示 ================= */
  let gateTimer = null;
  function gateBlock(){
    const card = $("#card"), t = $("#gateToast");
    if (card) {
      card.classList.remove("shake");
      // reflow
      void card.offsetWidth;
      card.classList.add("shake");
      setTimeout(() => card.classList.remove("shake"), 360);
    }
    if (t) {
      t.textContent = "请先选择「会」或「不会」；已经熟悉的词可直接标为「熟练」";
      t.classList.add("on");
      clearTimeout(gateTimer);
      gateTimer = setTimeout(() => t.classList.remove("on"), 1800);
    }
    const hint = $("#hint");
    if (hint && phase === "recall") {
      hint.textContent = drillMode
        ? "错词特训：先选「会」或「不会」只调错次，不占新词额度——未判定不能翻页"
        : "想好中文意思后，按「会」或「不会」——未判定不能翻页";
    }
  }

  /* ================= 渲染：背诵 ================= */
  function dotsHtml(stage){
    let h = '<div class="dots" aria-label="掌握阶段">';
    for (let i = 0; i < MASTER; i++) {
      const cls = (stage >= MASTER || i < stage) ? "on" : (i === stage ? "cur" : "");
      h += '<span class="' + cls + '"></span>';
    }
    h += "<em>" + esc(stageLabel(stage)) + "</em></div>";
    return h;
  }

  // 使用实际字形宽度适配单行词面，兼顾字体差异、展开双栏与窗口缩放。
  function fitWord(el){
    if (!el || !el.clientWidth || typeof window.getComputedStyle !== "function") return;
    el.style.fontSize = "";
    const base = parseFloat(window.getComputedStyle(el).fontSize);
    const available = el.clientWidth;
    if (!base || !available || el.scrollWidth <= available) return;
    el.style.fontSize = Math.floor(base * (available - 2) / el.scrollWidth * 100) / 100 + "px";
  }
  function fitVisibleWords(){
    fitWord($("#card .word"));
    fitWord($("#wordTitle"));
  }

  function renderCard(){
    renderSurvey();
    hideExPop();
    const c = $("#card"), a = $("#acts");
    const cardWord = currentBookId + ":" + cur;
    const wordChanged = c.dataset.renderedWord !== cardWord;
    if (wordChanged) c.scrollTop = 0;
    c.dataset.renderedWord = cardWord;
    c.classList.toggle("has-answer", cur !== null && verdict !== null);
    const oldFocus = document.activeElement;
    const restoreFocus = oldFocus && (c.contains?.(oldFocus) || a.contains?.(oldFocus));
    a.classList.toggle("revealed", cur !== null && verdict !== null);
    const finishRender = () => {
      fitVisibleWords();
      const message = cur == null ? "本组学习结束。" : W[cur].w + (verdict === null
        ? "，请先回忆，再选择会或不会。"
        : (verdict ? "，已记为会。" : "，已记为不会。") + W[cur].m);
      c.setAttribute?.("aria-label", cur == null ? "本组学习结果" : "当前单词：" + W[cur].w);
      const announcement = $("#studyAnnouncement");
      if (announcement && announcement.textContent !== message) announcement.textContent = message;
      // 重绘会移除原按钮；键盘操作后把焦点留在学习区，空格仍可继续。
      if (restoreFocus) {
        const target = oldFocus.id && $("#" + oldFocus.id);
        (target || c).focus?.({preventScroll: true});
      }
    };
    const d = day();
    $("#s-new").textContent = d.n;
    $("#s-newmax").textContent = S.settings.dailyNew;
    $("#s-rev").textContent = Math.max(0, d.r - d.n);
    const progLabel = $("#s-proglabel");
    if (progLabel) progLabel.textContent = drillMode ? "错词特训" : "本次进度";
    $("#s-prog").textContent = Math.min(answered, groupTotal) + "/" + groupTotal;
    const pendingEl = $("#s-pending");
    if (pendingEl) {
      const pending = pendingReinforce();
      pendingEl.textContent = pending ? "待巩固 " + pending + " 次" : "";
      pendingEl.hidden = !pending;
    }
    $("#s-acc").textContent = (d.ok + d.no) ? Math.round(d.ok / (d.ok + d.no) * 100) + "%" : "—";

    // The configured target is the daily new-word quota, not an invented review target.
    const goal = Math.max(1, S.settings.dailyNew);
    const goalPct = Math.min(1, d.n / goal);
    const ring = $("#ringFg");
    if (ring) {
      const C = 2 * Math.PI * 15;
      ring.style.strokeDasharray = String(C);
      ring.style.strokeDashoffset = String(C * (1 - goalPct));
    }
    const goalEl = $("#s-goal");
    if (goalEl) goalEl.textContent = Math.round(goalPct * 100) + "%";

    if (cur == null) {
      const due = countDue();
      const freshLeft = orderedPool().some(i => !hasMainProgress(st(i)));
      const quotaLeft = Math.max(0, S.settings.dailyNew - d.n);
      const completed = answered > 0;
      const drillListN = drillMode ? 0 : wrongWordIndices().length;
      if (drillMode) {
        c.innerHTML =
          '<div class="done">' +
            "<h2>错词特训完成</h2>" +
            "<p>本次共 " + answered + " 张，正确 " + rightN + " 张</p>" +
            "<p>「会」会减少错次，「不会」会增加错次；学习档位与复习计划不受影响</p>" +
          "</div>";
        a.innerHTML =
          '<button type="button" class="btn primary" id="again">再练一组</button>' +
          '<button type="button" class="btn ghost" id="exitDrillBtn">退出特训</button>' +
          (undoStack.length ? '<button type="button" class="btn ghost sm" id="undoBtn">撤销上一步</button>' : "");
        $("#again").onclick = () => startDrill();
        $("#exitDrillBtn").onclick = exitDrill;
        if (undoStack.length) $("#undoBtn").onclick = undo;
        $("#hint").textContent = "";
        renderDrillEntry();
        finishRender();
        return;
      }
      c.innerHTML =
        '<div class="done">' +
          "<h2>" + (completed ? "本组完成" : "暂无待背单词") + "</h2>" +
          "<p>本次共 " + answered + " 张，正确 " + rightN + " 张</p>" +
          '<div class="big">' + scopedMasteredCount() + "<span>/ " + inScopeCount() + " 已掌握</span></div>" +
          (due
            ? "<p>另有 <b>" + due + "</b> 个词已到复习时间</p>"
            : freshLeft && quotaLeft ? "<p>还有新词可学，点击继续背诵开始下一组</p>"
            : freshLeft ? "<p>今日新词目标已完成；到期复习可继续，新词明天更新</p>"
            : "<p>当前范围没有新词或到期复习；可调整筛选或管理熟练词</p>") +
          (drillListN ? "<p>错词本有 <b>" + drillListN + "</b> 个词，可开始错词特训</p>" : "") +
          (proficientCount() ? "<p>已排除 " + proficientCount() + " 个熟练词，可在词表中取消</p>" : "") +
        "</div>";
      a.innerHTML =
        '<button type="button" class="btn primary" id="again">继续背诵</button>' +
        (drillListN ? '<button type="button" class="btn ghost" id="startDrillBtn">错词特训</button>' : "") +
        '<button type="button" class="btn ghost" id="goStats">查看统计</button>' +
        (undoStack.length ? '<button type="button" class="btn ghost sm" id="undoBtn">撤销上一步</button>' : "");
      $("#again").onclick = startSession;
      if (drillListN) $("#startDrillBtn").onclick = () => startDrill();
      $("#goStats").onclick = () => show("stats");
      if (undoStack.length) $("#undoBtn").onclick = undo;
      $("#hint").textContent = "";
      renderDrillEntry();
      finishRender();
      return;
    }

    const x = W[cur], p = st(cur);
    const stage = p ? p[0] : 0, K = S.settings.keys;
    const proficientBtn = '<button type="button" class="btn proficient" id="markProficient" title="熟练词今后不再进入背诵或复习">熟练<kbd>' + esc(keyName(K.proficient)) + '</kbd></button>';
    const starBtn =
      '<button type="button" class="star' + (isStar(cur) ? " on" : "") + '" id="star" ' +
      'aria-label="' + (isStar(cur) ? "取消收藏" : "收藏") + '" aria-pressed="' + isStar(cur) + '" title="收藏（' + keyName(K.star) + '）">★</button>';

    let h = '<div class="word-face" role="group" aria-label="单词与复习阶段" tabindex="0"><div class="tagrow">';
    h += '<span class="tag">词频 #' + x.r + "</span>";
    h += '<span class="tag">' + x.f + " 次 / " + x.c + " 套卷</span>";
    if (x.ky) h += '<span class="tag ky">' + esc(currentBook().tagLabel) + "</span>";
    h += wordBookTags(x.w);
    h += "</div>";
    h += '<div class="word" lang="en">' + esc(x.w) + "</div>";
    if (S.settings.showPh && x.ph) h += '<div class="ph">/' + esc(x.ph) + "/</div>";
    h += '<div class="posline">' + esc(POSN[x.p] || "") + "</div>";
    h += dotsHtml(stage);
    h += '<button type="button" class="spk" id="spk" aria-label="发音" title="发音（' + keyName(K.speak) + '）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg></button>';
    h += "</div>";

    if (verdict !== null) {
      h += '<div class="answer" role="region" aria-label="释义与例句" tabindex="0"><span class="answer-label">释义与用法</span>';
      h += '<div class="mean">' + meaningHtml(x) + "</div>";
      if (S.settings.showEx && x.ex) {
        h += '<div class="ex" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">' + exHtml(x.ex, x) +
          '<span class="src">— ' + esc(srcBadge(x.src)) + "</span></div>";
      }
      if (S.settings.showFm && x.fm) h += '<div class="fm">词形：' + esc(x.fm) + "</div>";
      h += "</div>";
    }

    c.innerHTML = starBtn + h;
    if (wordChanged) {
      c.classList.remove("enter");
      c.classList.add("enter");
      setTimeout(() => c.classList.remove("enter"), 240);
    }
    bindExLookup(c);

    $("#spk").onclick = (e) => { e.stopPropagation(); speak(x.w); };
    $("#star").onclick = (e) => {
      e.stopPropagation();
      toggleStar(cur);
      renderCard();
      toast(isStar(cur) ? "已收藏" : "已取消收藏");
    };
    if (S.settings.autoSpk && verdict === null && !autoSpoken) { autoSpoken = true; speak(x.w); }

    if (verdict === null) {
      a.innerHTML =
        '<button type="button" class="btn ok" id="ok">会<kbd>' + keyName(K.know) + "</kbd></button>" +
        '<button type="button" class="btn no" id="no">不会<kbd>' + keyName(K.dont) + "</kbd></button>" + proficientBtn +
        (drillMode ? '<button type="button" class="btn ghost sm" id="exitDrillBtn">退出特训</button>' : "");
      $("#no").onclick = () => judge(false);
      $("#ok").onclick = () => judge(true);
      if (drillMode) {
        $("#exitDrillBtn").onclick = exitDrill;
        $("#hint").textContent = "错词特训：「会」减少错次，「不会」增加错次；不改动学习档位";
      } else {
        $("#hint").textContent = "想好中文意思后按「会」或「不会」；标为「熟练」会移出背诵与复习，可在词表恢复";
      }
    } else {
      const wasOK = verdict === true;
      const otherKey = wasOK ? K.dont : K.know;
      const otherTxt = wasOK ? "不会" : "会";
      a.innerHTML =
        '<span class="verdict ' + (wasOK ? "ok" : "no") + '">' +
          '<span class="seal" aria-hidden="true">' + (wasOK ? "✓" : "✗") + "</span>" +
          (wasOK ? "已记为「会」" : "已记为「不会」") +
          "<kbd>" + keyName(wasOK ? K.know : K.dont) + "</kbd>" +
        "</span>" +
        '<button type="button" class="btn ghost" id="fix">记错了，其实' + otherTxt +
          "<kbd>" + keyName(otherKey) + "</kbd></button>" +
        '<button type="button" class="btn primary sm" id="nx">下一个<kbd>' + keyName(K.next) + "</kbd></button>" +
        '<button type="button" class="btn ghost sm" id="undoBtn" title="Ctrl/Cmd+Z">撤销</button>' + proficientBtn +
        (drillMode ? '<button type="button" class="btn ghost sm" id="exitDrillBtn">退出特训</button>' : "");
      $("#fix").onclick = () => judge(!wasOK);
      $("#nx").onclick = () => tryNext(true);
      $("#undoBtn").onclick = undo;
      if (drillMode) {
        $("#exitDrillBtn").onclick = exitDrill;
        $("#hint").textContent = (wasOK ? "「会」→ 错次 -1" : "「不会」→ 错次 +1，留在错词本")
          + "　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else if (wasOK && stageBefore + 1 >= MASTER) {
        $("#hint").textContent = "「会」→ 已掌握，不再安排复习　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else if (wasOK) {
        const idx = Math.min(stageBefore, STAGES.length - 1);
        $("#hint").textContent = "「会」→ " + STAGES[idx].t + "后复习　·　记错了按 " + keyName(otherKey) + " 改判　·　Ctrl+Z 撤销";
      } else {
        $("#hint").textContent = "「不会」→ 本组稍后重考，" + STAGES[0].t + "后重来　·　Ctrl+Z 撤销";
      }
    }
    $("#markProficient").onclick = () => setProficient(cur, true);
    renderDrillEntry();
    finishRender();
  }

  function countDue(){
    const now = Date.now();
    let n = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (hasMainProgress(p) && p[0] < MASTER && p[1] <= now) n++;
    }
    return n;
  }
  function formatReviewTime(time){
    const d = new Date(time), pad = n => String(n).padStart(2, "0");
    return todayStr(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  /** 与实际入队范围一致：排除熟练、已掌握与范围外词。 */
  function reviewPlan(now = Date.now()){
    let due = 0, upcoming = 0, next = null;
    for (let i = 0; i < W.length; i++) {
      const p = st(i);
      if (!hasMainProgress(p) || p[0] >= MASTER || isProficient(i) || !inScope(i)) continue;
      if (p[1] <= now) due++;
      else {
        if (p[1] <= now + 24 * 60 * 60 * 1000) upcoming++;
        if (next === null || p[1] < next) next = p[1];
      }
    }
    return {due, upcoming, next};
  }
  function renderReviewPlan(){
    const plan = reviewPlan(), el = $("#reviewPlan");
    if (el) el.innerHTML = '<span class="review-count"><b>' + plan.due + '</b><span>个词已到期</span></span>' +
      '<span class="review-upcoming">接下来 24 小时到期 ' + plan.upcoming + ' 词</span>' +
      '<span class="review-next">' + esc(plan.next !== null ? "下次到期：" + formatReviewTime(plan.next) : "当前没有后续复习安排，可继续学习新词。") + "</span>";
    const btn = $("#btnDueList");
    if (btn) {
      btn.disabled = !plan.due;
      btn.textContent = plan.due ? "查看 " + plan.due + " 个到期词" : "暂无到期词";
      btn.classList.toggle("primary", Boolean(plan.due));
      btn.classList.toggle("ghost", !plan.due);
    }
    const studyBtn = $("#btnStatsStudy");
    if (studyBtn) {
      studyBtn.textContent = Object.keys(S.progress || {}).length ? "继续背诵" : "开始背诵";
      studyBtn.classList.toggle("primary", !plan.due);
      studyBtn.classList.toggle("ghost", Boolean(plan.due));
    }
    const goal = $("#todayGoal");
    if (goal) {
      const d = S.days[todayStr()] || {n: 0, r: 0, ok: 0, no: 0};
      const quota = Math.max(1, S.settings.dailyNew);
      const pct = Math.min(100, Math.round(d.n / quota * 100));
      const acc = (d.ok + d.no) ? Math.round(d.ok / (d.ok + d.no) * 100) + "%" : "—";
      goal.innerHTML = '<div class="tg-head"><span>今日新词</span><b>' + d.n + " / " + quota + "</b></div>" +
        '<div class="tg-track" role="img" aria-label="今日新词 ' + d.n + " / " + quota + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="tg-meta">今日已作答 ' + d.r + " 题 · 正确率 " + acc + "</div>";
    }
  }
  function startOfLocalDay(t){
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  /** 未来 N 天的到期词数；今天这一柱包含已到期与今天稍后到期的词 */
  function dueForecast(days = 14, now = Date.now()){
    days = Math.max(1, Math.min(31, Math.round(days || 14)));
    const start = startOfLocalDay(now);
    const dates = [], labels = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(todayStr(d));
      labels.push(i === 0 ? "今天" : i === 1 ? "明天"
        : d.getDate() === 1 ? (d.getMonth() + 1) + "/1" : String(d.getDate()));
    }
    const counts = new Array(days).fill(0);
    let overdue = 0, dueToday = 0, later = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!hasMainProgress(p) || p[0] >= MASTER) continue;
      const due = p[1];
      const idx = Math.round((startOfLocalDay(due) - start) / 86400000);
      if (idx <= 0) {
        counts[0]++;
        if (due <= now) overdue++; else dueToday++;
      } else if (idx < days) {
        counts[idx]++;
      } else {
        later++;
      }
    }
    let peak = -1, peakCount = 0;
    counts.forEach((v, i) => {
      if (v > peakCount) { peakCount = v; peak = i; }
    });
    return {
      days: days, dates: dates, labels: labels, counts: counts,
      overdue: overdue, dueToday: dueToday, later: later,
      peak: peak, peakCount: peakCount,
      next7: counts.slice(0, 7).reduce((a, b) => a + b, 0),
      total: counts.reduce((a, b) => a + b, 0)
    };
  }
  const FREQ_TIERS = [
    { key: "high", label: "高频", range: "≥20 次", min: 20, max: Infinity },
    { key: "upper", label: "中高频", range: "10–19 次", min: 10, max: 19 },
    { key: "mid", label: "中频", range: "5–9 次", min: 5, max: 9 },
    { key: "low", label: "低频", range: "2–4 次", min: 2, max: 4 },
    { key: "rare", label: "仅 1 次", range: "1 次", min: 1, max: 1 }
  ];
  /** 当前背诵范围按真题词频分层的已掌握 / 学习中 / 未学分布 */
  function frequencyMastery(){
    const rows = FREQ_TIERS.map(t => ({
      key: t.key, label: t.label, range: t.range, min: t.min, max: t.max,
      total: 0, mastered: 0, learning: 0, unseen: 0
    }));
    let total = 0, mastered = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const x = W[i];
      let row = null;
      for (const r of rows) {
        if (x.f >= r.min && x.f <= r.max) { row = r; break; }
      }
      if (!row) continue;
      row.total++;
      total++;
      const p = st(i);
      if (!hasMainProgress(p)) {
        row.unseen++;
      } else if (p[0] >= MASTER) {
        row.mastered++;
        mastered++;
      } else {
        row.learning++;
      }
    }
    return {
      rows: rows.filter(r => r.total > 0),
      total: total,
      mastered: mastered,
      rate: total ? mastered / total : 0
    };
  }
  function pctOf(part, whole){
    return whole ? Math.round(part / whole * 100) : 0;
  }
  function wordReviewLabel(i){
    if (isProficient(i)) return "已标为熟练，不再安排复习";
    const p = st(i);
    if (!hasMainProgress(p)) return "尚未学习，判定后安排复习";
    if (p[0] >= MASTER) return "已掌握，不再安排复习";
    return "下次复习：" + (p[1] <= Date.now() ? "已到期 · " : "") + formatReviewTime(p[1]);
  }
  function masteredCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (isMastered(i)) n++;
    return n;
  }
  function scopedMasteredCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i) && isMastered(i)) n++;
    return n;
  }
  function inScopeCount(){
    let n = 0;
    for (let i = 0; i < W.length; i++) if (inScope(i) && !isProficient(i)) n++;
    return n;
  }

  /* ================= 词表（虚拟滚动） ================= */
  const RH = 52;
  let filt = [];
  /** 每本词书独立保留搜索、筛选、滚动位置与活动行；只有主动改筛选才回顶部。 */
  const listUiByBook = {};
  let listActiveWord = null;
  let listActiveAction = "open-word";
  function listUiFor(id){
    if (!listUiByBook[id]) {
      listUiByBook[id] = {
        q: "", fst: "all", fsc: "scope",
        scrollTop: 0, activeWord: null, activeAction: "open-word"
      };
    }
    return listUiByBook[id];
  }
  function saveListUi(){
    const ui = listUiFor(currentBookId);
    if ($("#q")) ui.q = $("#q").value;
    if ($("#fst")) ui.fst = $("#fst").value || "all";
    if ($("#fsc")) ui.fsc = $("#fsc").value || "scope";
    if ($("#listScroll")) ui.scrollTop = $("#listScroll").scrollTop || 0;
    ui.activeWord = listActiveWord;
    ui.activeAction = listActiveAction;
  }
  function restoreListUi(id){
    const ui = listUiFor(id);
    if ($("#q")) $("#q").value = ui.q;
    if ($("#fst")) $("#fst").value = ui.fst;
    if ($("#fsc")) $("#fsc").value = ui.fsc;
    listActiveWord = ui.activeWord;
    listActiveAction = ui.activeAction || "open-word";
    if ($("#listScroll")) $("#listScroll").scrollTop = ui.scrollTop || 0;
  }
  function listStatusText(i){
    const p = st(i);
    return isProficient(i) ? "熟练" : isMastered(i) ? "已掌握" : (hasMainProgress(p) ? "第" + p[0] + "档" : "未学");
  }
  function announceListRow(){
    const el = $("#listAnnouncement");
    if (!el) return;
    const pos = listActiveWord == null ? -1 : filt.indexOf(listActiveWord);
    if (pos < 0) { el.textContent = "词表共 " + filt.length + " 行"; return; }
    const x = W[filt[pos]];
    el.textContent = "第 " + (pos + 1) + " 行，共 " + filt.length + " 行；" + x.w + "，" + listStatusText(filt[pos]);
  }
  function applyFilter(resetScroll = true){
    const q = $("#q").value.trim().toLowerCase();
    const fs = $("#fst").value, sc = $("#fsc").value;
    const now = Date.now();
    filt = [];
    for (let i = 0; i < W.length; i++) {
      const x = W[i];
      if (sc === "scope" && !inScope(i)) continue;
      if (sc === "high" && x.f < 5) continue;
      if (sc === "cold" && x.f > 2) continue;
      if (sc === "ky" && x.ky !== 1) continue;
      const p = st(i);
      const proficient = isProficient(i);
      if (proficient && fs !== "proficient") continue;
      if (fs === "proficient" && !proficient) continue;
      if (fs === "active" && (proficient || isMastered(i))) continue;
      if (fs === "new" && (proficient || hasMainProgress(p))) continue;
      if (fs === "learn" && (proficient || !hasMainProgress(p) || p[0] >= MASTER)) continue;
      if (fs === "due" && (proficient || !hasMainProgress(p) || p[0] >= MASTER || p[1] > now)) continue;
      if (fs === "done" && (proficient || !isMastered(i))) continue;
      if (fs === "wrong" && (proficient || !p || p[3] === 0)) continue;
      if (fs === "star" && !isStar(i)) continue;
      if (q && x.w.indexOf(q) < 0 && x.m.toLowerCase().indexOf(q) < 0) continue;
      filt.push(i);
    }
    filt.sort((a, b) => (fs === "due" ? st(a)[1] - st(b)[1] : 0) || W[a].r - W[b].r);
    $("#listCount").textContent = "共 " + filt.length + " 词"
      + (storageOK ? "" : "　·　当前环境无法保存进度");
    const empty = $("#listEmpty");
    if (empty) empty.hidden = filt.length > 0;
    $("#listWrap").hidden = !filt.length;
    const inner = $("#listInner");
    inner.style.height = (filt.length * RH) + "px";
    if (resetScroll) {
      $("#listScroll").scrollTop = 0;
      listActiveWord = filt.length ? filt[0] : null;
      listActiveAction = "open-word";
    } else {
      $("#listScroll").scrollTop = Math.min($("#listScroll").scrollTop, Math.max(0, filt.length * RH - $("#listScroll").clientHeight));
      if (listActiveWord == null || filt.indexOf(listActiveWord) < 0) {
        listActiveWord = filt.length ? filt[0] : null;
        listActiveAction = "open-word";
      }
    }
    saveListUi();
    renderRows();
    renderDrillEntry();
  }
  function renderRows(){
    const sc = $("#listScroll"), top = sc.scrollTop, h = sc.clientHeight;
    const inner = $("#listInner"), focused = document.activeElement;
    const focusAction = focused?.dataset?.openWord !== undefined ? "open-word"
      : focused?.dataset?.proficient !== undefined ? "proficient" : null;
    const focusWord = focusAction === "open-word" ? focused.dataset.openWord : focused?.dataset?.proficient;
    const hasFocus = focusAction && inner.contains?.(focused);
    if (!filt.length) {
      if (inner.innerHTML !== "") inner.innerHTML = "";
      return;
    }
    const s = Math.max(0, Math.floor(top / RH) - 6);
    const e = Math.min(filt.length, Math.ceil((top + h) / RH) + 6);
    let activePos = listActiveWord == null ? -1 : filt.indexOf(listActiveWord);
    if (activePos < s || activePos >= e) activePos = Math.min(filt.length - 1, Math.max(0, s));
    listActiveWord = filt[activePos];
    if (!hasFocus) listActiveAction = "open-word";
    let html = "";
    for (let k = s; k < e; k++) {
      const i = filt[k], x = W[i], p = st(i);
      const active = k === activePos;
      const proficient = isProficient(i);
      const cls = proficient ? "badge-proficient" : isMastered(i) ? "st2" : (hasMainProgress(p) ? "st1" : "st0");
      const txt = listStatusText(i);
      const wordTab = active && listActiveAction === "open-word" ? "0" : "-1";
      const profTab = active && listActiveAction === "proficient" ? "0" : "-1";
      html += '<div class="row' + (active ? " row-active" : "") + '" data-i="' + i + '" style="top:' + (k * RH) + 'px">' +
        '<span class="c-rank">#' + x.r + "</span>" +
        '<button type="button" class="c-word row-word" data-open-word="' + i + '" tabindex="' + wordTab + '" aria-label="查看 ' + esc(x.w) + ' 详情">' + esc(x.w) + (isStar(i) ? " ★" : "") + "</button>" +
        '<span class="c-ph">' + esc(x.ph || "") + "</span>" +
        '<span class="c-mean">' + esc(x.m || "—") + "</span>" +
        '<span class="c-st ' + cls + '">' + txt + '</span>' +
        '<div class="c-actions row-actions"><button type="button" data-proficient="' + i + '" tabindex="' + profTab + '" aria-label="' + (proficient ? "取消" : "标为") + '熟练：' + esc(x.w) + '">' + (proficient ? "取消熟练" : "标为熟练") + '</button></div></div>';
    }
    if (inner.innerHTML === html) return;
    inner.innerHTML = html;
    if (hasFocus) {
      const target = inner.querySelector?.('[data-' + focusAction + '="' + focusWord + '"]');
      (target || sc).focus?.({preventScroll: true});
    }
  }

  function scrollListRowIntoView(pos){
    const sc = $("#listScroll");
    if (!sc) return;
    const top = pos * RH;
    if (top < sc.scrollTop) sc.scrollTop = top;
    else if (top + RH > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + RH - sc.clientHeight;
  }
  function focusListRow(pos, action){
    if (pos < 0 || pos >= filt.length) return false;
    listActiveWord = filt[pos];
    listActiveAction = action || "open-word";
    scrollListRowIntoView(pos);
    renderRows();
    const target = $("#listInner")?.querySelector?.('[data-' + listActiveAction + '="' + listActiveWord + '"]');
    target?.focus?.({ preventScroll: true });
    announceListRow();
    saveListUi();
    return true;
  }
  function navigateList(e){
    const target = e.target;
    const isWord = target.dataset?.openWord !== undefined;
    const isProficientButton = target.dataset?.proficient !== undefined;
    if (!isWord && !isProficientButton) return;
    const word = +(isWord ? target.dataset.openWord : target.dataset.proficient);
    const pos = filt.indexOf(word);
    if (pos < 0) return;
    listActiveWord = word;
    listActiveAction = isWord ? "open-word" : "proficient";
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      let next = pos;
      if (e.key === "ArrowDown") next++;
      else if (e.key === "ArrowUp") next--;
      else if (e.key === "Home") next = 0;
      else next = filt.length - 1;
      if (next < 0 || next >= filt.length) return;
      e.preventDefault();
      focusListRow(next, "open-word");
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      focusListRow(pos, e.key === "ArrowRight" ? "proficient" : "open-word");
      return;
    }
    if (e.key === "Tab") {
      // 行内最多两个停靠点：单词 → 熟练操作 → 离开列表；Shift+Tab 反向。
      if (!e.shiftKey && isWord) {
        e.preventDefault();
        focusListRow(pos, "proficient");
      } else if (e.shiftKey && isProficientButton) {
        e.preventDefault();
        focusListRow(pos, "open-word");
      }
    }
  }

  /* ================= 统计 ================= */
  function syncStatsChartHints(){
    $$("#v-stats .chart-scroll").forEach(scroll => {
      const hint = scroll.parentElement?.querySelector?.(".chart-mobile-hint");
      if (hint) hint.hidden = !scroll.clientWidth || scroll.scrollWidth <= scroll.clientWidth + 1;
    });
  }
  function selectStatsPoint(root, selector, hint, point){
    if (!root || !point) return;
    const nodes = Array.from(root.querySelectorAll?.(selector) || []);
    for (const node of nodes) {
      const selected = node === point;
      node.setAttribute?.("aria-pressed", String(selected));
      node.tabIndex = selected ? 0 : -1;
    }
    const label = point.dataset.dayLabel || point.dataset.fcLabel || point.dataset.stageLabel
      || point.getAttribute?.("aria-label") || "";
    if (hint) hint.textContent = label;
  }
  function bindStatsChart(id, selector, hintId, grid){
    const root = $(id);
    if (!root) return;
    const select = e => {
      const point = e.target.closest?.(selector);
      if (point && !point.disabled) selectStatsPoint(root, selector, $(hintId), point);
    };
    root.addEventListener("click", select);
    root.addEventListener("focusin", select);
    root.addEventListener("keydown", e => {
      const point = e.target.closest?.(selector);
      if (!point) return;
      const nodes = Array.from(root.querySelectorAll?.(selector) || []).filter(x => !x.disabled);
      const current = nodes.indexOf(point);
      let next = current;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = nodes.length - 1;
      else if (e.key === "ArrowLeft") next -= grid ? 7 : 1;
      else if (e.key === "ArrowRight") next += grid ? 7 : 1;
      else if (grid && e.key === "ArrowUp") next--;
      else if (grid && e.key === "ArrowDown") next++;
      else return;
      e.preventDefault();
      const target = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
      if (target) {
        selectStatsPoint(root, selector, $(hintId), target);
        target.focus?.({preventScroll: true});
        target.scrollIntoView?.({block: "nearest", inline: "nearest"});
      }
    });
  }
  function renderHeatmap(){
    const root = $("#heatmap");
    if (!root) return;
    const cells = heatmapData(S.days, todayStr(), 12);
    const weeks = 12;
    let months = "";
    let lastM = -1;
    let lastLabelW = -99;
    for (let w = 0; w < weeks; w++) {
      const m = +cells[w * 7].date.slice(5, 7);
      // 相邻月标签至少隔 2 列，避免「7月8月」粘连
      if (m !== lastM && w - lastLabelW >= 2) {
        months += '<span class="hm-m">' + m + "月</span>";
        lastM = m;
        lastLabelW = w;
      } else {
        if (m !== lastM) lastM = m;
        months += '<span class="hm-m"></span>';
      }
    }
    let body = "";
    for (const c of cells) {
      const label = c.date + "：学习 " + c.vol + " 次（新词 " + c.n + "，复习 " + Math.max(0, c.r - c.n) + "）";
      body += '<button type="button" class="hm-cell' + (c.future ? " future" : "") + '" data-level="' + c.level + '"' +
        (c.future ? " disabled" : ' tabindex="' + (c.date === todayStr() ? "0" : "-1") + '" aria-pressed="false"') +
        ' aria-label="' + esc(label) + '" title="' + esc(label) + '"></button>';
    }
    root.innerHTML =
      '<div class="hm-months" aria-hidden="true"><span class="hm-m gap"></span>' + months + "</div>" +
      '<div class="hm-body">' +
        '<div class="hm-days" aria-hidden="true">' +
          "<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>" +
        "</div>" +
        '<div class="hm-grid" role="group" aria-label="近 12 周每日学习量，方向键切换日期">' + body + "</div>" +
      "</div>";
    const tip = $("#heatmapTip");
    if (tip) tip.textContent = "选择格子查看当日学习量；方向键可切换日期";
    root.onmouseover = (e) => hmPeek(e);
    root.onmouseleave = () => {
      const chosen = root.querySelector?.('.hm-cell[aria-pressed="true"]');
      const t = $("#heatmapTip");
      if (t) t.textContent = chosen?.getAttribute?.("aria-label") || "选择格子查看当日学习量；方向键可切换日期";
    };
  }
  function hmPeek(e){
    const tip = $("#heatmapTip");
    if (!tip || !e || !e.target) return;
    const t = e.target;
    const label = (t.getAttribute && (t.getAttribute("title") || t.getAttribute("aria-label"))) || "";
    if (t.classList && t.classList.contains("hm-cell") && !t.classList.contains("future")) {
      tip.textContent = label;
      if (e.type !== "mouseover") selectStatsPoint($("#heatmap"), ".hm-cell", tip, t);
    }
  }

  function renderDrillEntry(){
    const n = wrongWordIndices().length;
    const btn = $("#btnDrill");
    if (btn) {
      btn.textContent = drillMode ? "退出特训" : "错词特训";
      btn.setAttribute?.("aria-label", drillMode ? "退出错词特训，回到普通背诵" : "进入错词特训");
      btn.onclick = () => { if (drillMode) exitDrill(); else startDrill(); };
      if ("disabled" in btn) btn.disabled = !drillMode && n === 0;
    }
    const hint = $("#drillHint");
    if (hint) {
      hint.textContent = drillMode
        ? "错词特训进行中 · 退出后回到原来的背诵进度"
        : n ? "错词本 " + n + " 词，可专项突破" : "";
    }
    const listBtn = $("#btnDrillList");
    if (listBtn) {
      const fs = $("#fst") ? $("#fst").value : "all";
      const showList = fs === "wrong" && n > 0;
      listBtn.hidden = !showList;
      if (showList) {
        listBtn.textContent = "一键特训（" + n + "）";
        listBtn.onclick = () => { if (startDrill()) show("study"); };
      }
    }
  }

  function renderMasteryMeter(tot, mastered, learning){
    const el = $("#masteryMeter");
    if (!el) return;
    const rate = pctOf(mastered, tot);
    const unseen = Math.max(0, tot - mastered - learning);
    el.innerHTML = tot
      ? '<div class="mm-head"><span>当前背诵范围掌握率</span><b>' + rate + '%</b></div>' +
        '<div class="mm-track" role="img" aria-label="已掌握 ' + mastered + ' 词，学习中 ' + learning + ' 词，未学 ' + unseen + ' 词">' +
          '<i class="mm-mastered" style="width:' + (mastered / tot * 100) + '%"></i>' +
          '<i class="mm-learning" style="width:' + (learning / tot * 100) + '%"></i>' +
        '</div>' +
        '<div class="mm-meta">已掌握 ' + mastered + ' · 学习中 ' + learning + ' · 未学 ' + unseen + '</div>'
      : '<p class="chart-hint">当前筛选范围没有可背诵的词，先调整设置页的词库筛选。</p>';
  }
  function renderDueForecast(){
    const el = $("#forecast");
    if (!el) return;
    const fc = dueForecast(14);
    const mx = Math.max(1, ...fc.counts);
    el.innerHTML = fc.counts.map((v, i) => {
      const h = v ? Math.max(4, Math.round(v / mx * 100)) : 0;
      const day = fc.dates[i];
      const detail = i === 0
        ? day + "：待复习 " + v + " 词" + (fc.overdue ? "（已到期 " + fc.overdue + "）" : "")
        : day + "：到期 " + v + " 词";
      return '<button type="button" class="fc-col' + (i === 0 ? " today" : "") + '" tabindex="' + (i === 0 ? "0" : "-1") + '" aria-pressed="false" aria-describedby="forecastHint" data-fc-label="' + esc(detail) +
        '" aria-label="' + esc(detail) + '" title="' + esc(detail) + '">' +
        '<span class="fc-count">' + (v || "") + "</span>" +
        '<span class="fc-plot"><span class="fc-bar' + (v ? "" : " zero") + '" style="height:' + h + '%"></span></span>' +
        "<em>" + fc.labels[i] + "</em></button>";
    }).join("");
    if (fc.total) {
      const parts = ["今日待复习 " + fc.counts[0] + " 词" + (fc.overdue ? "（已到期 " + fc.overdue + "）" : "")];
      parts.push("7 天内（含今天）" + fc.next7);
      parts.push("14 天内（含今天）" + fc.total);
      if (fc.later) parts.push("14 天后另有 " + fc.later + " 词");
      if (fc.peak >= 0) {
        const pl = fc.peak === 0 ? "今天" : fc.peak === 1 ? "明天" : fc.dates[fc.peak].slice(5).replace("-", "/");
        parts.push("峰值 " + pl + " · " + fc.peakCount + " 词");
      }
      $("#forecastSummary").textContent = parts.join(" · ");
      $("#forecastHint").textContent = "点击柱形查看日期与到期词数";
    } else {
      $("#forecastSummary").textContent = "未来 14 天没有到期复习";
      $("#forecastHint").textContent = "学完第一批词后，这里会出现未来两周的复习负荷曲线";
    }
  }
  function renderFreqMastery(){
    const el = $("#freqMastery");
    if (!el) return;
    const data = frequencyMastery();
    const summary = $("#freqMasterySummary");
    if (!data.total) {
      el.innerHTML = '<p class="chart-hint">当前筛选范围没有可统计的词。</p>';
      if (summary) summary.textContent = "";
      return;
    }
    el.innerHTML = data.rows.map(r => {
      const mp = r.mastered / r.total * 100;
      const lp = r.learning / r.total * 100;
      const up = r.unseen / r.total * 100;
      const label = r.label + "（" + r.range + "）：共 " + r.total + " 词，已掌握 " + r.mastered +
        "，学习中 " + r.learning + "，未学 " + r.unseen;
      return '<div class="fm-row">' +
        '<div class="fm-head"><b>' + r.label + "</b><span>" + r.range + "</span><em>" + r.total +
          " 词</em><strong>" + pctOf(r.mastered, r.total) + "%</strong></div>" +
        '<div class="fm-bar" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
          '<i class="fm-mastered" style="width:' + mp + '%"></i>' +
          '<i class="fm-learning" style="width:' + lp + '%"></i>' +
          '<i class="fm-unseen" style="width:' + up + '%"></i>' +
        "</div></div>";
    }).join("");
    const parts = ["全范围 " + pctOf(data.mastered, data.total) + "%"];
    const high = data.rows.find(r => r.key === "high");
    if (high) parts.push("高频段 " + pctOf(high.mastered, high.total) + "%");
    const lowRows = data.rows.filter(r => r.key === "low" || r.key === "rare");
    const lowTotal = lowRows.reduce((n, r) => n + r.total, 0);
    const lowMastered = lowRows.reduce((n, r) => n + r.mastered, 0);
    if (lowTotal) parts.push("低频段 " + pctOf(lowMastered, lowTotal) + "%");
    const weakest = data.rows.slice().sort((a, b) =>
      a.mastered / a.total - b.mastered / b.total)[0];
    if (weakest) parts.push("最低：" + weakest.label + " " + pctOf(weakest.mastered, weakest.total) + "%");
    if (summary) summary.textContent = parts.join(" · ");
  }
  function renderStats(){
    const tot = inScopeCount(), mas = scopedMasteredCount();
    let learning = 0, wrong = 0, unseen = 0;
    const dist = new Array(MASTER + 1).fill(0);
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (p && p[3] > 0) wrong++;
      if (!hasMainProgress(p)) { unseen++; continue; }
      dist[Math.min(p[0], MASTER)]++;
      if (p[0] < MASTER) learning++;
    }
    renderMasteryMeter(tot, mas, learning);
    const k = Object.keys(S.days).filter(k => S.days[k].r > 0).sort();
    const okAll = k.reduce((a, d) => a + S.days[d].ok, 0);
    const noAll = k.reduce((a, d) => a + S.days[d].no, 0);
    const kpiHtml = entries => entries.map(([a, b]) => '<div class="kpi"><b>' + b + "</b><span>" + a + "</span></div>").join("");
    $("#kpis").innerHTML = '<div class="stats-primary-kpis">' + kpiHtml([
      ["已掌握", mas], ["学习中", learning], ["连续打卡", streak() + " 天"],
      ["累计正确率", (okAll + noAll) ? Math.round(okAll / (okAll + noAll) * 100) + "%" : "—"]
    ]) + '</div><div class="stats-secondary-kpis">' + kpiHtml([
      ["未学", unseen], ["熟练（全词库）", proficientCount()],
      ["错词", wrong], ["收藏", Object.keys(S.stars || {}).length], ["学习天数", k.length], ["累计时长", fmtTime(S.timeSec)]
    ]) + "</div>";

    $("#stagesHint").textContent = learning + mas === 0
      ? "还没有开始学习 —— 学完第一个词，这里就会出现各档位的分布"
      : "";
    const stageUnseen = unseen;
    const stageDist = dist.slice();
    const stageSummary = $("#stagesSummary");
    if (stageSummary) stageSummary.textContent = "已学 " + (learning + mas) + " 词 · 未学 " + stageUnseen + " 词未计入；选择档位查看词数";
    const mx = Math.max(1, ...stageDist);
    $("#stages").innerHTML = stageDist.map((v, i) => {
      const label = (i === MASTER ? "已掌握" : i === 0 ? "重学（第零档）" : "第" + i + "档") + "：" + v + " 词";
      return '<button type="button" class="chart-bar" tabindex="' + (i === 0 ? "0" : "-1") + '" aria-pressed="false" aria-describedby="stagesHint" data-stage-label="' + esc(label) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span class="stage-plot"><span class="stage-fill" style="height:' + (v ? Math.max(3, v / mx * 100) : 0) + '%"><i>' + (v || "") + '</i></span></span><u>' + (i === MASTER ? "掌握" : i === 0 ? "重学" : i) + "</u></button>";
    }).join("");

    const last = [];
    let sumN = 0, sumR = 0, sumOk = 0, sumNo = 0;
    for (let d = 13; d >= 0; d--) {
      const t = new Date(); t.setDate(t.getDate() - d);
      const key = todayStr(t);
      const v = S.days[key] || {n: 0, r: 0, ok: 0, no: 0};
      last.push({key: key, date: t, n: v.n, r: v.r, ok: v.ok, no: v.no});
      sumN += v.n; sumR += v.r; sumOk += v.ok; sumNo += v.no;
    }
    const dmx = Math.max(1, ...last.map(x => x.r));
    $("#days").innerHTML = last.map((x, idx) => {
      const todayCol = idx === last.length - 1;
      const label = todayCol ? "今天" : idx === last.length - 2 ? "昨天"
        : x.date.getDate() === 1 ? (x.date.getMonth() + 1) + "/1" : String(x.date.getDate());
      const h = x.r ? Math.max(3, Math.round(x.r / dmx * 100)) : 0;
      const nh = x.r ? x.n / x.r * 100 : 0;
      const rh = x.r ? (x.r - x.n) / x.r * 100 : 0;
      const acc = (x.ok + x.no) ? Math.round(x.ok / (x.ok + x.no) * 100) + "%" : "—";
      const detail = x.key + "：新词 " + x.n + " · 复习 " + (x.r - x.n) + " · 正确率 " + acc;
      return '<button type="button" class="day-col' + (todayCol ? " today" : "") +
        '" tabindex="' + (todayCol ? "0" : "-1") + '" aria-pressed="false" aria-describedby="daysHint" data-day-label="' + esc(detail) + '" aria-label="' + esc(detail) + '" title="' + esc(detail) + '">' +
        '<span class="day-plot"><span class="day-bar' + (x.r ? "" : " zero") + '" style="height:' + h + '%">' +
          (x.n ? '<i class="day-new" style="height:' + nh + '%"></i>' : "") +
          (x.r - x.n > 0 ? '<i class="day-rev" style="height:' + rh + '%"></i>' : "") +
        "</span></span><em>" + label + "</em></button>";
    }).join("");
    $("#daysSummary").textContent = sumR
      ? "近 14 天：新词 " + sumN + " · 复习 " + (sumR - sumN) + " · 正确率 " +
        ((sumOk + sumNo) ? Math.round(sumOk / (sumOk + sumNo) * 100) + "%" : "—")
      : "";
    $("#daysHint").textContent = sumR ? "" : "最近 14 天还没有学习记录";
    renderDueForecast();
    renderFreqMastery();
    renderHeatmap();
    renderDrillEntry();
    renderReviewPlan();
    renderSurvey();
    syncStatsChartHints();
  }

  /* ================= 打印生词本（界面） ================= */
  function renderPrintBook(){
    const source = ($("#printSource") && $("#printSource").value) || "wrong";
    const entries = printBookEntries(source);
    const label = PRINT_SRC_LABEL[source] || "错词本";
    const date = todayStr();
    const body = $("#printBody");
    const count = $("#printCount");
    if (count) {
      count.textContent = entries.length
        ? "共 " + entries.length + " 词 · 来源：" + label
        : "「" + label + "」暂无词条，换一个来源试试";
    }
    if (!body) return entries;
    if (!entries.length) {
      body.innerHTML = '<p class="print-empty">暂无词条</p>';
      return entries;
    }
    let html = '<div class="print-book">' +
      '<header class="print-book-head">' +
        '<h3 class="print-book-title">' + esc(currentBook().name + "生词本") + "</h3>" +
        '<p class="print-book-sub">' + esc(date) + " · " + esc(label) + " · 共 " + entries.length + " 词</p>" +
      "</header>" +
      '<ol class="print-entries">';
    for (const e of entries) {
      html += '<li class="print-entry">' +
        '<input type="checkbox" class="print-check" aria-label="自测 ' + esc(e.w) + '">' +
        '<div class="print-main">' +
          '<div class="print-word-line"><b class="print-word">' + esc(e.w) + "</b>" +
            (e.ph ? '<span class="print-ph">/' + esc(e.ph) + "/</span>" : "") + "</div>" +
          '<div class="print-mean">' + esc(e.m || "—") + "</div>" +
          '<div class="print-meta">' + esc(printMetaText(e.wrong, e.status, e.star)) + "</div>" +
        "</div></li>";
    }
    body.innerHTML = html + "</ol></div>";
    return entries;
  }
  function openPrintBook(){
    const sel = $("#printSource");
    if (sel) {
      if (wrongWordIndices().length) sel.value = "wrong";
      else if (printBookEntries("star").length) sel.value = "star";
      else sel.value = "filter";
    }
    renderPrintBook();
    openSheet("#printSheet");
  }
  async function copyPrintMarkdown(){
    const source = ($("#printSource") && $("#printSource").value) || "wrong";
    const entries = printBookEntries(source);
    const md = printBookMarkdown(entries, {
      date: todayStr(),
      sourceLabel: PRINT_SRC_LABEL[source] || "错词本"
    });
    $("#printMarkdownCopy")?.remove?.();
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(md);
        ok = true;
      }
    } catch (e) { /* fall through */ }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.id = "printMarkdownCopy";
      ta.value = md;
      ta.setAttribute?.("readonly", "");
      ta.setAttribute?.("aria-label", "生词本 Markdown，自动复制失败时可手动复制");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      // 放在浮层内，确保焦点陷阱和 inert 不会阻止手动复制。
      const host = $("#printSheet .print-toolbar") || document.body;
      const focusBefore = document.activeElement;
      host.appendChild(ta);
      ta.focus?.();
      ta.select?.();
      try { ok = document.execCommand && document.execCommand("copy"); } catch (e) { ok = false; }
      if (ok) {
        ta.remove?.();
        focusBefore?.focus?.({ preventScroll: true });
      } else {
        ta.style.position = "static";
        ta.style.left = "";
        ta.style.width = "100%";
        ta.style.boxSizing = "border-box";
        ta.rows = 8;
        ta.focus?.();
        ta.select?.();
      }
    }
    toast(ok ? "已复制为 Markdown（" + entries.length + " 词）" : "自动复制失败，已选中 Markdown；请按 Ctrl/Cmd+C 复制");
    return md;
  }

  /* ================= 设置 ================= */
  function markSettingsEditing(){
    const el = $("#settingsSaveState");
    if (!el) return;
    el.dataset.state = "editing";
    if (el.textContent !== "调整中 · 松手后保存") el.textContent = "调整中 · 松手后保存";
  }
  function markSettingsSaved(){
    const el = $("#settingsSaveState");
    if (!el) return;
    const ok = storageOK && !blockedBooks.has(currentBookId);
    el.dataset.state = ok ? "saved" : "error";
    const text = ok ? "已自动保存" : "保存失败，请导出进度备份";
    if (el.textContent !== text) el.textContent = text;
  }
  function updateSettingsSummary(){
    const el = $("#settingsSummary");
    if (el) {
      const order = {freq: "按词频顺序", shuffle: "每组随机打乱", wrong: "错词优先"};
      el.textContent = currentBook().name + " · 每日 " + S.settings.dailyNew + " 个新词 · " + (order[S.settings.order] || "按词频顺序");
    }
    $$("[data-step-target]").forEach(b => {
      const input = $("#" + b.dataset.stepTarget);
      if (!input) return;
      const value = Number(input.value);
      b.disabled = +b.dataset.stepDir < 0 ? value <= +input.min : value >= +input.max;
    });
  }
  function syncSettingsNav(){
    if (!$("#v-set")?.classList.contains("on")) return;
    const main = $("#main");
    if (!main?.getBoundingClientRect) return;
    const boundary = main.getBoundingClientRect().top + (window.innerWidth <= 840 ? 100 : 52);
    let current = "settings-plan";
    $$(".settings-section").forEach(el => {
      if (el.getBoundingClientRect?.().top <= boundary) current = el.id;
    });
    if (main.scrollHeight && main.scrollTop + main.clientHeight >= main.scrollHeight - 2) current = "settings-rhythm";
    $$(".settings-nav a").forEach(a => {
      const on = a.getAttribute?.("href") === "#" + current;
      const wasOn = a.classList.contains("on");
      a.classList.toggle("on", on);
      if (on) a.setAttribute?.("aria-current", "location");
      else a.removeAttribute?.("aria-current");
      if (on && !wasOn && window.innerWidth <= 840) {
        const nav = a.parentElement;
        if (nav && a.offsetLeft < nav.scrollLeft) nav.scrollLeft = a.offsetLeft;
        else if (nav && a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = a.offsetLeft + a.offsetWidth - nav.clientWidth;
      }
    });
  }
  function bindSet(){
    const focusBefore = document.activeElement;
    const focusedPmin = focusBefore?.closest?.("#pminPresets") ? focusBefore.dataset.pmin : null;
    const focusedPos = focusBefore?.closest?.("#posChips") ? focusBefore.dataset.pos : null;
    const s = S.settings;
    applyBookText();
    $("#dailyNew").value = s.dailyNew;
    $("#order").value = s.order;
    $("#fmin").value = s.fmin;
    $("#fmax").value = s.fmax || "";
    $("#pmin").value = s.pmin;
    $("#kyOnly").checked = !!s.kyOnly;
    renderPosChips();
    syncPresets();
    applyTheme();
    $("#showPh").checked = s.showPh;
    $("#showEx").checked = s.showEx;
    $("#showFm").checked = s.showFm;
    $("#autoSpk").checked = s.autoSpk;
    const singleCharEl = $("#singleCharKeys");
    if (singleCharEl) singleCharEl.checked = s.singleCharKeys !== false;
    updateScopeCount();
    renderFreqHistogram();
    renderKeys();
    updateSettingsSummary();
    markSettingsSaved();
    $("#curveInfo").innerHTML =
      '<div class="rhythm-rules"><p><b>先回忆，再判定</b><span>选择「会」或「不会」后显示释义；未判定时不会翻页。</span></p>' +
      '<p><b>会，进入下一档</b><span>不会则归零，5 分钟后重来，并在本组队尾重考。可随时改判。</span></p></div>' +
      '<ol class="rhythm-timeline">' + STAGES.map((x, i) => '<li><span>' + (i + 1) + '</span><b>' + esc(x.t) + '</b></li>').join("") + '</ol>' +
      '<p class="setting-footnote">完成 10 个间隔档位后进入已掌握，完整周期约 120 天。</p>';
    if (focusedPmin != null) $('#pminPresets button[data-pmin="' + focusedPmin + '"]')?.focus?.({preventScroll: true});
    else if (focusedPos != null) $('#posChips button[data-pos="' + focusedPos + '"]')?.focus?.({preventScroll: true});
  }
  function onSet(){
    const before = JSON.stringify([S.settings.dailyNew, S.settings.order, S.settings.fmin, S.settings.fmax, S.settings.pmin, S.settings.kyOnly]);
    S.settings.dailyNew = integer(+$("#dailyNew").value, 30, 1, 500);
    S.settings.order = $("#order").value;
    const fmaxRaw = +$("#fmax").value;
    S.settings.fmin = integer(+$("#fmin").value, 1, 1, 9999);
    S.settings.fmax = (fmaxRaw > 0) ? Math.max(S.settings.fmin, integer(fmaxRaw, 0, 0, 9999)) : 0;
    // pmin 上限 = 当前词书的套卷数（考研 46）
    S.settings.pmin = integer(+$("#pmin").value, 0, 0, currentBook().paperCount || 46);
    S.settings.kyOnly = $("#kyOnly").checked;
    S.settings.showPh = $("#showPh").checked;
    S.settings.showEx = $("#showEx").checked;
    S.settings.showFm = $("#showFm").checked;
    S.settings.autoSpk = $("#autoSpk").checked;
    const singleCharEl = $("#singleCharKeys");
    if (singleCharEl) S.settings.singleCharKeys = singleCharEl.checked;
    save();
    updateScopeCount();
    markSettingsSaved();
    if (before !== JSON.stringify([S.settings.dailyNew, S.settings.order, S.settings.fmin, S.settings.fmax, S.settings.pmin, S.settings.kyOnly])) startSession();
  }
  function updateScopeCount(){
    const n = inScopeCount();
    $("#scopeLabel").textContent = "背诵范围 " + n + " / " + W.length + " 词";
    const sc = $("#scopeCount");
    sc.textContent = n.toLocaleString() + " 个单词";
    sc.style.color = n ? "var(--accent)" : "var(--no)";
    const empty = $("#scopeEmpty");
    if (empty) empty.hidden = n > 0;
    const start = $("#btnStartFromSettings");
    if (start) start.disabled = !n;
    updateSettingsSummary();
  }
  function syncPresets(){
    const s = S.settings;
    $$("#presets button").forEach(b => {
      const on = (+b.dataset.fmin === (s.fmin || 1)) &&
        ((b.dataset.fmax || "") === (s.fmax ? String(s.fmax) : ""));
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    $$("#pminPresets button").forEach(b => {
      const on = +b.dataset.pmin === (s.pmin || 0);
      b.classList.toggle("on", on);
      b.setAttribute?.("aria-pressed", String(on));
    });
    $$("[data-combo]").forEach(b => {
      const combo = b.dataset.combo;
      const pos = s.pos || [];
      const matches = combo === "core" ? s.fmin === 5 && !s.fmax && s.pmin === 3 && !s.kyOnly && !pos.length
        : combo === "cold" ? s.fmin === 1 && s.fmax === 2 && !s.pmin && !s.kyOnly && !pos.length
        : combo === "adj" ? s.fmin === 1 && !s.fmax && !s.pmin && !s.kyOnly && pos.length === 1 && pos[0] === "a"
        : s.fmin === DEF.settings.fmin && s.fmax === DEF.settings.fmax && s.pmin === DEF.settings.pmin && s.kyOnly === DEF.settings.kyOnly && !pos.length;
      b.classList.toggle("on", matches);
      b.setAttribute?.("aria-pressed", String(matches));
    });
  }
  function renderPosChips(){
    const sel = S.settings.pos || [];
    $("#posChips").innerHTML = POSCHIPS.map(c =>
      '<button type="button" data-pos="' + c.k + '" aria-pressed="' + (sel.indexOf(c.k) >= 0) + '" class="' + (sel.indexOf(c.k) >= 0 ? "on" : "") + '">' +
      c.t + "</button>"
    ).join("");
    $$("#posChips button").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.pos;
        const cur = (S.settings.pos || []).slice();
        const i = cur.indexOf(k);
        if (i >= 0) cur.splice(i, 1); else cur.push(k);
        S.settings.pos = cur;
        save();
        startSession();
        renderPosChips();
        $('#posChips button[data-pos="' + k + '"]')?.focus?.({preventScroll: true});
        syncPresets();
        updateScopeCount();
        renderFreqHistogram();
        applyFilter();
        renderStats();
        markSettingsSaved();
      };
    });
  }

  /* ================= 词书 UI（品牌 / 动态文案 / 选择浮层） ================= */
  /** 品牌区、页面标题与词书入口展示当前词书 */
  function applyBrand(){
    const book = currentBook();
    const mark = $("#brandMark");
    if (mark) mark.textContent = book.mark;
    const title = $("#brandTitle");
    if (title) title.textContent = book.name + "单词";
    document.title = book.name + "单词背诵";
    const btn = $("#btnBooks");
    if (btn) {
      btn.textContent = "词书⌄";
      btn.setAttribute?.("aria-label", "切换词书（当前 " + book.name + "）");
      btn.setAttribute?.("title", "切换词书（当前 " + book.name + "）");
    }
  }
  /** 设置页随当前词书变化的文案、上限与预设 */
  function applyBookText(){
    const book = currentBook();
    const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
    setText("#kyOnlyLabel", book.kyOnlyLabel);
    setText("#kyOnlyDesc", "开启后只背 ECDICT 标注为" + book.tagLabel + "的词");
    setText("#fRangeDesc", "按 " + book.paperCount + " " + book.paperUnit +
      "的正文词频选择范围。拖动两端手柄，选择这次想背的单词。");
    setText("#pminDesc", "本词书共 " + book.paperCount + " " + book.paperUnit +
      "。跨试卷覆盖可补充词频信息：只在一套卷里反复出现的词，可能与该套卷的主题有关");
    setText("#fscKy", "大纲词");
    const pmin = $("#pmin");
    if (pmin) {
      pmin.max = String(book.paperCount);
      pmin.setAttribute?.("max", String(book.paperCount));
    }
    renderPminPresets();
  }
  /** 「至少出现在几套卷子里」预设随 paperCount 动态（超过上限的档位不显示） */
  function renderPminPresets(){
    const el = $("#pminPresets");
    if (!el) return;
    const pc = currentBook().paperCount;
    const items = [[0, "不限"], [2, "≥2 套（推荐）"], [3, "≥3 套"], [5, "≥5 套"], [10, "≥10 套"], [20, "≥20 套"]]
      .filter(([v]) => v === 0 || v <= pc);
    el.innerHTML = items.map(([v, t]) =>
      '<button type="button" data-pmin="' + v + '">' + t + "</button>").join("");
    $$("#pminPresets button").forEach(b => {
      b.onclick = () => {
        $("#pmin").value = b.dataset.pmin;
        onSet(); bindSet(); applyFilter(); renderStats();
        toast("已设为 " + b.textContent);
      };
    });
  }
  /** 词书选择列表：名称、词数 · 已学 · 已掌握，当前书高亮 */
  function renderBookList(){
    const list = $("#bookList");
    if (!list) return;
    list.innerHTML = BOOK_DEFS.map(def => {
      const book = BOOKS[def.id];
      const on = def.id === currentBookId;
      if (!book.available) {
        return '<button type="button" class="book-item disabled" data-book="' + esc(def.id) +
          '" data-unavailable="1" aria-disabled="true">' +
          '<span class="book-mark">' + esc(def.mark) + "</span>" +
          '<span class="book-main"><b class="book-name">' + esc(def.name) + "</b>" +
          '<span class="book-meta">词书数据未载入</span></span></button>';
      }
      const st = bookStats(def.id);
      const meta = book.words.length + " 词 · " + (st.ok
        ? "已学 " + st.learned + " · 已掌握 " + st.mastered
        : "记录无法读取");
      return '<button type="button" class="book-item' + (on ? " on" : "") +
        '" data-book="' + esc(def.id) + '" aria-pressed="' + on + '">' +
        '<span class="book-mark">' + esc(def.mark) + "</span>" +
        '<span class="book-main"><b class="book-name">' + esc(def.name) + "</b>" +
        '<span class="book-meta">' + esc(meta) + "</span></span>" +
        (on ? '<span class="book-check" aria-hidden="true">✓</span>' : "") +
        "</button>";
    }).join("");
  }
  function openBookSheet(){
    renderBookList();
    openSheet("#bookSheet");
    const btn = $("#btnBooks");
    if (btn) btn.setAttribute?.("aria-expanded", "true");
  }

  /* ================= 按键 ================= */
  function keyName(k){
    if (k === " ") return "空格";
    if (k === "ArrowLeft") return "←";
    if (k === "ArrowRight") return "→";
    if (k === "ArrowUp") return "↑";
    if (k === "ArrowDown") return "↓";
    if (k && k.length === 1) return k.toUpperCase();
    return k || "?";
  }
  function keyMatch(e, k){
    if (!k) return false;
    if (k === " ") return e.key === " " || e.code === "Space";
    return (e.key || "").toLowerCase() === k.toLowerCase();
  }
  let rebinding = null;

  function renderKeys(){
    const K = S.settings.keys;
    const names = {know:"会", dont:"不会", next:"下一个", speak:"发音", star:"收藏", proficient:"熟练"};
    $$(".keybtn").forEach(b => {
      const a = b.dataset.k;
      if (rebinding === a) {
        b.textContent = "按下新按键…";
        b.classList.add("cap");
      } else {
        b.textContent = keyName(K[a]);
        b.classList.remove("cap");
      }
      b.setAttribute?.("aria-label", "修改" + names[a] + "快捷键，当前 " + keyName(K[a]));
      b.setAttribute?.("aria-pressed", String(rebinding === a));
    });
    const status = $("#keyBindingStatus");
    if (status) status.textContent = rebinding ? "正在修改「" + names[rebinding] + "」：按下新键，Esc 取消。" : "选择一个按键后直接按新键，Esc 取消。";
  }
  function captureKey(e){
    const k = (e.key === " " || e.code === "Space") ? " " : (e.key || "");
    if (k === "Escape") { rebinding = null; renderKeys(); return; }
    if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") return;
    if (e.ctrlKey || e.metaKey || e.altKey || !validKey(k)) {
      toast("请选择单个英文字母、数字或空格；Enter、方向键等为保留键"); return;
    }
    const K = S.settings.keys, act = rebinding;
    const dup = Object.keys(K).find(a => a !== act && keyMatch(e, K[a]));
    if (dup) {
      const names = {know: "会", dont: "不会", next: "下一个", speak: "发音", star: "收藏", proficient:"熟练"};
      toast("这个键已经被「" + names[dup] + "」占用了");
      return;
    }
    K[act] = k.toLowerCase();
    rebinding = null;
    save();
    renderKeys();
    renderCard();
    toast("已设为 " + keyName(k));
    markSettingsSaved();
  }

  /* ================= 快捷键浮层 ================= */
  function renderHelp(){
    const K = S.settings.keys;
    const items = [
      [keyName(K.know), "标记「会」并显示释义"],
      [keyName(K.dont), "标记「不会」并显示释义"],
      [keyName(K.next) + " / Enter", "下一个（须先判定）"],
      [keyName(K.speak), "发音"],
      [keyName(K.star), "收藏 / 取消收藏"],
      [keyName(K.proficient), "标为熟练并移出背诵队列"],
      ["Ctrl/Cmd + Z", "撤销上一步"],
      ["← / →", "不会 / 会（等价于判定）"],
      ["?", "打开 / 关闭本帮助"],
      ["Esc", "关闭浮层 / 取消改键"]
    ];
    $("#keyList").innerHTML = items.map(([k, t]) =>
      "<li><span>" + esc(t) + '</span><span class="k">' + esc(k) + "</span></li>"
    ).join("");
  }
  let activeSheet = null, previousFocus = null, detailWord = null;
  function openSheet(id){
    if (rebinding) { rebinding = null; renderKeys(); }
    hideExPop();
    if (activeSheet) closeSheet();
    previousFocus = document.activeElement;
    activeSheet = $(id);
    activeSheet.hidden = false;
    $("#main").inert = true;
    $(".top").inert = true;
    const panel = activeSheet.querySelector?.(".sheet-panel");
    if (panel) { panel.tabIndex = -1; panel.focus?.(); }
    fitVisibleWords();
  }
  function closeSheet(){
    if (!activeSheet) return;
    hideExPop();
    const closedId = activeSheet.id;
    if (closedId === "txtSplitSheet") txtSplitContext = null;
    if (closedId === "importSheet") pendingImport = null;
    activeSheet.hidden = true;
    activeSheet = null;
    $("#main").inert = false;
    $(".top").inert = false;
    if (closedId === "bookSheet") {
      const btn = $("#btnBooks");
      if (btn) btn.setAttribute?.("aria-expanded", "false");
    }
    // 关闭浮层后若回到背诵页，焦点归到卡片：避免焦点留在触发按钮（如 #btnBooks）上时，
    // 空格/回车先被按钮原生激活吞掉（曾导致切书后按空格又打开词书浮层）。
    const studyView = $("#v-study");
    if (studyView && studyView.classList.contains("on")) {
      const card = $("#card");
      if (card && card.focus) card.focus({ preventScroll: true });
      else if (previousFocus && previousFocus.isConnected) previousFocus.focus?.();
    } else if (previousFocus && previousFocus.isConnected && previousFocus !== document.body) {
      // 非背诵页：仅当触发元素不是 body 时归还焦点（body 不可聚焦，focus 无效）
      previousFocus.focus?.({ preventScroll: true });
    }
    previousFocus = null;
  }
  function openHelp(){
    renderHelp();
    openSheet("#helpSheet");
  }
  function closeHelp(){
    closeSheet();
  }
  function renderWordDetail(){
    const i = detailWord, x = W[i];
    if (!x) return;
    $("#wordTitle").textContent = x.w;
    $("#wordDetail").innerHTML =
      '<div class="tagrow"><span class="tag">词频 #' + x.r + '</span><span class="tag">' + x.f + ' 次 / ' + x.c + ' 套卷</span>' +
      '<span class="tag ' + (isProficient(i) ? "badge-proficient" : "") + '">' + esc(isProficient(i) ? "熟练 · 已移出背诵" : stageLabel(st(i) ? st(i)[0] : 0)) + '</span>' + wordBookTags(x.w) + '</div>' +
      '<p class="storage-note">' + esc(wordReviewLabel(i)) + '</p>' +
      (x.ph ? '<div class="ph">/' + esc(x.ph) + '/</div>' : '') +
      '<div class="mean">' + meaningHtml(x) + '</div>' +
      (x.ex ? '<div class="ex" data-ex-linked="1" tabindex="0" role="group" aria-expanded="false" aria-label="例句，左右方向键选词，回车查义">' + exHtml(x.ex, x) + '<span class="src">— ' + esc(srcBadge(x.src)) + '</span></div>' : '') +
      (x.fm ? '<div class="fm">词形：' + esc(x.fm) + '</div>' : '');
    bindExLookup($("#wordDetail"));
    $("#wordActions").innerHTML =
      '<button type="button" class="btn proficient" id="detailProficient">' + (isProficient(i) ? "取消熟练" : "标为熟练") + '</button>' +
      '<button type="button" class="btn ghost" id="detailStar">' + (isStar(i) ? "取消收藏" : "收藏") + '</button>' +
      '<button type="button" class="btn ghost" id="detailSpeak">发音</button>';
    $("#detailProficient").onclick = () => { setProficient(i, !isProficient(i)); renderWordDetail(); $("#detailProficient").focus?.(); };
    $("#detailStar").onclick = () => { toggleStar(i); applyFilter(false); renderWordDetail(); $("#detailStar").focus?.(); };
    $("#detailSpeak").onclick = () => speak(x.w);
    fitWord($("#wordTitle"));
  }
  function openWord(i){
    if (!W[i]) return;
    detailWord = i;
    renderWordDetail();
    openSheet("#wordSheet");
  }

  /* ================= 视图 ================= */
  function show(v){
    if (v !== "set" && rebinding) { rebinding = null; renderKeys(); }
    const wasList = $("#v-list").classList.contains("on");
    if (wasList && v !== "list") saveListUi();
    // 各视图共用 main 滚动容器；切页时从顶部开始，避免沿用设置页底部的位置。
    if (!$("#v-" + v).classList.contains("on")) $("#main").scrollTop = 0;
    $$(".view").forEach(x => x.classList.remove("on"));
    $("#v-" + v).classList.add("on");
    $$(".nav button").forEach(b => {
      b.classList.toggle("on", b.dataset.v === v);
      if (b.dataset.v === v) b.setAttribute?.("aria-current", "page");
      else b.removeAttribute?.("aria-current");
    });
    $("#main").classList.toggle("wide", v !== "study");
    if (v === "study") fitVisibleWords();
    if (v === "list") {
      // 首次进入且尚无保存状态时，尊重当前控件值（例如从统计页点「到期词」预设的筛选）。
      if (!wasList && listUiByBook[currentBookId]) restoreListUi(currentBookId);
      applyFilter(false);
      announceListRow();
    }
    if (v === "stats") renderStats();
    if (v === "set") { bindSet(); syncSettingsNav(); }
    updateBar();
  }
  function updateBar(){
    const v = $(".view.on");
    const id = v && v.id ? v.id.replace("v-", "") : "study";
    let pct = 0;
    if (id === "study") {
      pct = groupTotal ? Math.round(Math.min(answered, groupTotal) / groupTotal * 100) : 0;
    } else {
      const tot = Math.max(1, inScopeCount());
      pct = Math.round(scopedMasteredCount() / tot * 100);
    }
    const bar = $("#bar");
    if (bar) bar.style.width = pct + "%";
  }

  /* ================= Toast / 持续错误提示 ================= */
  let tt = null;
  function toast(m){
    const t = $("#toast");
    t.textContent = m;
    t.classList.add("on");
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove("on"), 2200);
  }
  function showAlert(title, body, opts){
    opts = opts || {};
    const el = $("#appAlert");
    if (!el) { toast(title + "：" + body); return; }
    el.dataset.kind = opts.kind || "general";
    const titleEl = $("#appAlertTitle"), bodyEl = $("#appAlertBody"), actions = $("#appAlertActions");
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (actions) {
      actions.innerHTML = "";
      const add = (label, fn, primary) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn sm " + (primary ? "primary" : "ghost");
        b.textContent = label;
        b.onclick = fn;
        actions.appendChild(b);
      };
      if (opts.recover) add("恢复导入前记录", recoverImportJournal, true);
      if (opts.rescue) add("救援导出", exportRescueBackup, true);
      if (opts.export) add("导出备份", exportBackupFile, !opts.rescue && !opts.recover);
      add("关闭", () => { el.hidden = true; }, false);
    }
    el.hidden = false;
  }
  function clearAlert(kind){
    const el = $("#appAlert");
    if (!el) return;
    if (kind && el.dataset.kind !== kind) return;
    el.hidden = true;
    el.dataset.kind = "";
  }
  function downloadJsonFile(name, data){
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove?.();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function exportBackupFile(){
    try {
      const data = buildExport();
      downloadJsonFile("背词进度_" + todayStr() + ".json", data);
      if (data.warnings && data.warnings.length) {
        showAlert("备份已导出，但有提醒", warningIds(data.warnings) + "。当前文件已包含全部可读取的词书。", {kind: "export"});
      } else {
        clearAlert("export");
        toast("进度备份已导出");
      }
      return data;
    } catch (err) {
      if (err && err.corrupted) {
        showAlert("无法常规导出", err.message, {kind: "export", rescue: true});
      } else {
        showAlert("导出失败", (err && err.message ? err.message : "未知错误") + "。现有记录未改动。", {kind: "export", export: true});
      }
      return null;
    }
  }
  function exportRescueBackup(){
    try {
      const data = buildRescueExport();
      downloadJsonFile("背词救援_" + todayStr() + ".json", data);
      showAlert("救援备份已导出", "文件包含正常词书与损坏词书的原始文本，但不能直接导入。请保留原文件，并在修复或重新导出正常备份前不要重置损坏词书。", {kind: "export"});
      return data;
    } catch (err) {
      showAlert("救援导出失败", (err && err.message ? err.message : "浏览器存储不可用") + "。请尝试复制浏览器存储或更换环境。", {kind: "export"});
      return null;
    }
  }

  /* ================= 导入确认 ================= */
  let pendingImport = null;
  function formatBackupTime(iso){
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "未记录";
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function renderImportPlan(plan){
    const summary = $("#importSummary");
    if (summary) {
      summary.textContent = (plan.version === 1 ? "旧版备份（v1）" : "备份 v" + plan.version)
        + " · " + (plan.exportedAt ? "导出于 " + formatBackupTime(plan.exportedAt) : "未记录导出时间")
        + " · 备份时词书：" + (plan.activeBook && BOOKS[plan.activeBook] ? BOOKS[plan.activeBook].name : "未记录");
    }
    const list = $("#importBookList");
    if (list) {
      list.innerHTML = plan.books.map(b =>
        '<div class="import-book"><b>' + esc(b.name) + "</b><span>已学 " + b.learned
        + " 词 · 已掌握 " + b.mastered + " 词 · 将替换本机同名记录</span></div>"
      ).join("");
    }
    const scope = $("#importScopeNote");
    if (scope) {
      scope.textContent = "导入会替换上述词书的学习记录、设置、收藏与每日统计；本机已有熟练标记会保留，其他词书不变。"
        + (plan.kind === "legacy" ? "旧版备份只恢复考研记录。" : "");
    }
  }
  function openImportConfirm(o){
    try {
      const plan = prepareImportPlan(o);
      pendingImport = {data: o, plan: plan};
      renderImportPlan(plan);
      openSheet("#importSheet");
    } catch (err) {
      pendingImport = null;
      showAlert("无法导入备份", (err && err.message ? err.message : "文件格式不正确") + "。现有记录未改动。", {kind: "import"});
    }
  }

  /* ================= 手势 ================= */
  function bindSwipe(){
    const card = $("#card");
    let x0 = 0, y0 = 0, tracking = false, pointerId = null;
    const hasSelection = () => Boolean(window.getSelection?.()?.toString());
    card.addEventListener("pointerdown", (e) => {
      tracking = false;
      // 鼠标拖选单词不能写入判定；只跟踪主触摸或笔尖手势。
      if (!["touch", "pen"].includes(e.pointerType) || e.isPrimary === false
          || (e.button != null && e.button !== 0)
          || e.target.closest("button, input, select, textarea, a") || hasSelection()) return;
      tracking = true;
      pointerId = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    card.addEventListener("pointerup", (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      tracking = false;
      if (hasSelection()) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (phase !== "recall" || cur == null) return;
      if (dx > 0) judge(true);
      else judge(false);
    });
    card.addEventListener("pointercancel", () => { tracking = false; });
  }

  /* ================= 全局键盘 ================= */
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.isComposing || e.defaultPrevented) return;
    if (rebinding) {
      e.preventDefault();
      captureKey(e);
      return;
    }
    const pop = $("#exPop");
    if (pop && pop.classList && pop.classList.contains("on") && e.key === "Escape") {
      e.preventDefault();
      hideExPop(true);
      return;
    }
    const tag = e.target.tagName;
    if (activeSheet) {
      if (e.key === "Escape" || (activeSheet.id === "helpSheet" && e.key === "?")) {
        e.preventDefault();
        closeSheet();
      } else if (e.key === "Tab") {
        const selector = 'button, input, select, textarea, summary, a[href], [tabindex="0"]';
        const nodes = Array.from(activeSheet.querySelectorAll?.(selector) || [])
          .concat(pop && !pop.hidden ? Array.from(pop.querySelectorAll?.(selector) || []) : [])
          .filter(x => !x.disabled && !x.hidden
            && !x.closest?.("[hidden], [inert]")
            && (!x.getClientRects || x.getClientRects().length > 0));
        if (nodes.length) {
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
        }
      }
      return;
    }
    // 查词期间只操作浮层，避免熟练、改判、发音或撤销误作用于背后的学习卡。
    if (pop && !pop.hidden) {
      if (e.key === "Tab") {
        const nodes = Array.from(pop.querySelectorAll?.("button, [tabindex='0']") || [])
          .filter(x => !x.disabled && !x.hidden);
        nodes.unshift(pop);
        if (nodes.length) {
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) {
            e.preventDefault(); last.focus?.();
          } else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) {
            e.preventDefault(); first.focus?.();
          }
        }
      }
      return;
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    const singleChar = S.settings.singleCharKeys !== false;
    if (singleChar && e.key === "?" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openHelp();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      if ($("#v-study").classList.contains("on")) {
        e.preventDefault();
        undo();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (!$("#v-study").classList.contains("on")) return;
    if ((tag === "BUTTON" || tag === "SUMMARY") && (e.key === "Enter" || e.key === " ")) return;
    if (cur == null) return;

    const K = S.settings.keys;
    if (singleChar && keyMatch(e, K.know)) {
      e.preventDefault();
      judge(true);
    } else if (singleChar && keyMatch(e, K.dont)) {
      e.preventDefault();
      judge(false);
    } else if (e.key === "Enter" || (singleChar && keyMatch(e, K.next))) {
      e.preventDefault();
      tryNext(true);   // 门控：recall 阶段不翻页
    } else if (singleChar && keyMatch(e, K.speak)) {
      e.preventDefault();
      speak(W[cur].w);
    } else if (singleChar && keyMatch(e, K.star)) {
      e.preventDefault();
      toggleStar(cur);
      renderCard();
      toast(isStar(cur) ? "已收藏" : "已取消收藏");
    } else if (singleChar && keyMatch(e, K.proficient)) {
      e.preventDefault();
      setProficient(cur, true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      judge(false);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      judge(true);
    }
  });

  /* ================= 启动 ================= */
  load();
  applyTheme();
  bindSet();
  bindExLookup($("#card"));
  bindExLookup($("#wordDetail"));
  // 鼠标点击按钮后主动移走焦点：按钮保留焦点时空格/回车会先被浏览器原生激活按钮，
  // 导致点过导航/主题/预设/切书等按钮后无法用空格翻页（真实浏览器回归）。
  // 只处理指针点击（e.detail>0）；键盘触发的 click 保留焦点，兼容键盘操作。浮层内按钮由 closeSheet 管理。
  document.addEventListener("click", (e) => {
    if (!e.detail) return;
    const t = e.target;
    const btn = t && t.closest ? t.closest("button") : null;
    if (btn && !(btn.closest && btn.closest(".sheet"))) btn.blur?.();
  }, true);
  document.addEventListener("click", (e) => {
    const pop = $("#exPop");
    if (!pop || pop.hidden) return;
    const t = e.target;
    if (t && (t.closest && (t.closest(".ex-word") || t.closest("#exPop")))) return;
    hideExPop();
  });
  // 查词浮层固定在视口中；其锚点所在容器一旦滚动，就关闭旧位置的浮层。
  document.addEventListener("scroll", (e) => {
    const pop = $("#exPop");
    if (!pop || pop.hidden || pop === e.target || pop.contains?.(e.target)) return;
    hideExPop();
  }, true);
  window.addEventListener?.("resize", hideExPop);
  window.addEventListener?.("resize", fitVisibleWords);
  window.addEventListener?.("resize", refreshFreqPresentation);
  // 主窗口侧栏变化也会改变可用宽度；字体就绪后重新测量，离线系统字体同样适用。
  if (typeof window.ResizeObserver === "function") {
    let lastWidth = 0;
    const wordResize = new window.ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width !== lastWidth) { lastWidth = width; fitVisibleWords(); refreshFreqPresentation(); }
    });
    wordResize.observe($("#main"));
  }
  document.fonts?.ready?.then(fitVisibleWords);
  document.fonts?.addEventListener?.("loadingdone", fitVisibleWords);
  window.visualViewport?.addEventListener("resize", hideExPop);
  window.visualViewport?.addEventListener("scroll", hideExPop);

  $("#q").addEventListener("input", applyFilter);
  $("#fst").addEventListener("change", () => {
    if ($("#fst").value === "proficient") $("#fsc").value = "all";
    applyFilter();
  });
  $("#fsc").addEventListener("change", applyFilter);
  const dueListBtn = $("#btnDueList");
  if (dueListBtn) dueListBtn.onclick = () => {
    show("list");
    $("#fst").value = "due";
    $("#fsc").value = "scope";
    $("#q").value = "";
    applyFilter();
    const first = $("#listInner")?.querySelector?.('[data-open-word]');
    (first || $("#listScroll"))?.focus?.({preventScroll: true});
  };
  const statsStudyBtn = $("#btnStatsStudy");
  if (statsStudyBtn) statsStudyBtn.onclick = () => {
    show("study");
    $("#card").focus?.({preventScroll: true});
  };

  $("#listScroll").addEventListener("scroll", () => { saveListUi(); renderRows(); });
  $("#listInner").addEventListener("keydown", navigateList);
  $("#listInner").addEventListener("focusin", (e) => {
    const t = e.target;
    if (t?.dataset?.openWord !== undefined) {
      listActiveWord = +t.dataset.openWord; listActiveAction = "open-word";
    } else if (t?.dataset?.proficient !== undefined) {
      listActiveWord = +t.dataset.proficient; listActiveAction = "proficient";
    } else return;
    announceListRow(); saveListUi();
  });
  bindStatsChart("#days", "[data-day-label]", "#daysHint");
  bindStatsChart("#forecast", "[data-fc-label]", "#forecastHint");
  bindStatsChart("#stages", "[data-stage-label]", "#stagesHint");
  bindStatsChart("#heatmap", ".hm-cell", "#heatmapTip", true);
  window.addEventListener?.("resize", syncStatsChartHints);
  const clearFilters = $("#clearListFilters");
  if (clearFilters) clearFilters.onclick = () => {
    $("#q").value = "";
    $("#fst").value = "all";
    $("#fsc").value = "all";
    applyFilter();
    $("#q").focus?.({preventScroll: true});
  };
  $("#listInner").addEventListener("click", (e) => {
    const action = e.target.closest("[data-proficient]");
    if (action) {
      const i = +action.dataset.proficient;
      listActiveWord = i; listActiveAction = "proficient";
      setProficient(i, !isProficient(i));
      return;
    }
    const r = e.target.closest(".row");
    if (!r) return;
    listActiveWord = +r.dataset.i; listActiveAction = "open-word";
    announceListRow();
    openWord(+r.dataset.i);
  });

  $$("#presets button").forEach(b => {
    b.onclick = () => {
      $("#fmin").value = b.dataset.fmin;
      $("#fmax").value = b.dataset.fmax || "";
      if (b.dataset.pmin !== undefined) $("#pmin").value = b.dataset.pmin;
      onSet(); bindSet(); applyFilter(); renderStats();
      toast("已设为 " + b.textContent);
    };
  });
  function applyComboFilters(c){
    const d = DEF.settings;
    if (c === "core") {
      S.settings.fmin = 5; S.settings.fmax = 0; S.settings.pmin = 3;
      S.settings.kyOnly = false; S.settings.pos = [];
    } else if (c === "cold") {
      S.settings.fmin = 1; S.settings.fmax = 2; S.settings.pmin = 0;
      S.settings.kyOnly = false; S.settings.pos = [];
    } else if (c === "adj") {
      S.settings.fmin = 1; S.settings.fmax = 0; S.settings.pmin = 0;
      S.settings.kyOnly = false; S.settings.pos = ["a"];
    } else {
      S.settings.fmin = d.fmin; S.settings.fmax = d.fmax; S.settings.pmin = d.pmin;
      S.settings.kyOnly = d.kyOnly; S.settings.pos = [];
    }
  }
  $$("[data-combo]").forEach(b => {
    b.onclick = () => {
      const moveFocus = b.closest?.("#scopeEmpty") && document.activeElement === b;
      applyComboFilters(b.dataset.combo);
      save(); bindSet(); applyFilter(); renderStats(); startSession();
      if (moveFocus) $("#btnStartFromSettings")?.focus?.({preventScroll: true});
      toast("已应用：" + b.textContent);
    };
  });
  $$("#themeSeg button").forEach(b => {
    b.onclick = () => {
      S.settings.theme = b.dataset.theme;
      save(); applyTheme();
      toast("主题：" + b.textContent);
      markSettingsSaved();
    };
  });
  function applySettingsControl(){
    onSet(); bindSet(); applyFilter(); renderStats(); renderCard();
  }
  $$("[data-step-target]").forEach(b => {
    b.onclick = () => {
      const input = $("#" + b.dataset.stepTarget);
      if (!input) return;
      const fallback = b.dataset.stepTarget === "dailyNew" ? 30 : 0;
      const value = input.value === "" ? fallback : Number(input.value);
      input.value = Math.max(+input.min, Math.min(+input.max, value + +b.dataset.stepDir * (+input.step || 1)));
      applySettingsControl();
    };
  });
  const startFromSettings = $("#btnStartFromSettings");
  if (startFromSettings) startFromSettings.onclick = () => show("study");
  $$(".settings-nav a").forEach(a => {
    a.onclick = (e) => {
      const target = $(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView?.({block: "start", behavior: "auto"});
      target.tabIndex = -1;
      target.focus?.({preventScroll: true});
      syncSettingsNav();
    };
  });
  let settingsNavFrame = false;
  $("#main").addEventListener("scroll", () => {
    if (settingsNavFrame || !$("#v-set")?.classList.contains("on")) return;
    settingsNavFrame = true;
    const schedule = window.requestAnimationFrame || ((fn) => fn());
    schedule(() => { settingsNavFrame = false; syncSettingsNav(); });
  }, {passive: true});
  ["dailyNew","order","fmin","fmax","pmin","kyOnly","showPh","showEx","showFm","autoSpk","singleCharKeys"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", applySettingsControl);
  });
  [["fminRange", "min"], ["fmaxRange", "max"]].forEach(([id, which]) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", () => onFreqRangeInput(which));
    el.addEventListener("change", () => { if (onFreqRangeInput(which) !== false) commitFreqRange(); });
    el.addEventListener("keydown", e => onFreqRangeKey(e, which));
    el.addEventListener("focus", () => setFreqActivity(which));
    el.addEventListener("blur", () => commitFreqRange());
    el.addEventListener("pointerdown", e => startFreqRangeDrag(e, which));
  });
  const freqTrackEl = $("#freqTrack");
  if (freqTrackEl) freqTrackEl.addEventListener("pointerdown", onFreqTrackClick);

  $("#exp").onclick = () => exportBackupFile();
  const exportBookTxtBtn = $("#btnExportBookTxt");
  if (exportBookTxtBtn) exportBookTxtBtn.onclick = () => exportWordBookTxt("scope");
  const exportListTxtBtn = $("#btnExportListTxt");
  if (exportListTxtBtn) exportListTxtBtn.onclick = () => exportWordBookTxt("filter");
  const splitBookTxtBtn = $("#btnSplitBookTxt");
  if (splitBookTxtBtn) splitBookTxtBtn.onclick = () => openTxtSplit("scope");
  const splitListTxtBtn = $("#btnSplitListTxt");
  if (splitListTxtBtn) splitListTxtBtn.onclick = () => openTxtSplit("filter");
  $("#txtSplitAmount")?.addEventListener("input", renderTxtSplit);
  $("#txtSplitMode")?.addEventListener("change", () => {
    if (!txtSplitContext) return;
    $("#txtSplitAmount").value = $("#txtSplitMode").value === "parts" ? String(Math.min(2, txtSplitContext.words.length)) : "4000";
    renderTxtSplit();
  });
  const splitZipBtn = $("#txtSplitZip");
  if (splitZipBtn) splitZipBtn.onclick = downloadTxtSplitZip;
  $("#txtSplitFiles")?.addEventListener("click", e => {
    const btn = e.target.closest?.("[data-txt-part]");
    if (btn) downloadTxtPart(Number(btn.dataset.txtPart));
  });
  const splitPrevBtn = $("#txtSplitPrev"), splitNextBtn = $("#txtSplitNext");
  if (splitPrevBtn) splitPrevBtn.onclick = () => { txtSplitPage--; renderTxtSplitFiles(); };
  if (splitNextBtn) splitNextBtn.onclick = () => { txtSplitPage++; renderTxtSplitFiles(); };
  $$("#txtSplitSheet [data-txt-split-close]").forEach(el => { el.onclick = closeSheet; });
  ["#btnPrintBook", "#btnPrintBookList"].forEach(sel => {
    const el = $(sel);
    if (el) el.onclick = openPrintBook;
  });
  const printSrcEl = $("#printSource");
  if (printSrcEl) printSrcEl.addEventListener("change", () => renderPrintBook());
  const copyMdEl = $("#btnCopyMd");
  if (copyMdEl) copyMdEl.onclick = () => copyPrintMarkdown();
  const doPrintEl = $("#btnDoPrint");
  if (doPrintEl) doPrintEl.onclick = () => { renderPrintBook(); window.print?.(); };
  $$("#printSheet [data-print-close]").forEach(el => { el.onclick = closeSheet; });
  $("#imp").onclick = () => $("#file").click();
  /** 兼容 v1（平铺，按考研书）与 v2/v3（books 分书全量备份）；返回当前书 state */
  function importState(o){
    if (isRecord(o) && (o.version === 2 || o.version === 3)) return importBooksBackup(o);
    return importLegacyV1(o);
  }
  $("#file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      showAlert("备份文件过大", "请选择本应用导出的 JSON 进度文件（不超过 10 MB）。现有记录未改动。", {kind: "import"});
      e.target.value = "";
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      let o;
      try { o = JSON.parse(r.result); }
      catch (err) {
        showAlert("文件格式不正确", "无法解析为 JSON。现有进度未改变，请确认选择的是本应用导出的备份。", {kind: "import"});
        return;
      }
      openImportConfirm(o);
    };
    r.onerror = () => showAlert("文件读取失败", "请重新选择备份文件。现有进度未改变。", {kind: "import"});
    r.readAsText(f);
    e.target.value = "";
  };
  $$("#importSheet [data-import-close]").forEach(el => { el.onclick = () => { pendingImport = null; closeSheet(); }; });
  const importConfirmBtn = $("#importConfirm");
  if (importConfirmBtn) importConfirmBtn.onclick = () => {
    if (!pendingImport) return;
    const data = pendingImport.data;
    pendingImport = null;
    closeSheet();
    try {
      importState(data);
      clearAlert("import");
    } catch (err) {
      showAlert("导入失败", (err && err.message ? err.message : "备份无法导入") + "。现有记录已保留。", {kind: "import", export: true});
    }
  };
  $("#rst").onclick = () => {
    const name = currentBook().name;
    if (confirm("确定重置「" + name + "」的学习记录、熟练标记、收藏、抽样统计与设置？此操作只影响当前词书（不是全部词书），且不可撤销。请先导出备份。")) {
      S = freshState(currentBook());
      resetSurvey();
      blockedBooks.delete(currentBookId);
      const saved = save(true, true);
      bindSet(); applyFilter(); renderStats(); startSession(); updateBar(); renderBookList();
      toast(saved ? "已重置「" + name + "」的当前词书记录" : "已重置，但未能保存；请检查浏览器存储");
    }
  };
  $("#resetProficient").onclick = () => {
    if (!proficientCount()) { toast("还没有熟练标记"); return; }
    if (confirm("确定清空「" + currentBook().name + "」的全部熟练标记？这些单词将按原学习进度恢复背诵和复习，其他学习记录保留。")) resetProficient();
  };

  $$(".nav button").forEach(b => { b.onclick = () => show(b.dataset.v); });
  $$(".keybtn").forEach(b => {
    b.onclick = () => { rebinding = b.dataset.k; renderKeys(); };
  });
  $("#keyReset").onclick = () => {
    S.settings.keys = Object.assign({}, DEFKEYS);
    rebinding = null;
    save(); renderKeys(); renderCard();
    toast("已恢复默认按键");
  };

  $("#btnHelp").onclick = openHelp;
  $$("#helpSheet [data-close]").forEach(el => {
    el.onclick = closeHelp;
  });
  $$("#wordSheet [data-word-close]").forEach(el => { el.onclick = closeSheet; });

  // 词书入口与选择浮层
  const bookBtnEl = $("#btnBooks");
  if (bookBtnEl) bookBtnEl.onclick = openBookSheet;
  $$("#bookSheet [data-close]").forEach(el => { el.onclick = closeSheet; });
  const bookCloseEl = $("#bookClose");
  if (bookCloseEl) bookCloseEl.onclick = closeSheet;
  const bookListEl = $("#bookList");
  if (bookListEl) {
    bookListEl.addEventListener("click", (e) => {
      const t = e.target;
      const item = t && t.closest ? t.closest("[data-book]") : null;
      if (!item) return;
      if (item.getAttribute("data-unavailable")) { toast("该词书数据未载入，暂时无法切换"); return; }
      const id = item.getAttribute("data-book");
      if (id && id !== currentBookId) switchBook(id);
      else if (activeSheet) closeSheet();
    });
  }

  if (!storageOK || blockedBooks.has(currentBookId)) {
    showAlert("已有记录无法读取", "受影响词书：" + currentBook().name
      + "。原因：" + (loadError || "记录格式无法读取")
      + "。已暂停写入以避免覆盖原文件；可导入备份恢复、使用救援导出保留原文，或在统计页显式重置当前词书。",
      {kind: "save", recover: false, export: true, rescue: true});
  }
  try {
    if (localStorage.getItem(JOURNAL_KEY)) {
      showAlert("发现未完成的导入", "上次导入可能在中途中断。可恢复到导入前记录；恢复前不要继续导入或重置词书。",
        {kind: "import", recover: true});
    }
  } catch (e) { /* 存储不可用时已有保存失败提示 */ }

  applyBrand();
  bindSwipe();
  startSession();
  renderStats();
  updateBar();

  /**
   * 统一恢复入口：跨天、从后台回来、统计页停留跨日都走这里。
   * 只刷新额度/到期/图表，不重建当前卡、判定、特训与撤销历史。
   */
  let lastDay = todayStr();
  function refreshForResume(){
    const today = todayStr();
    const dayChanged = today !== lastDay;
    if (dayChanged) lastDay = today;
    if ($("#v-study").classList.contains("on") && (dayChanged || cur == null)) renderCard();
    renderReviewPlan();
    if ($("#v-stats").classList.contains("on")) renderStats();
    if ($("#v-list").classList.contains("on") && $("#fst").value === "due") applyFilter(false);
    updateBar();
  }

  // 到期词轮询：未开始新组时补显示到期词；跨天只刷新现场数据
  setInterval(() => {
    if (todayStr() !== lastDay) { refreshForResume(); return; }
    if (cur == null && countDue() > 0) renderCard();
    renderReviewPlan();
    if ($("#v-list").classList.contains("on") && $("#fst").value === "due") applyFilter(false);
  }, 30000);

  // 学习时长
  setInterval(() => {
    if (document.visibilityState !== "hidden"
        && $("#v-study").classList.contains("on") && cur != null) {
      S.timeSec = (S.timeSec || 0) + 15;
      save();
    }
  }, 15000);

  // 后台标签跨天兜底：保留正在学习的卡片与撤销栈
  setInterval(() => {
    if (todayStr() !== lastDay) refreshForResume();
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") refreshForResume();
  });
  window.addEventListener?.("pageshow", refreshForResume);
  window.addEventListener?.("focus", refreshForResume);

  window.addEventListener?.("storage", (e) => {
    if (e.key === ACTIVE_KEY) { followActiveBook(); return; }
    for (const id of Object.keys(BOOKS)) {
      if (e.key === BOOKS[id].SURVEY_KEY) {
        if (id === currentBookId) { loadSurvey(); renderSurvey(); }
        return;
      }
    }
    // 找到变化键所属的词书
    let owner = null;
    for (const id of Object.keys(BOOKS)) {
      if (e.key === BOOKS[id].KEY || e.key === BOOKS[id].PROF_KEY) { owner = id; break; }
    }
    // localStorage.clear() 的事件 key 为 null，也必须清除本页旧状态，避免再次写回复活。
    if (e.key === null) { owner = currentBookId; loadSurvey(); }
    if (!owner) return;
    if (owner !== currentBookId) {
      // 别的书被别人更新：本标签只刷新词书列表统计，不切换
      if (activeSheet && activeSheet.id === "bookSheet") renderBookList();
      return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      const candidate = raw !== null ? normalizeState(JSON.parse(raw), currentBookId) : freshState(currentBook());
      const proficientRaw = localStorage.getItem(PROF_KEY);
      if (proficientRaw !== null) candidate.proficient = normalizeProficientByBook(JSON.parse(proficientRaw), currentBook());
      const signature = s => JSON.stringify([s.settings, s.progress, s.days, s.stars, s.proficient]);
      if (signature(candidate) === signature(S) && !Q.slice(qi).some(i => !!candidate.proficient[W[i].w])) {
        S.timeSec = Math.max(S.timeSec, candidate.timeSec);
        lastMainRaw = raw;
        lastSavedSignature = savedStateSignature(S);
        return;
      }
      S = candidate;
      lastMainRaw = raw;
      lastSavedSignature = savedStateSignature(S);
      storageOK = true;
      blockedBooks.delete(currentBookId);
      if (activeSheet) closeSheet();
      bindSet(); applyFilter(); renderStats(); startSession(); applyBrand(); renderBookList();
      toast("另一窗口的进度已同步");
    } catch (err) { toast("另一窗口的记录无法读取，当前进度已保留"); }
  });

  /* 调试 / 测试钩子（保留原有语义，默认作用于当前词书） */
  window.__vocab = {
    get phase() { return phase; },
    get verdict() { return verdict; },
    get cur() { return cur; },
    get qi() { return qi; },
    get Q() { return Q; },
    get answered() { return answered; },
    get drillMode() { return drillMode; },
    judge, tryNext, undo, startSession, nextCard,
    buildExport, buildRescueExport, prepareImportPlan, recoverImportJournal,
    hasMainProgress, isMainLearned, pendingReinforce,
    getGroupTotal: () => groupTotal,
    getListActiveWord: () => listActiveWord,
    applyComboFilters,
    freqToPos, posToFreq, freqHistogram, renderFreqHistogram, syncFreqControls,
    inScope, inScopeCount, masteredCount, scopedMasteredCount, countDue, buildQueue,
    reviewPlan, wordReviewLabel, dueForecast, frequencyMastery,
    isProficient, setProficient, resetProficient, proficientCount,
    normalizeState, importState, applyFilter, show, openWord, closeSheet,
    wrongWordIndices, applyDrill, startDrill, exitDrill,
    printStatusLabel, printMetaText, printBookEntries, printBookMarkdown,
    wordBookTxt, exportWordBookTxt,
    splitTxtWords, openTxtSplit, renderTxtSplit, downloadTxtPart, downloadTxtSplitZip,
    getTxtSplitFiles: () => txtSplitContext ? txtSplitContext.files : [],
    renderPrintBook, openPrintBook, copyPrintMarkdown,
    heatLevel, heatmapData,
    wilsonInterval, surveyStats, getSurveyStats: () => surveyStats(),
    resetSurvey, getSurvey: () => JSON.parse(JSON.stringify(SURVEY)),
    exTokens, exHtml, meaningHtml, lookupExWord, showExPop, hideExPop,
    getStorageOK: () => storageOK && !blockedBooks.has(currentBookId),
    getStorageAlert: () => $("#appAlert")?.hidden === false ? ($("#appAlertBody")?.textContent || "") : "",
    getS: () => S, getW: () => W,
    // —— 多词书钩子（契约 4.5） ——
    getBook: () => currentBookId,
    getBooks: () => BOOK_DEFS.map(def => ({
      id: def.id,
      name: def.name,
      words: BOOKS[def.id].words.length,
      paperCount: BOOKS[def.id].paperCount,
      available: BOOKS[def.id].available
    })),
    switchBook: (id) => switchBook(id),
    getBookState: (id) => getBookState(id),
    getStorageKeys: () => {
      const books = {};
      for (const def of BOOK_DEFS) books[def.id] = { state: BOOKS[def.id].KEY, prof: BOOKS[def.id].PROF_KEY, survey: BOOKS[def.id].SURVEY_KEY };
      return { active: ACTIVE_KEY, books: books };
    },
    setPhase(p) { phase = p; },
    setCur(i) { cur = i; renderCard(); },
    setVerdict(v) { verdict = v; phase = v === null ? "recall" : "revealed"; }
  };
})();
