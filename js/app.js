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
      paperUnit: "套考研真题", tagLabel: "考研大纲", kyOnlyLabel: "只保留考研大纲词", defaultPmin: 2 },
    { id: "cet4", name: "英语四级", mark: "四", dataKey: "WORDS_CET4",
      KEY: "cet4_vocab_v1", PROF_KEY: "cet4_vocab_proficient_v1",
      paperUnit: "套四级真题", tagLabel: "四级大纲", kyOnlyLabel: "只保留四级大纲词", defaultPmin: 2 },
    { id: "cet6", name: "英语六级", mark: "六", dataKey: "WORDS_CET6",
      KEY: "cet6_vocab_v1", PROF_KEY: "cet6_vocab_proficient_v1",
      paperUnit: "套六级真题", tagLabel: "六级大纲", kyOnlyLabel: "只保留六级大纲词", defaultPmin: 2 },
    { id: "combined", name: "综合词书", mark: "综", dataKey: "WORDS_COMBINED",
      KEY: "combined_vocab_v1", PROF_KEY: "combined_vocab_proficient_v1",
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
      const entry = {from: m.from, to: m.to, removed: m.removed.slice()};
      if (Array.isArray(m.removedWords) && m.removedWords.length === m.removed.length
          && m.removedWords.every(w => typeof w === "string" && /^[a-z]+$/.test(w))) {
        entry.removedWords = m.removedWords.slice();
      }
      byFrom.set(m.from, entry);
    }
    const chain = [];
    let ver = version, len = newLength;
    while (ver > 1) {
      const m = byFrom.get(ver - 1);
      if (!m) return fallback;                        // 迁移链不完整 → 整组忽略
      const oldLen = len + m.removed.length;
      if (m.removed.length >= oldLen) return fallback;
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
  // 某本书的主记录损坏/存储被禁用时暂停该书写入，避免把可恢复的备份覆盖成空记录。
  // 只影响损坏的那一本；切换到另一本仍可正常读写。
  const blockedBooks = new Set();
  let lastMainRaw = null;

  // spaCy 分词产生的残缺词形 → 正确词形（与词库修正表保持一致）。
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
      .filter(m => m.from >= migration.from).reduce((n, m) => n + m.removed.length, 0);
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
    if (dv >= target) return o;
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
    if (raw === null) return;
    const parsed = JSON.parse(raw);
    const next = normalizeProficientByBook(parsed, currentBook());
    S.proficient = next;
    // 旧拼写键已迁移 / 删词清理时回写一次，让 localStorage 与词库文本对齐。
    if (Object.keys(parsed).some(k => !(k in next))) {
      try { localStorage.setItem(PROF_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    }
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
    for (const k of ["kyOnly", "showPh", "showEx", "showFm", "autoSpk"]) {
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
    if (!raw) return {state: freshState(book), raw: null};
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
    } catch (e) {
      storageOK = false;
      blockedBooks.add(book.id);
      // Do not overwrite an unreadable or damaged backup with empty records.
    }
    // Permanent exclusions can still be recovered if the main backup is damaged.
    try { syncProficientFromStorage(); }
    catch (e) { storageOK = false; blockedBooks.add(book.id); }
  }
  function save(proficiencyChanged = false, replaceAll = false){
    if (blockedBooks.has(currentBookId)) return false;   // 该书记录损坏/不可写时保护原文件
    try {
      if (proficiencyChanged) localStorage.setItem(PROF_KEY, JSON.stringify(S.proficient));
      else syncProficientFromStorage();
      const latest = localStorage.getItem(KEY);
      if (!replaceAll && latest !== lastMainRaw) {
        // A delayed storage event must not let an older tab overwrite newer learning records.
        S = latest ? normalizeState(JSON.parse(latest), currentBookId) : freshState(currentBook());
        syncProficientFromStorage();
        lastMainRaw = latest;
        bindSet(); applyFilter(); renderStats(); startSession();
        toast("另一窗口已更新记录，学习队列已同步");
        storageOK = true;
        blockedBooks.delete(currentBookId);
        return true;
      }
      const serialized = JSON.stringify(S);
      localStorage.setItem(KEY, serialized); lastMainRaw = serialized;
      storageOK = true; blockedBooks.delete(currentBookId); return true;
    }
    catch (e) { storageOK = false; toast("进度保存失败，请导出备份（存储空间不足或被禁用）"); return false; }
  }
  function migrateScope(oldSet, cur){
    if (oldSet.fmin !== undefined) return;
    if (oldSet.scope === "high") cur.fmin = 5;
    else if (oldSet.scope === "ky") cur.kyOnly = true;
    else if (oldSet.scope === "all") { cur.fmin = 1; cur.fmax = 0; }
  }

  /* ================= 多词书：切换 / 统计 / 备份 ================= */
  /** 切换词书时携带的纯界面偏好（学习相关设置各书独立） */
  const CARRY_SETTINGS = ["theme", "keys", "showPh", "showEx", "showFm", "autoSpk"];
  function cloneSettingsValue(v){
    return (v && typeof v === "object") ? JSON.parse(JSON.stringify(v)) : v;
  }
  /** 某书学习概况（用于词书列表展示）：已学 = 有进度记录的词数，已掌握 = 走完全部档位 */
  function bookStats(id){
    let prog = null;
    if (id === currentBookId) prog = S.progress;
    else {
      try {
        prog = readBookState(BOOKS[id]).state.progress;   // 迁移后再统计，删词不计入
      } catch (e) { return {ok: false, learned: 0, mastered: 0}; }
    }
    let learned = 0, mastered = 0;
    for (const k of Object.keys(prog || {})) {
      const p = prog[k];
      if (!Array.isArray(p)) continue;
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
    if (opts.persist !== false) save();   // 切换前先保存当前书
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
    } catch (e) { targetBlocked = true; }
    if (opts.carry !== false) {
      for (const k of CARRY_SETTINGS) {
        if (S.settings[k] !== undefined) target.settings[k] = cloneSettingsValue(S.settings[k]);
      }
    }
    currentBookId = id;
    KEY = book.KEY;
    PROF_KEY = book.PROF_KEY;
    W = book.words;
    wordIndex = book.wordIndex;
    S = target;
    lastMainRaw = targetRaw;
    if (targetBlocked) blockedBooks.add(id); else blockedBooks.delete(id);
    if (opts.persist !== false) {
      try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* ignore */ }
      save();   // 落盘携带的界面偏好（目标记录损坏时自动跳过）
    }
    rebinding = null;
    detailWord = null;
    if (activeSheet) closeSheet();
    bindSet();
    applyFilter();
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
  /** 导出 v3：包含全部可用词书 + activeBook；每本书 state 带 dv（数据版本） */
  function buildExport(){
    const books = {};
    for (const def of BOOK_DEFS) {
      if (!BOOKS[def.id].available) continue;
      let st = def.id === currentBookId ? S : getBookState(def.id);
      if (!st) st = freshState(BOOKS[def.id]);
      if (def.id !== currentBookId) {
        try { st.proficient = readBookProficient(BOOKS[def.id], st.proficient); } catch (e) {}
      }
      books[def.id] = JSON.parse(JSON.stringify({
        dv: st.dv || BOOKS[def.id].dataVersion || 1,
        settings: st.settings, progress: st.progress, days: st.days,
        stars: st.stars || {}, proficient: st.proficient || {}, timeSec: st.timeSec || 0
      }));
    }
    return {
      app: "kaoyan-vocab", version: 3,
      exportedAt: new Date().toISOString(),
      activeBook: currentBookId,
      books: books
    };
  }
  /** 导入旧版（v1 平铺）备份：固定按考研书解析，替换考研学习记录、保留考研已有熟练标记 */
  function importLegacyV1(o){
    const imported = normalizeState(o, "kaoyan");
    if (currentBookId === "kaoyan") {
      // Importing an older backup cannot silently undo permanent manual exclusions.
      try { syncProficientFromStorage(); } catch (e) {}
      imported.proficient = Object.assign({}, S.proficient, imported.proficient);
      S = imported;
      blockedBooks.delete(currentBookId);
      const saved = save(true, true);
      bindSet(); applyFilter(); renderStats(); startSession();
      if (activeSheet) closeSheet();
      renderBookList();
      toast(saved ? "进度已导入（原有熟练标记已保留）" : "进度已导入，但未能保存；请导出备份");
    } else {
      // 当前在四/六级：只恢复考研书，不强制切书
      const existing = getBookState("kaoyan") || freshState(BOOKS.kaoyan);
      try { existing.proficient = readBookProficient(BOOKS.kaoyan, existing.proficient); } catch (e) {}
      imported.proficient = Object.assign({}, existing.proficient, imported.proficient);
      const saved = writeBookState("kaoyan", imported);
      if (activeSheet) closeSheet();
      renderBookList();
      toast(saved
        ? "考研记录已导入（当前仍在「" + currentBook().name + "」）"
        : "考研记录已导入，但未能保存；请检查浏览器存储");
    }
    return S;
  }
  /**
   * 导入 v2/v3 全量备份：先整份校验，任一非法整份拒绝；逐本合入（保留已有熟练标记），
   * activeBook 合法则切换。v2（无 dv）按 v1 逐书迁移后再校验；v3 记录带 dv。
   */
  function importBooksBackup(o){
    if (o.version !== 2 && o.version !== 3) throw new Error("不支持的备份版本");
    const entries = [];
    for (const [id, raw] of Object.entries(o.books || {})) {
      const book = bookOf(id);
      if (!book || !book.available) continue;   // 本版本没有该词书数据 → 跳过，不视为损坏
      entries.push({id: id, state: normalizeState(raw, id)});   // 任一非法直接抛错，零改动
    }
    const failed = [];
    for (const entry of entries) {
      const id = entry.id, state = entry.state;
      if (id === currentBookId) {
        try { syncProficientFromStorage(); } catch (e) {}
        state.proficient = Object.assign({}, S.proficient, state.proficient);
        S = state;
        blockedBooks.delete(id);
        if (!save(true, true)) failed.push(id);
      } else {
        const existing = getBookState(id) || freshState(BOOKS[id]);
        try { existing.proficient = readBookProficient(BOOKS[id], existing.proficient); } catch (e) {}
        state.proficient = Object.assign({}, existing.proficient, state.proficient);
        if (!writeBookState(id, state)) failed.push(id);
      }
    }
    const target = (typeof o.activeBook === "string"
      && bookOf(o.activeBook) && BOOKS[o.activeBook].available) ? o.activeBook : null;
    // 当前书尚未落盘时保留其内存记录，供用户立即导出；失败的目标书也不切入空白记录。
    if (target && target !== currentBookId && !failed.includes(currentBookId) && !failed.includes(target)) {
      switchBook(target, {carry: false, silent: true});
    }
    else {
      bindSet(); applyFilter(); renderStats(); startSession(); updateBar();
      if (activeSheet) closeSheet();
      renderBookList();
    }
    toast(failed.length
      ? "导入未全部保存（" + failed.map(id => BOOKS[id].name).join("、") + "）；请释放浏览器存储空间后重新导入备份"
      : "进度已导入（备份中词书的记录已恢复，原有熟练标记已保留）");
    return S;
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
  function isMastered(i){ const p = st(i); return p && p[0] >= MASTER; }
  function isProficient(i){ return !!(W[i] && Object.prototype.hasOwnProperty.call(S.proficient, W[i].w)); }
  function proficientCount(){ return Object.keys(S.proficient).length; }

  /** A manual, permanent exclusion, independent of the spaced-repetition stage. */
  function setProficient(i, value){
    if (storageOK) { try { syncProficientFromStorage(); } catch (e) {} }
    if (!W[i] || isProficient(i) === !!value) return;
    if (value) {
      S.proficient[W[i].w] = Date.now();
      if (cur === i && phase === "revealed") qi++;
      Q = Q.slice(0, qi).concat(Q.slice(qi).filter(k => k !== i));
      undoStack = [];
      // 主会话在特训期间暂停；其旧撤销记录同样不能再指向已熟练的词。
      if (mainSnap) mainSnap.undoStack = [];
      if (cur === i) nextCard();
    } else {
      delete S.proficient[W[i].w];
      // Keep its previous review schedule. The next session will include it when due.
      undoStack = [];
    }
    const saved = save(true);
    renderCard(); updateScopeCount(); applyFilter(false); renderStats(); updateBar();
    toast(saved ? (value ? "已标为熟练，今后不再进入背诵或复习" : "已取消熟练，下组将按原进度安排学习")
      : "熟练状态已更新，但未能保存；请立即导出进度备份");
  }
  function resetProficient(){
    S.proficient = {};
    const saved = save(true);
    startSession(); updateScopeCount(); applyFilter(); renderStats(); updateBar();
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
  /** 例句 → 可点词 HTML（英文词包 button，其余原样转义） */
  function exHtml(text){
    return exTokens(text).map(part => {
      if (/^[A-Za-z]/.test(part)) {
        return '<button type="button" class="ex-word" data-exw="' + esc(part) + '">' + esc(part) + "</button>";
      }
      return esc(part);
    }).join("");
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
  /** 例句点词浮层 */
  function showExPop(token, anchor){
    const pop = $("#exPop");
    if (!pop) return;
    const i = lookupExWord(token);
    const raw = String(token == null ? "" : token);
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
        '<div class="ex-pop-m">' + esc(x.m || "（暂无释义）") + "</div>" +
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
  }
  function hideExPop(){
    const pop = $("#exPop");
    if (!pop) return;
    pop.hidden = true;
    pop.classList.remove("on");
  }
  function bindExLookup(root){
    if (!root || root.__exLookupBound) return;
    root.__exLookupBound = true;
    root.addEventListener("click", (e) => {
      const t = e.target;
      const btn = t && t.closest ? t.closest(".ex-word") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      showExPop(btn.getAttribute("data-exw") || btn.textContent, btn);
    });
  }

  /* ================= 主题 ================= */
  function applyTheme(){
    const t = S.settings.theme || "auto";
    const sysDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const dark = (t === "dark") || (t === "auto" && sysDark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
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
  function inScope(i){
    const x = W[i], s = S.settings;
    if (x.f < (s.fmin || 1)) return false;
    if (s.fmax && x.f > s.fmax) return false;
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
      if (!p) fresh.push(i);
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
    return isProficient(i) ? "熟练" : isMastered(i) ? "已掌握" : (p ? "第" + p[0] + "档" : "未学");
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
        answered, rightN, verdict, snap, phase, stageBefore,
        undoStack: undoStack.slice(), autoSpoken,
        drillBaseline: {
          wrong: Object.fromEntries(Object.entries(S.progress).map(([i, p]) => [i, p[3]])),
          days: Object.fromEntries(Object.entries(S.days).map(([date, d]) => [date, Object.assign({}, d)]))
        }
      };
    }
    drillMode = true;
    Q = list; qi = 0; rounds = {}; answered = 0; rightN = 0;
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

  function snapshot(i, extraDate){
    const date = todayStr(), d = day();
    const dates = [date];
    if (extraDate && extraDate !== date) dates.push(extraDate);
    return {
      prog: st(i) ? st(i).slice() : null,
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
  }
  function snapshotWrong(s){
    return ((s.prog && s.prog[3]) || 0) + (s.drillWrongDelta || 0);
  }
  function applySRS(i, known, wrongBefore, hadBefore){
    const prev = st(i), had = hadBefore === undefined ? !!prev : hadBefore;
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
      stageBefore = snap.prog ? snap.prog[0] : 0;
      verdict = known;
      answered++;
      if (known) rightN++;
      apply(i, known);
      phase = "revealed";
    } else if (verdict !== known) {
      undoStack.push({ type: "rejudge", i, snap: snapshot(i, snap.date), originalSnap: snap, prevVerdict: verdict, answeredBefore: answered, rightBefore: rightN });
      restore(i, snap);
      apply(i, known, snapshotWrong(snap), !!snap.prog);
      rightN += known ? 1 : -1;
      verdict = known;
      phase = "revealed";
    } else {
      return;
    }
    save();
    renderCard();
    updateBar();
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

  function renderCard(){
    hideExPop();
    const c = $("#card"), a = $("#acts");
    const d = day();
    $("#s-new").textContent = d.n;
    $("#s-newmax").textContent = S.settings.dailyNew;
    $("#s-rev").textContent = Math.max(0, d.r - d.n);
    const progLabel = $("#s-proglabel");
    if (progLabel) progLabel.textContent = drillMode ? "错词特训" : "本次进度";
    $("#s-prog").textContent = answered + "/" + Q.length;
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
      const freshLeft = orderedPool().some(i => !st(i));
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
      return;
    }

    const x = W[cur], p = st(cur);
    const stage = p ? p[0] : 0, K = S.settings.keys;
    const proficientBtn = '<button type="button" class="btn proficient" id="markProficient" title="熟练词今后不再进入背诵或复习">熟练<kbd>' + esc(keyName(K.proficient)) + '</kbd></button>';
    const starBtn =
      '<button type="button" class="star' + (isStar(cur) ? " on" : "") + '" id="star" ' +
      'aria-label="' + (isStar(cur) ? "取消收藏" : "收藏") + '" aria-pressed="' + isStar(cur) + '" title="收藏（' + keyName(K.star) + '）">★</button>';

    let h = '<div class="tagrow">';
    h += '<span class="tag">词频 #' + x.r + "</span>";
    h += '<span class="tag">' + x.f + " 次 / " + x.c + " 套卷</span>";
    if (x.ky) h += '<span class="tag ky">' + esc(currentBook().tagLabel) + "</span>";
    h += wordBookTags(x.w);
    h += '<span class="tag">' + esc(stageLabel(stage)) + "</span>";
    h += "</div>";
    h += '<div class="word">' + esc(x.w) + "</div>";
    if (S.settings.showPh && x.ph) h += '<div class="ph">/' + esc(x.ph) + "/</div>";
    h += '<div class="posline">' + esc(POSN[x.p] || "") + "</div>";
    h += dotsHtml(stage);
    h += '<button type="button" class="spk" id="spk" aria-label="发音" title="发音（' + keyName(K.speak) + '）">♪</button>';

    if (verdict !== null) {
      h += '<div class="answer">';
      h += '<div class="mean">' +
        (x.m
          ? esc(x.m)
          : '<span style="color:var(--no)">（词典未收录，请参考下方真题例句）</span>') +
        "</div>";
      if (S.settings.showEx && x.ex) {
        h += '<div class="ex" data-ex-linked="1">' + exHtml(x.ex) +
          '<span class="src">— 真题例句 · ' + esc(x.src) + "</span></div>";
      }
      if (S.settings.showFm && x.fm) h += '<div class="fm">词形：' + esc(x.fm) + "</div>";
      h += "</div>";
    }

    c.innerHTML = starBtn + h;
    c.classList.add("enter");
    setTimeout(() => c.classList.remove("enter"), 240);
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
        $("#hint").textContent = "想好中文意思后按「会」或「不会」；标为「熟练」将永久移出词书";
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
  }

  function countDue(){
    const now = Date.now();
    let n = 0;
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (p && p[0] < MASTER && p[1] <= now) n++;
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
      if (!p || p[0] >= MASTER || isProficient(i) || !inScope(i)) continue;
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
    if (el) el.textContent = "已到期 " + plan.due + " 词 · 接下来 24 小时到期 " + plan.upcoming + " 词。"
      + (plan.next !== null ? "下次到期：" + formatReviewTime(plan.next) : "当前没有后续复习安排。");
    const btn = $("#btnDueList");
    if (btn) btn.disabled = !plan.due;
  }
  function wordReviewLabel(i){
    if (isProficient(i)) return "已标为熟练，不再安排复习";
    const p = st(i);
    if (!p) return "尚未学习，判定后安排复习";
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
      if (fs === "new" && (p || proficient)) continue;
      if (fs === "learn" && (proficient || !p || p[0] >= MASTER)) continue;
      if (fs === "due" && (proficient || !p || p[0] >= MASTER || p[1] > now)) continue;
      if (fs === "done" && (proficient || !isMastered(i))) continue;
      if (fs === "wrong" && (proficient || !p || p[3] === 0)) continue;
      if (fs === "star" && !isStar(i)) continue;
      if (q && x.w.indexOf(q) < 0 && x.m.toLowerCase().indexOf(q) < 0) continue;
      filt.push(i);
    }
    filt.sort((a, b) => (fs === "due" ? st(a)[1] - st(b)[1] : 0) || W[a].r - W[b].r);
    $("#listCount").textContent = "共 " + filt.length + " 词"
      + (storageOK ? "" : "　·　当前环境无法保存进度");
    const inner = $("#listInner");
    inner.style.height = (filt.length * RH) + "px";
    if (resetScroll) $("#listScroll").scrollTop = 0;
    else $("#listScroll").scrollTop = Math.min($("#listScroll").scrollTop, Math.max(0, filt.length * RH - $("#listScroll").clientHeight));
    renderRows();
    renderDrillEntry();
  }
  function renderRows(){
    const sc = $("#listScroll"), top = sc.scrollTop, h = sc.clientHeight;
    const s = Math.max(0, Math.floor(top / RH) - 6);
    const e = Math.min(filt.length, Math.ceil((top + h) / RH) + 6);
    let html = "";
    for (let k = s; k < e; k++) {
      const i = filt[k], x = W[i], p = st(i);
      const proficient = isProficient(i);
      const cls = proficient ? "badge-proficient" : isMastered(i) ? "st2" : (p ? "st1" : "st0");
      const txt = proficient ? "熟练" : isMastered(i) ? "已掌握" : (p ? "第" + p[0] + "档" : "未学");
      html += '<div class="row" data-i="' + i + '" style="top:' + (k * RH) + 'px">' +
        '<span class="c-rank">#' + x.r + "</span>" +
        '<button type="button" class="c-word row-word" data-open-word="' + i + '" aria-label="查看 ' + esc(x.w) + ' 详情">' + esc(x.w) + (isStar(i) ? " ★" : "") + "</button>" +
        '<span class="c-ph">' + esc(x.ph || "") + "</span>" +
        '<span class="c-mean">' + esc(x.m || "—") + "</span>" +
        '<span class="c-st ' + cls + '">' + txt + '</span>' +
        '<div class="c-actions row-actions"><button type="button" data-proficient="' + i + '" aria-label="' + (proficient ? "取消" : "标为") + '熟练：' + esc(x.w) + '">' + (proficient ? "取消熟练" : "标为熟练") + '</button></div></div>';
    }
    $("#listInner").innerHTML = html;
  }

  /* ================= 统计 ================= */
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
        (c.future ? " disabled" : ' tabindex="0"') +
        ' aria-label="' + esc(label) + '" title="' + esc(label) + '"></button>';
    }
    root.innerHTML =
      '<div class="hm-months" aria-hidden="true"><span class="hm-m gap"></span>' + months + "</div>" +
      '<div class="hm-body">' +
        '<div class="hm-days" aria-hidden="true">' +
          "<span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>" +
        "</div>" +
        '<div class="hm-grid" role="group" aria-label="近 12 周每日学习量，可用 Tab 聚焦各日格子">' + body + "</div>" +
      "</div>";
    const tip = $("#heatmapTip");
    if (tip) tip.textContent = "悬停或聚焦格子查看当日学习量";
    root.onclick = (e) => hmPeek(e);
    root.onmouseover = (e) => hmPeek(e);
    root.onfocusin = (e) => hmPeek(e);
    root.onmouseleave = () => { const t = $("#heatmapTip"); if (t) t.textContent = "悬停或聚焦格子查看当日学习量"; };
  }
  function hmPeek(e){
    const tip = $("#heatmapTip");
    if (!tip || !e || !e.target) return;
    const t = e.target;
    const label = (t.getAttribute && (t.getAttribute("title") || t.getAttribute("aria-label"))) || "";
    if (t.classList && t.classList.contains("hm-cell") && !t.classList.contains("future")) tip.textContent = label;
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

  function renderStats(){
    const tot = inScopeCount(), mas = scopedMasteredCount();
    let learning = 0, wrong = 0;
    const dist = new Array(MASTER + 1).fill(0);
    for (let i = 0; i < W.length; i++) {
      if (!inScope(i) || isProficient(i)) continue;
      const p = st(i);
      if (!p) { dist[0]++; continue; }
      dist[Math.min(p[0], MASTER)]++;
      if (p[0] < MASTER) learning++;
      if (p[3] > 0) wrong++;
    }
    const k = Object.keys(S.days).filter(k => S.days[k].r > 0).sort();
    const okAll = k.reduce((a, d) => a + S.days[d].ok, 0);
    const noAll = k.reduce((a, d) => a + S.days[d].no, 0);
    $("#kpis").innerHTML = [
      ["已掌握", mas],
      ["学习中", learning],
      ["未学", tot - mas - learning],
      ["熟练（全词库）", proficientCount()],
      ["错词", wrong],
      ["收藏", Object.keys(S.stars || {}).length],
      ["连续打卡", streak() + " 天"],
      ["学习天数", k.length],
      ["累计正确率", (okAll + noAll) ? Math.round(okAll / (okAll + noAll) * 100) + "%" : "—"],
      ["累计时长", fmtTime(S.timeSec)]
    ].map(([a, b]) =>
      '<div class="kpi"><b>' + b + "</b><span>" + a + "</span></div>"
    ).join("");

    $("#stagesHint").textContent = learning + mas === 0
      ? "还没有开始学习 —— 学完第一个词，这里就会出现各档位的分布"
      : "";
    const mx = Math.max(1, ...dist);
    $("#stages").innerHTML = dist.map((v, i) =>
      '<div style="height:' + (v / mx * 100) + '%" title="' + v + '"><i>' + (v || "") + "</i><u>" +
      (i === MASTER ? "掌握" : i) + "</u></div>"
    ).join("");

    const last = [];
    for (let d = 13; d >= 0; d--) {
      const t = new Date(); t.setDate(t.getDate() - d);
      const key = todayStr(t);
      const v = S.days[key] || {n: 0, r: 0};
      last.push([key, v.r, v.n]);
    }
    $("#daysHint").textContent = last.every(x => x[1] === 0)
      ? "最近 14 天还没有学习记录"
      : "";
    const dmx = Math.max(1, ...last.map(x => x[1]));
    $("#days").innerHTML = last.map(([k2, v, n]) =>
      '<div style="height:' + (v / dmx * 100) + '%" title="' + k2 + "：新词 " + n + "，复习 " + (v - n) + '"></div>'
    ).join("");
    renderHeatmap();
    renderDrillEntry();
    renderReviewPlan();
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
  function bindSet(){
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
    updateScopeCount();
    renderKeys();
    $("#curveInfo").innerHTML =
      "看到单词直接按「会」或「不会」，立刻出答案；记错了按另一个键改判，再按「下一个」翻页。<br>" +
      "<b>未判定时按空格 / Enter 不会翻页。</b><br>" +
      "「会」→ 进入下一档；「不会」→ 回到第 0 档，5 分钟后重来，并在本组队尾重考。<br>" +
      STAGES.map((x, i) => (i + 1) + ". " + x.t).join(" → ") + " → 已掌握<br>" +
      "走完全部 10 档约需 120 天。";
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
    save();
    updateScopeCount();
    if (before !== JSON.stringify([S.settings.dailyNew, S.settings.order, S.settings.fmin, S.settings.fmax, S.settings.pmin, S.settings.kyOnly])) startSession();
  }
  function updateScopeCount(){
    const n = inScopeCount();
    $("#scopeLabel").textContent = "当前词书 " + n + " 词";
    const sc = $("#scopeCount");
    sc.textContent = "当前范围 " + n + " 词 · 熟练已排除";
    sc.style.color = n ? "var(--accent)" : "var(--no)";
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
        updateScopeCount();
        applyFilter();
        renderStats();
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
      btn.textContent = book.mark;
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
    setText("#fRangeDesc", "只背在 " + book.paperCount + " " + book.paperUnit + "里出现次数落在这个区间的词；上限留空 = 不限");
    setText("#pminDesc", "本词书共 " + book.paperCount + " " + book.paperUnit +
      "。跨试卷覆盖可补充词频信息：只在一套卷里反复出现的词，可能与该套卷的主题有关");
    setText("#fscKy", book.tagLabel + "词");
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
    });
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
  }
  function closeSheet(){
    if (!activeSheet) return;
    hideExPop();
    const closedId = activeSheet.id;
    if (closedId === "txtSplitSheet") txtSplitContext = null;
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
      '<div class="mean">' + esc(x.m) + '</div>' +
      (x.ex ? '<div class="ex" data-ex-linked="1">' + exHtml(x.ex) + '<span class="src">— 真题例句 · ' + esc(x.src) + '</span></div>' : '') +
      (x.fm ? '<div class="fm">词形：' + esc(x.fm) + '</div>' : '');
    bindExLookup($("#wordDetail"));
    $("#wordActions").innerHTML =
      '<button type="button" class="btn proficient" id="detailProficient">' + (isProficient(i) ? "取消熟练" : "标为熟练") + '</button>' +
      '<button type="button" class="btn ghost" id="detailStar">' + (isStar(i) ? "取消收藏" : "收藏") + '</button>' +
      '<button type="button" class="btn ghost" id="detailSpeak">发音</button>';
    $("#detailProficient").onclick = () => { setProficient(i, !isProficient(i)); renderWordDetail(); $("#detailProficient").focus?.(); };
    $("#detailStar").onclick = () => { toggleStar(i); applyFilter(false); renderWordDetail(); $("#detailStar").focus?.(); };
    $("#detailSpeak").onclick = () => speak(x.w);
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
    if (v === "list") applyFilter();
    if (v === "stats") renderStats();
    if (v === "set") bindSet();
    updateBar();
  }
  function updateBar(){
    const v = $(".view.on");
    const id = v && v.id ? v.id.replace("v-", "") : "study";
    let pct = 0;
    if (id === "study") {
      pct = Q.length ? Math.round(answered / Q.length * 100) : 0;
    } else {
      const tot = Math.max(1, inScopeCount());
      pct = Math.round(scopedMasteredCount() / tot * 100);
    }
    const bar = $("#bar");
    if (bar) bar.style.width = pct + "%";
  }

  /* ================= Toast ================= */
  let tt = null;
  function toast(m){
    const t = $("#toast");
    t.textContent = m;
    t.classList.add("on");
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove("on"), 2200);
  }

  /* ================= 手势 ================= */
  function bindSwipe(){
    const card = $("#card");
    let x0 = 0, y0 = 0, tracking = false;
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      tracking = true;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    card.addEventListener("pointerup", (e) => {
      if (!tracking) return;
      tracking = false;
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
    if (e.repeat || e.isComposing) return;
    if (rebinding) {
      e.preventDefault();
      captureKey(e);
      return;
    }
    const pop = $("#exPop");
    if (pop && pop.classList && pop.classList.contains("on") && e.key === "Escape") {
      e.preventDefault();
      hideExPop();
      return;
    }
    const tag = e.target.tagName;
    if (activeSheet) {
      if (e.key === "Escape" || (activeSheet.id === "helpSheet" && e.key === "?")) {
        e.preventDefault();
        closeSheet();
      } else if (e.key === "Tab") {
        const selector = 'button, input, select, textarea, a[href], [tabindex="0"]';
        const nodes = Array.from(activeSheet.querySelectorAll?.(selector) || [])
          .concat(pop && !pop.hidden ? Array.from(pop.querySelectorAll?.(selector) || []) : [])
          .filter(x => !x.disabled && !x.hidden);
        if (nodes.length) {
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
        }
      }
      return;
    }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
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
    if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
    if (cur == null) return;

    const K = S.settings.keys;
    if (keyMatch(e, K.know)) {
      e.preventDefault();
      judge(true);
    } else if (keyMatch(e, K.dont)) {
      e.preventDefault();
      judge(false);
    } else if (keyMatch(e, K.next) || e.key === "Enter") {
      e.preventDefault();
      tryNext(true);   // 门控：recall 阶段不翻页
    } else if (keyMatch(e, K.speak)) {
      e.preventDefault();
      speak(W[cur].w);
    } else if (keyMatch(e, K.star)) {
      e.preventDefault();
      toggleStar(cur);
      renderCard();
      toast(isStar(cur) ? "已收藏" : "已取消收藏");
    } else if (keyMatch(e, K.proficient)) {
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
  // 导致点过导航/主题/预设/切书等按钮后无法用空格翻页。
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

  $("#q").addEventListener("input", applyFilter);
  $("#fst").addEventListener("change", () => {
    if ($("#fst").value === "proficient") $("#fsc").value = "all";
    applyFilter();
  });
  $("#fsc").addEventListener("change", applyFilter);
  const dueListBtn = $("#btnDueList");
  if (dueListBtn) dueListBtn.onclick = () => {
    $("#fst").value = "due";
    $("#fsc").value = "scope";
    $("#q").value = "";
    show("list");
  };

  $("#listScroll").addEventListener("scroll", renderRows);
  $("#listInner").addEventListener("click", (e) => {
    const action = e.target.closest("[data-proficient]");
    if (action) { const i = +action.dataset.proficient; setProficient(i, !isProficient(i)); return; }
    const r = e.target.closest(".row");
    if (!r) return;
    openWord(+r.dataset.i);
  });

  $$("#presets button").forEach(b => {
    b.onclick = () => {
      $("#fmin").value = b.dataset.fmin;
      $("#fmax").value = b.dataset.fmax || "";
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
      applyComboFilters(b.dataset.combo);
      save(); bindSet(); applyFilter(); renderStats(); startSession();
      toast("已应用：" + b.textContent);
    };
  });
  $$("#themeSeg button").forEach(b => {
    b.onclick = () => {
      S.settings.theme = b.dataset.theme;
      save(); applyTheme();
      toast("主题：" + b.textContent);
    };
  });
  ["dailyNew","order","fmin","fmax","pmin","kyOnly","showPh","showEx","showFm","autoSpk"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", () => {
      onSet(); bindSet(); applyFilter(); renderStats(); renderCard();
    });
  });

  $("#exp").onclick = () => {
    const data = buildExport();   // v3：全部可用词书 + 当前书（带 dv）
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "背词进度_" + todayStr() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
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
  /** 兼容 v1（平铺，按考研书）与 v2（books 分书全量备份）；返回当前书 state */
  function importState(o){
    if (isRecord(o) && isRecord(o.books)) {
      if (o.version !== 2 && o.version !== 3) throw new Error("不支持的备份版本");
      return importBooksBackup(o);   // v2 无 dv → 按 v1 逐书迁移；v3 直接按 dv 校验
    }
    return importLegacyV1(o);
  }
  $("#file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast("备份文件过大，请选择本应用导出的 JSON 进度文件"); e.target.value = ""; return; }
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        importState(o);
      } catch (err) {
        toast("文件格式不正确，现有进度未改变");
      }
    };
    r.onerror = () => toast("文件读取失败，请重新选择备份文件");
    r.readAsText(f);
    e.target.value = "";
  };
  $("#rst").onclick = () => {
    const name = currentBook().name;
    if (confirm("确定清空「" + name + "」的全部学习进度、熟练标记、收藏与设置？此操作只影响当前词书，且不可撤销。请先导出备份。")) {
      S = freshState(currentBook());
      blockedBooks.delete(currentBookId);
      const saved = save(true, true);
      bindSet(); applyFilter(); renderStats(); startSession(); updateBar(); renderBookList();
      toast(saved ? "已重置「" + name + "」的全部记录" : "已重置，但未能保存；请检查浏览器存储");
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
    toast("已有记录无法读取，已暂停保存；请导入备份或手动重置");
  }

  applyBrand();
  bindSwipe();
  startSession();
  renderStats();
  updateBar();

  // 到期词轮询
  setInterval(() => {
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

  // 跨天刷新
  let lastDay = todayStr();
  setInterval(() => {
    const t = todayStr();
    if (t !== lastDay) {
      lastDay = t;
      startSession();
    }
  }, 60000);

  window.addEventListener?.("storage", (e) => {
    if (e.key === ACTIVE_KEY) { followActiveBook(); return; }
    // 找到变化键所属的词书
    let owner = null;
    for (const id of Object.keys(BOOKS)) {
      if (e.key === BOOKS[id].KEY || e.key === BOOKS[id].PROF_KEY) { owner = id; break; }
    }
    if (!owner) return;
    if (owner !== currentBookId) {
      // 别的书被别人更新：本标签只刷新词书列表统计，不切换
      if (activeSheet && activeSheet.id === "bookSheet") renderBookList();
      return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      const candidate = raw ? normalizeState(JSON.parse(raw), currentBookId) : S;
      const proficientRaw = localStorage.getItem(PROF_KEY);
      if (proficientRaw !== null) candidate.proficient = normalizeProficientByBook(JSON.parse(proficientRaw), currentBook());
      const signature = s => JSON.stringify([s.settings, s.progress, s.days, s.stars, s.proficient]);
      if (signature(candidate) === signature(S) && !Q.slice(qi).some(i => !!candidate.proficient[W[i].w])) {
        S.timeSec = Math.max(S.timeSec, candidate.timeSec);
        lastMainRaw = raw;
        return;
      }
      S = candidate;
      lastMainRaw = raw;
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
    applyComboFilters,
    inScope, inScopeCount, masteredCount, scopedMasteredCount, countDue, buildQueue,
    reviewPlan, wordReviewLabel,
    isProficient, setProficient, resetProficient, proficientCount,
    normalizeState, importState, applyFilter, show, openWord, closeSheet,
    wrongWordIndices, applyDrill, startDrill, exitDrill,
    printStatusLabel, printMetaText, printBookEntries, printBookMarkdown,
    wordBookTxt, exportWordBookTxt,
    splitTxtWords, openTxtSplit, renderTxtSplit, downloadTxtPart, downloadTxtSplitZip,
    getTxtSplitFiles: () => txtSplitContext ? txtSplitContext.files : [],
    renderPrintBook, openPrintBook, copyPrintMarkdown,
    heatLevel, heatmapData,
    exTokens, exHtml, lookupExWord, showExPop, hideExPop,
    getStorageOK: () => storageOK && !blockedBooks.has(currentBookId),
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
      for (const def of BOOK_DEFS) books[def.id] = { state: BOOKS[def.id].KEY, prof: BOOKS[def.id].PROF_KEY };
      return { active: ACTIVE_KEY, books: books };
    },
    setPhase(p) { phase = p; },
    setCur(i) { cur = i; renderCard(); },
    setVerdict(v) { verdict = v; phase = v === null ? "recall" : "revealed"; }
  };
})();
